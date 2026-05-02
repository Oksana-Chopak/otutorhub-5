import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Wallet, Plus, Search, Loader2 } from "lucide-react";
import { WalletDialog } from "@/components/WalletDialog";
import { EmptyState } from "@/components/EmptyState";

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
    ? new Date(iso).toLocaleDateString("uk-UA", {
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
  const [active, setActive] = useState<PairRow | null>(null);
  const [showAll, setShowAll] = useState(false);

  const loadData = async () => {
    setLoading(true);

    // 1. Pairs from student_rates
    let ratesQ = supabase
      .from("student_rates")
      .select("tutor_id, student_id, price_per_lesson, archived_at")
      .is("archived_at", null);
    if (isIndependentTutor && user) {
      ratesQ = ratesQ.eq("tutor_id", user.id).eq("source", "independent");
    }
    const { data: rates } = await ratesQ;
    const pairs = (rates ?? []) as any[];

    // 2. Profiles
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

    // 3. Balances
    let balQ = supabase
      .from("student_wallet_balances" as any)
      .select("*");
    const { data: balances } = await balQ;
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
        // Pairs with balance first, then by name
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
          <div className="flex items-center gap-2">
            <Wallet className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">Гаманці учнів</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Передоплати учнів за майбутні уроки. Списання відбувається автоматично, як тільки створюється новий урок.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Пошук за учнем або репетитором…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button
            variant={showAll ? "default" : "outline"}
            size="sm"
            onClick={() => setShowAll((s) => !s)}
          >
            {showAll ? "Тільки з балансом" : "Показати всі пари"}
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="Немає гаманців з балансом"
            description={
              showAll
                ? "Жодної активної пари не знайдено."
                : "Жоден учень поки не має передоплати. Натисніть «Показати всі пари», щоб поповнити будь-який гаманець."
            }
          />
        ) : (
          <>
            {/* Mobile: cards */}
            <div className="grid gap-3 md:hidden">
              {filtered.map((r) => (
                <Card key={`${r.tutor_id}:${r.student_id}`}>
                  <CardContent className="p-4 space-y-3">
                    <div>
                      <div className="font-medium text-foreground">{r.student_name}</div>
                      <div className="text-xs text-muted-foreground">↔ {r.tutor_name}</div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-sm">
                        <span className="font-semibold text-primary tabular-nums">
                          {r.lessons_balance > 0 && `🎟 ${r.lessons_balance} ур.`}
                          {r.lessons_balance > 0 && r.amount_balance > 0 && " · "}
                          {r.amount_balance > 0 && `${r.amount_balance.toFixed(0)} ₴`}
                          {r.lessons_balance === 0 && r.amount_balance === 0 && (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </span>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => setActive(r)}>
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        Поповнити
                      </Button>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Остання операція: {fmtDate(r.last_transaction_at)}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden md:block overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">Учень</th>
                    <th className="px-4 py-3 text-left">Репетитор</th>
                    <th className="px-4 py-3 text-right">Баланс уроків</th>
                    <th className="px-4 py-3 text-right">Баланс ₴</th>
                    <th className="px-4 py-3 text-left">Остання операція</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr
                      key={`${r.tutor_id}:${r.student_id}`}
                      className="border-t border-border hover:bg-muted/30"
                    >
                      <td className="px-4 py-3 font-medium">{r.student_name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{r.tutor_name}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {r.lessons_balance > 0 ? (
                          <span className="font-semibold text-primary">{r.lessons_balance}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {r.amount_balance > 0 ? (
                          <span className="font-semibold text-primary">
                            {r.amount_balance.toFixed(0)} ₴
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {fmtDate(r.last_transaction_at)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="outline" onClick={() => setActive(r)}>
                          Відкрити
                        </Button>
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
        />
      )}
    </AppLayout>
  );
}
