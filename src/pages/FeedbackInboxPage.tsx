import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Bug, Lightbulb, HelpCircle, MessageSquare, Check, Inbox } from "lucide-react";

type Category = "bug" | "idea" | "question" | "other";
type Status = "new" | "in_progress" | "resolved";

interface Row {
  id: string;
  user_id: string | null;
  category: Category;
  message: string;
  rating: number | null;
  status: Status;
  page_url: string | null;
  created_at: string;
}

const CAT: Record<Category, { icon: typeof Bug; bg: string; color: string }> = {
  bug: { icon: Bug, bg: "rgba(224,85,47,.12)", color: "#b3441f" },
  idea: { icon: Lightbulb, bg: "rgba(43,191,170,.14)", color: "#1f8e7e" },
  question: { icon: HelpCircle, bg: "rgba(245,158,11,.14)", color: "#b4740b" },
  other: { icon: MessageSquare, bg: "rgba(15,15,26,.06)", color: "#6b7280" },
};

export default function FeedbackInboxPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [names, setNames] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [tableMissing, setTableMissing] = useState(false);
  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("feedback_submissions")
      .select("id, user_id, category, message, rating, status, page_url, created_at")
      .order("created_at", { ascending: false });
    if (error && /does not exist|42P01/i.test(error.message)) {
      setTableMissing(true);
      setLoading(false);
      return;
    }
    const list = (data ?? []) as Row[];
    setRows(list);
    const ids = [...new Set(list.map((r) => r.user_id).filter(Boolean))] as string[];
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, first_name, last_name").in("id", ids);
      const map: Record<string, string> = {};
      (profs ?? []).forEach((p: any) => {
        map[p.id] = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || t("feedbackInbox.noName");
      });
      setNames(map);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const setStatus = async (id: string, status: Status) => {
    setBusyId(id);
    await supabase.from("feedback_submissions").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    setBusyId(null);
  };

  const filtered = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter]
  );
  const newCount = rows.filter((r) => r.status === "new").length;

  return (
    <AppLayout>
      <div className="mx-auto max-w-2xl">
        <div className="mb-5 hidden lg:block">
          <h1 style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 24, letterSpacing: "-.01em", color: "#0f0f1a" }}>
            {t("feedbackInbox.title")}
          </h1>
          <p className="mt-1 text-[14px]" style={{ color: "#9398b0" }}>{t("feedbackInbox.subtitle")}</p>
        </div>

        {/* Фільтри статусу */}
        <div className="mb-4 flex flex-wrap gap-2">
          {([
            ["all", t("feedbackInbox.filterAll", { count: rows.length })],
            ["new", t("feedbackInbox.filterNew", { count: newCount })],
            ["in_progress", t("feedbackInbox.filterInProgress")],
            ["resolved", t("feedbackInbox.filterResolved")],
          ] as const).map(([key, label]) => {
            const on = filter === key;
            return (
              <button key={key} type="button" onClick={() => setFilter(key as any)}
                style={{ height: 34, padding: "0 14px", borderRadius: 999, cursor: "pointer",
                  fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 13,
                  background: on ? "#f0fdf9" : "#fff",
                  border: `1.5px solid ${on ? "#2BBFAA" : "#eceef3"}`,
                  color: on ? "#1f8e7e" : "#9398b0" }}>
                {label}
              </button>
            );
          })}
        </div>

        {tableMissing ? (
          <div style={{ borderRadius: 18, border: "1px solid rgba(245,158,11,.4)", background: "linear-gradient(135deg,#FFF7E6,#FFEFD0)", padding: 18 }}>
            <p style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 16, color: "#7a5a14" }}>
              {t("feedbackInbox.tableMissingTitle")}
            </p>
            <p className="mt-1.5 text-[14px]" style={{ color: "#9a6a12", lineHeight: 1.55 }}>
              {t("feedbackInbox.tableMissingBefore")}
              <b> docs/APPLY-IN-LOVABLE.sql</b>{t("feedbackInbox.tableMissingAfter")}
            </p>
          </div>
        ) : loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "44px 16px", borderRadius: 18, border: "1px dashed #eceef3", background: "#fff" }}>
            <Inbox className="mx-auto h-8 w-8" style={{ color: "#b0b4c8" }} />
            <p className="mt-2 text-[14px]" style={{ color: "#9398b0" }}>{t("feedbackInbox.empty")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((r) => {
              const cat = CAT[r.category] ?? CAT.other;
              const Icon = cat.icon;
              const resolved = r.status === "resolved";
              return (
                <div key={r.id} style={{ borderRadius: 18, border: "1px solid #eceef3", background: "#fff", padding: 15, opacity: resolved ? 0.7 : 1 }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, background: cat.bg, color: cat.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Icon className="h-[18px] w-[18px]" />
                      </span>
                      <div className="min-w-0">
                        <p style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 15, color: "#0f0f1a" }}>
                          {r.user_id ? (names[r.user_id] ?? "…") : t("feedbackInbox.anonymous")}
                        </p>
                        <p className="text-[13px]" style={{ color: "#9398b0" }}>
                          <span style={{ color: cat.color, fontWeight: 700 }}>{t(`feedbackInbox.category_${r.category}`)}</span>
                          {" · "}{new Date(r.created_at).toLocaleDateString("uk-UA", { day: "numeric", month: "short" })}
                          {r.rating ? ` · ${"★".repeat(r.rating)}` : ""}
                        </p>
                      </div>
                    </div>
                    {r.status === "new" && (
                      <span style={{ flexShrink: 0, height: 22, padding: "0 9px", borderRadius: 999, background: "rgba(43,191,170,.15)", color: "#1f8e7e", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 12, display: "inline-flex", alignItems: "center" }}>NEW</span>
                    )}
                  </div>

                  <p style={{ marginTop: 11, fontSize: 14.5, lineHeight: 1.5, color: "#0f0f1a", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {r.message}
                  </p>
                  {r.page_url && (
                    <p className="mt-1.5 text-[13px]" style={{ color: "#b0b4c8" }}>{r.page_url}</p>
                  )}

                  {!resolved && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {r.status !== "in_progress" && (
                        <button type="button" disabled={busyId === r.id} onClick={() => setStatus(r.id, "in_progress")}
                          style={{ height: 36, padding: "0 13px", borderRadius: 10, cursor: "pointer", border: "1px solid rgba(245,158,11,.35)", background: "rgba(245,158,11,.12)", color: "#b4740b", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 13 }}>
                          {t("feedbackInbox.takeInProgress")}
                        </button>
                      )}
                      <button type="button" disabled={busyId === r.id} onClick={() => setStatus(r.id, "resolved")}
                        style={{ height: 36, padding: "0 14px", borderRadius: 10, cursor: "pointer", border: "none", background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#fff", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6, boxShadow: "0 6px 16px -8px rgba(43,191,170,.6)" }}>
                        <Check className="h-3.5 w-3.5" /> {t("feedbackInbox.markResolved")}
                      </button>
                    </div>
                  )}
                  {resolved && (
                    <button type="button" disabled={busyId === r.id} onClick={() => setStatus(r.id, "new")}
                      style={{ marginTop: 10, height: 32, padding: "0 12px", borderRadius: 9, cursor: "pointer", border: "1px solid #eceef3", background: "#fff", color: "#9398b0", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 12.5 }}>
                      {t("feedbackInbox.reopen")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
