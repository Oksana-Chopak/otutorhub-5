import { useEffect, useMemo, useState } from "react";
import { getLocale } from "@/lib/locale";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { Button } from "@/components/ui/button";
import { Wallet, Plus, Search, Loader2, X } from "lucide-react";
import { WalletDialog } from "@/components/WalletDialog";
import { EmptyState } from "@/components/EmptyState";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

interface PairRow {
  tutor_id: string;
  student_id: string;
  tutor_name: string;
  student_name: string;
  rate: number;
  lessons_balance: number;
  amount_balance: number;
  last_transaction_at: string | null;
}

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString(getLocale(), {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "—";

export default function WalletsPage() {
  const { roles, user } = useAuth();
  const { isIndependent } = useWorkspaceSettings();
  const isManager = roles.includes("manager");
  const isIndependentTutor =
    !isManager && roles.includes("tutor") && isIndependent;

  const [rows, setRows] = useState<PairRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [active, setActive] = useState<PairRow | null>(null);
  const [showAll, setShowAll] = useState(true);

  const loadData = async () => {
    setLoading(true);

    // 1. Pairs (student_rates) + balances in ONE round-trip — they're independent;
    //    only the profiles lookup depends on the pairs result.
    let ratesQ = supabase
      .from("student_rates")
      .select("tutor_id, student_id, price_per_lesson, archived_at")
      .is("archived_at", null);
    if (isIndependentTutor && user) {
      ratesQ = ratesQ.eq("tutor_id", user.id).eq("source", "independent");
    }
    const [{ data: rates }, { data: balances }] = await Promise.all([
      ratesQ,
      supabase
        .from("student_wallet_balances" as any)
        .select("tutor_id, student_id, lessons_balance, amount_balance, last_transaction_at"),
    ]);
    const pairs = (rates ?? []) as any[];

    // 2. Profiles (depends on the pair ids)
    const ids = Array.from(
      new Set(pairs.flatMap((p) => [p.tutor_id, p.student_id])),
    );
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", ids);
    const nameMap = new Map(
      (profiles ?? []).map((p: any) => [
        p.id,
        `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "—",
      ]),
    );
    const balMap = new Map<string, any>();
    (balances ?? []).forEach((b: any) => {
      balMap.set(`${b.tutor_id}:${b.student_id}`, b);
    });

    // 4. Compose, dedupe by pair (a pair may have multiple subjects)
    const composed = new Map<string, PairRow>();
    pairs.forEach((p) => {
      const key = `${p.tutor_id}:${p.student_id}`;
      const bal = balMap.get(key);
      const existing = composed.get(key);
      const row: PairRow = {
        tutor_id: p.tutor_id,
        student_id: p.student_id,
        tutor_name: nameMap.get(p.tutor_id) ?? "—",
        student_name: nameMap.get(p.student_id) ?? "—",
        rate: existing
          ? Math.max(existing.rate, Number(p.price_per_lesson) || 0)
          : Number(p.price_per_lesson) || 0,
        lessons_balance: bal?.lessons_balance ?? 0,
        amount_balance: Number(bal?.amount_balance ?? 0),
        last_transaction_at: bal?.last_transaction_at ?? null,
      };
      composed.set(key, row);
    });

    setRows(Array.from(composed.values()));
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [user?.id, isIndependentTutor]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (!showAll && r.lessons_balance <= 0 && r.amount_balance <= 0) return false;
        if (!q) return true;
        return (
          r.student_name.toLowerCase().includes(q) ||
          r.tutor_name.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        // Most recent activity first
        const aT = a.last_transaction_at ? new Date(a.last_transaction_at).getTime() : 0;
        const bT = b.last_transaction_at ? new Date(b.last_transaction_at).getTime() : 0;
        if (aT !== bT) return bT - aT;
        // Then balance > 0 above empty
        const aHas = a.lessons_balance > 0 || a.amount_balance > 0 ? 1 : 0;
        const bHas = b.lessons_balance > 0 || b.amount_balance > 0 ? 1 : 0;
        if (aHas !== bHas) return bHas - aHas;
        return a.student_name.localeCompare(b.student_name, "uk");
      });
  }, [rows, search, showAll]);

  return (
    <AppLayout>
      <div className="space-y-6">
        <header className="space-y-2">
          <div className="hidden lg:flex items-center gap-2">
            <Wallet className="h-6 w-6 text-primary" />
            <h1 style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 24, letterSpacing: "-.01em", color: "#0f0f1a" }}>{t("walletsPage.title")}</h1>
          </div>
          <p className="text-sm" style={{ color: "var(--sub,#6b7088)" }}>
            {t("walletsPage.subtitle")}
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          {searchOpen ? (
            <div className="flex items-center gap-2.5 flex-1 min-w-[200px]" style={{ height: 46, padding: "0 8px 0 14px", borderRadius: 13, background: "#fff", border: "1px solid #eceef3", boxShadow: "0 1px 4px rgba(0,0,0,.05)" }}>
              <Search size={20} style={{ color: "var(--sub,#6b7088)", flexShrink: 0 }} />
              <input
                autoFocus
                placeholder={t("walletsPage.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontFamily: "'Plus Jakarta Sans', system-ui", fontSize: 15, color: "#0f0f1a", minWidth: 0 }}
              />
              <button onClick={() => { setSearch(""); setSearchOpen(false); }} aria-label={t("common.close")}
                style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 999, border: "none", cursor: "pointer", background: "#F5F4F0", color: "var(--sub,#6b7088)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <X size={17} />
              </button>
            </div>
          ) : (
            <button onClick={() => setSearchOpen(true)} aria-label={t("walletsPage.searchPlaceholder")}
              style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 999, border: "none", cursor: "pointer", background: "#fff", color: "var(--sub,#6b7088)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 4px rgba(0,0,0,.05)" }}>
              <Search size={21} strokeWidth={2} />
            </button>
          )}
          <Button
            variant={showAll ? "default" : "outline"}
            size="sm"
            onClick={() => setShowAll((s) => !s)}
          >
            {showAll ? t("walletsPage.showWithBalance") : t("walletsPage.showAll")}
          </Button>
        </div>

        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-[16px] border bg-white p-4" style={{ borderColor: "var(--ds-border,#eceef3)" }}>
                <div className="h-4 w-44 animate-pulse rounded-md bg-muted" />
                <div className="mt-2 h-3 w-64 max-w-full animate-pulse rounded-md bg-muted" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title={t("walletsPage.noWallets")}
            description={
              showAll
                ? t("walletsPage.noActivePairs")
                : t("walletsPage.noPrepaidsHint")
            }
          />
        ) : (
          <>
            {/* Mobile: cards */}
            <div className="grid gap-3 md:hidden">
              {filtered.map((r) => (
                <div key={`${r.tutor_id}:${r.student_id}`} className="rounded-[18px] p-4 space-y-3" style={{ border: "1px solid #eceef3", background: "#fff", boxShadow: "0 2px 10px -4px rgba(15,15,26,.06)" }}>
                  <div className="flex items-center gap-3">
                    <div style={{ width: 42, height: 42, borderRadius: 13, flexShrink: 0, background: "linear-gradient(135deg,#2BBFAA,#1f8e7e)", color: "#0f0f1a", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 15 }}>
                      {(r.student_name.split(" ").map((w: string) => w[0]).filter(Boolean).slice(0, 2).join("") || "?").toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15, color: "#0f0f1a" }}>{r.student_name}</div>
                      <div className="text-[14px]" style={{ color: "var(--sub,#6b7088)" }}>↔ {r.tutor_name}</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-[15px]">
                      <span className="font-semibold tabular-nums" style={{ color: "#1f8e7e" }}>
                        {r.lessons_balance > 0 && `🎟 ${t("walletsPage.lessonsShort", { count: r.lessons_balance })}`}
                        {r.lessons_balance > 0 && r.amount_balance > 0 && " · "}
                        {r.amount_balance > 0 && `${r.amount_balance.toFixed(0)} ₴`}
                        {r.lessons_balance === 0 && r.amount_balance === 0 && (
                          <span style={{ color: "var(--sub,#6b7088)" }}>—</span>
                        )}
                      </span>
                    </div>
                    <button type="button" onClick={() => setActive(r)}
                      className="flex items-center gap-1.5 rounded-[11px] px-4 h-11 text-[14px] font-bold"
                      style={{ background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", fontFamily: "Inter, system-ui, sans-serif", boxShadow: "0 6px 16px -8px rgba(43,191,170,.6)" }}>
                      <Plus className="h-3.5 w-3.5" />
                      {t("walletsPage.topUpBtn")}
                    </button>
                  </div>
                  <div className="text-[14px]" style={{ color: "var(--sub,#6b7088)" }}>
                    {t("walletsPage.lastTransaction")}: {fmtDate(r.last_transaction_at)}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden md:block overflow-x-auto rounded-[16px]" style={{ border: "1px solid #eceef3" }}>
              <table className="w-full text-[15px]">
                <thead className="text-[14px] uppercase" style={{ background: "#fbfbfc", color: "var(--sub,#6b7088)", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700 }}>
                  <tr>
                    <th className="px-4 py-3 text-left">{t("walletsPageExtra.studentCol")}</th>
                    <th className="px-4 py-3 text-left">{t("walletsPageExtra.tutorCol")}</th>
                    <th className="px-4 py-3 text-right">{t("walletsPageExtra.lessonsBalanceCol")}</th>
                    <th className="px-4 py-3 text-right">{t("walletsPageExtra.moneyBalanceCol")}</th>
                    <th className="px-4 py-3 text-left">{t("walletsPageExtra.lastOpCol")}</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr
                      key={`${r.tutor_id}:${r.student_id}`}
                      style={{ borderTop: "1px solid #eceef3" }} className="hover:bg-muted/50"
                    >
                      <td className="px-4 py-3 font-medium">{r.student_name}</td>
                      <td className="px-4 py-3" style={{ color: "var(--sub,#6b7088)" }}>{r.tutor_name}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {r.lessons_balance > 0 ? (
                          <span className="font-semibold" style={{ color: "#1f8e7e" }}>{r.lessons_balance}</span>
                        ) : (
                          <span style={{ color: "var(--sub,#6b7088)" }}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {r.amount_balance > 0 ? (
                          <span className="font-semibold" style={{ color: "#1f8e7e" }}>
                            {r.amount_balance.toFixed(0)} ₴
                          </span>
                        ) : (
                          <span style={{ color: "var(--sub,#6b7088)" }}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[14px]" style={{ color: "var(--sub,#6b7088)" }}>
                        {fmtDate(r.last_transaction_at)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" onClick={() => setActive(r)}
                          className="rounded-[10px] px-4 h-11 text-[14px] font-bold"
                          style={{ border: "1px solid #eceef3", background: "#f0fdf9", color: "#1f8e7e", fontFamily: "Inter, system-ui, sans-serif" }}>
                          {t("walletsPage.openBtn")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {active && (
        <WalletDialog
          open={!!active}
          onOpenChange={(o) => {
            if (!o) {
              setActive(null);
              loadData();
            }
          }}
          tutorId={active.tutor_id}
          studentId={active.student_id}
          studentName={active.student_name}
          tutorName={active.tutor_name}
          ratePerLesson={active.rate}
          canTopUp={isManager || isIndependentTutor}
          canDelete={isManager}
        />
      )}
    </AppLayout>
  );
}
