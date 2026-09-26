import { useEffect, useMemo, useState } from "react";
import { ErrorState } from "@/components/ErrorState";
import { toast } from "sonner";
import { getLocale } from "@/lib/locale";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Bug, Lightbulb, HelpCircle, MessageSquare, Check, Inbox, Reply, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SUPPORT_TELEGRAM, supportFallbackUrl } from "@/lib/support";

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
  /* Приходять із міграцією 20260926120000. До її застосування колонок у базі
     немає — саме тому запит іде `select("*")`: жодного 400 «колонки немає», і
     відповідь просто не рендериться (інваріант «відсутнє = відсутнє»). */
  answer?: string | null;
  answered_at?: string | null;
}

const CAT: Record<Category, { icon: typeof Bug; bg: string; color: string }> = {
  bug: { icon: Bug, bg: "rgba(224,85,47,.12)", color: "#b3441f" },
  idea: { icon: Lightbulb, bg: "rgba(43,191,170,.14)", color: "var(--teal-text,#1a7a6c)" },
  question: { icon: HelpCircle, bg: "rgba(245,158,11,.14)", color: "var(--warning-text,#B45309)" },
  other: { icon: MessageSquare, bg: "rgba(15,15,26,.06)", color: "#6b7280" },
};

export default function FeedbackInboxPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [tableMissing, setTableMissing] = useState(false);
  /* 26.09, живий випадок: у скриньці з 14.09 лежить «Есть ли у вас чат
     поддержки?» — і відповісти НІЯК, сторінка вміла лише статуси. Питання без
     відповіді = відтік, тому відповідь пишеться тут і приходить людині
     дзвіночком (RPC answer_feedback, вона ж і надсилає сповіщення). */
  const [answering, setAnswering] = useState<Row | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [sending, setSending] = useState(false);

  const sendAnswer = async () => {
    const row = answering;
    if (!row || answerText.trim().length < 2) return;
    setSending(true);
    let res: { data?: any; error?: { message: string } | null } = {};
    try {
      res = await (supabase.rpc as any)("answer_feedback", { _id: row.id, _text: answerText.trim() });
    } catch (e) {
      res = { error: { message: e instanceof Error ? e.message : String(e) } };
    } finally {
      setSending(false);
    }
    if (res.error || !res.data?.ok) {
      toast.error(t("feedbackInbox.answerFailed"), { description: res.error?.message ?? res.data?.reason });
      return;
    }
    const sentText = answerText.trim();
    setRows((prev) => prev.map((r) => (r.id === row.id
      ? { ...r, status: "resolved" as Status, answer: sentText, answered_at: new Date().toISOString() }
      : r)));
    setAnswering(null);
    setAnswerText("");
    if (res.data?.delivered === false) {
      // Звернення без акаунта: відповідь збережена, надіслати нікуди — кажемо це прямо.
      toast.warning(t("feedbackInbox.answerAnonymous"));
    } else {
      toast.success(t("feedbackInbox.answerSent"));
    }
  };
  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("feedback_submissions")
      // `*`, а не список колонок: відповідь (answer/answered_at) зʼявляється
      // разом із міграцією 26.09, а фронтенд їде раніше (Publish). Зі списком
      // PostgREST відповів би 400 на ВЕСЬ запит і скринька стала б порожньою.
      .select("*")
      .order("created_at", { ascending: false });
    if (error && /does not exist|42P01/i.test(error.message)) {
      setTableMissing(true);
      setLoading(false);
      return;
    }
    // P4: ловилась лише «таблиці немає». Мережа чи RLS давали порожню скриньку —
    // тобто брехню «звернень немає». Будь-яка інша помилка — окремий стан.
    if (error) {
      console.error("feedback inbox load failed", error);
      setLoadError(true);
      setLoading(false);
      return;
    }
    setLoadError(false);
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
    try {
      // Аудит 01.09: результат не перевірявся — картка ставала «Вирішено»
      // навіть коли запис не пройшов, і звернення тихо лишалось відкритим.
      const { error } = await supabase
        .from("feedback_submissions")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) {
        toast.error(t("errorState.title"));
        return;
      }
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    } finally {
      setBusyId(null);
    }
  };

  const filtered = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter]
  );
  const newCount = rows.filter((r) => r.status === "new").length;

  return (
    <>
      <div className="mx-auto max-w-2xl">
        <div className="mb-5 hidden lg:block">
          <h1 style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 24, letterSpacing: "-.01em", color: "var(--ds-txt,#0f0f1a)" }}>
            {t("feedbackInbox.title")}
          </h1>
          <p className="mt-1 text-[14px]" style={{ color: "var(--sub,#62677E)" }}>{t("feedbackInbox.subtitle")}</p>
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
                  fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 14,
                  background: on ? "var(--teal-l,#f0fdf9)" : "var(--ds-surface,#fff)",
                  border: `1.5px solid ${on ? "#2BBFAA" : "var(--ds-border,#eceef3)"}`,
                  color: on ? "var(--teal-text,#1a7a6c)" : "var(--sub,#62677E)" }}>
                {label}
              </button>
            );
          })}
        </div>

        {loadError ? (
          <ErrorState onRetry={() => void load()} retrying={loading} />
        ) : tableMissing ? (
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
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ borderRadius: 18, border: "1px solid var(--ds-border,#eceef3)", background: "var(--ds-surface,#fff)", padding: 15 }}>
                <div className="flex items-center gap-2.5">
                  <div className="h-[38px] w-[38px] shrink-0 animate-pulse rounded-[11px] bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-32 animate-pulse rounded-md bg-muted" />
                    <div className="h-3 w-24 animate-pulse rounded-md bg-muted" />
                  </div>
                </div>
                <div className="mt-3 h-3.5 w-3/4 animate-pulse rounded-md bg-muted" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "44px 16px", borderRadius: 18, border: "1px dashed var(--ds-border,#eceef3)", background: "var(--ds-surface,#fff)" }}>
            <Inbox className="mx-auto h-8 w-8" style={{ color: "var(--sub,#62677E)" }} />
            <p className="mt-2 text-[14px]" style={{ color: "var(--sub,#62677E)" }}>{t("feedbackInbox.empty")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((r) => {
              const cat = CAT[r.category] ?? CAT.other;
              const Icon = cat.icon;
              const resolved = r.status === "resolved";
              return (
                <div key={r.id} style={{ borderRadius: 18, border: "1px solid var(--ds-border,#eceef3)", background: "var(--ds-surface,#fff)", padding: 15, opacity: resolved ? 0.7 : 1 }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, background: cat.bg, color: cat.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Icon className="h-[18px] w-[18px]" />
                      </span>
                      <div className="min-w-0">
                        <p style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 15, color: "var(--ds-txt,#0f0f1a)" }}>
                          {r.user_id ? (names[r.user_id] ?? "…") : t("feedbackInbox.anonymous")}
                        </p>
                        <p className="text-[14px]" style={{ color: "var(--sub,#62677E)" }}>
                          <span style={{ color: cat.color, fontWeight: 700 }}>{t(`feedbackInbox.category_${r.category}`)}</span>
                          {" · "}{new Date(r.created_at).toLocaleDateString(getLocale(), { day: "numeric", month: "short" })}
                          {r.rating ? ` · ${"★".repeat(r.rating)}` : ""}
                        </p>
                      </div>
                    </div>
                    {r.status === "new" && (
                      <span style={{ flexShrink: 0, height: 22, padding: "0 9px", borderRadius: 999, background: "rgba(43,191,170,.15)", color: "var(--teal-text,#1a7a6c)", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 14, display: "inline-flex", alignItems: "center" }}>NEW</span>
                    )}
                  </div>

                  <p style={{ marginTop: 11, fontSize: 15, lineHeight: 1.5, color: "var(--ds-txt,#0f0f1a)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {r.message}
                  </p>
                  {r.page_url && (
                    <p className="mt-1.5 text-[14px]" style={{ color: "var(--sub,#62677E)" }}>{r.page_url}</p>
                  )}

                  {r.answer && (
                    <div className="mt-2.5 rounded-[12px] border p-2.5" style={{ borderColor: "rgba(43,191,170,.35)", background: "var(--teal-l,#f0fdf9)" }}>
                      <p className="text-[14px] font-bold" style={{ color: "var(--teal-text,#1a7a6c)" }}>
                        {t("feedbackInbox.answerLabel")}
                        {r.answered_at ? ` · ${new Date(r.answered_at).toLocaleDateString(getLocale(), { day: "numeric", month: "short" })}` : ""}
                      </p>
                      <p className="mt-1 text-[15px]" style={{ color: "var(--ds-txt,#0f0f1a)", whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{r.answer}</p>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {/* Відповісти можна завжди — і на вирішене теж (людина могла
                        перепитати). Порожня скринька відповідей — це відтік. */}
                    <button type="button" onClick={() => { setAnswering(r); setAnswerText(r.answer ?? ""); }}
                      style={{ height: 44, padding: "0 14px", borderRadius: 10, cursor: "pointer", border: "1px solid rgba(43,191,170,.45)", background: "var(--teal-l,#f0fdf9)", color: "var(--teal-text,#1a7a6c)", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 14, display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <Reply className="h-4 w-4" /> {r.answer ? t("feedbackInbox.answerAgain") : t("feedbackInbox.answer")}
                    </button>
                  </div>

                  {!resolved && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {r.status !== "in_progress" && (
                        <button type="button" disabled={busyId === r.id} onClick={() => setStatus(r.id, "in_progress")}
                          style={{ height: 36, padding: "0 13px", borderRadius: 10, cursor: "pointer", border: "1px solid rgba(245,158,11,.35)", background: "rgba(245,158,11,.12)", color: "var(--warning-text,#B45309)", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 14 }}>
                          {t("feedbackInbox.takeInProgress")}
                        </button>
                      )}
                      <button type="button" disabled={busyId === r.id} onClick={() => setStatus(r.id, "resolved")}
                        style={{ height: 36, padding: "0 14px", borderRadius: 10, cursor: "pointer", border: "none", background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 14, display: "inline-flex", alignItems: "center", gap: 6, boxShadow: "0 6px 16px -8px rgba(43,191,170,.6)" }}>
                        <Check className="h-3.5 w-3.5" /> {t("feedbackInbox.markResolved")}
                      </button>
                    </div>
                  )}
                  {resolved && (
                    <button type="button" disabled={busyId === r.id} onClick={() => setStatus(r.id, "new")}
                      style={{ marginTop: 10, height: 40, padding: "0 14px", borderRadius: 9, cursor: "pointer", border: "1px solid var(--ds-border,#eceef3)", background: "var(--ds-surface,#fff)", color: "var(--sub,#62677E)", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 14 }}>
                      {t("feedbackInbox.reopen")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Аркуш відповіді: форма — завжди нижній аркуш (канон дизайну). */}
      <Dialog open={!!answering} onOpenChange={(o) => { if (!o) { setAnswering(null); setAnswerText(""); } }}>
        <DialogContent aria-describedby={undefined} className="w-full max-w-md p-5 rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto">
          <DialogTitle className="text-[19px] font-extrabold">{t("feedbackInbox.answerTitle")}</DialogTitle>
          {answering && (
            <>
              <p className="text-[14px]" style={{ color: "var(--sub,#62677E)" }}>
                {answering.user_id ? (names[answering.user_id] ?? t("feedbackInbox.noName")) : t("feedbackInbox.anonymous")}
                {" · "}{new Date(answering.created_at).toLocaleDateString(getLocale(), { day: "numeric", month: "short" })}
              </p>
              <p className="rounded-[12px] p-2.5 text-[15px]" style={{ background: "var(--ds-surface3,#f6f5f1)", color: "var(--ds-txt,#0f0f1a)", whiteSpace: "pre-wrap", lineHeight: 1.45 }}>
                {answering.message}
              </p>
              {!answering.user_id && (
                <p className="text-[14px]" style={{ color: "var(--warning-text,#B45309)" }}>{t("feedbackInbox.answerAnonymousHint")}</p>
              )}
              {/* Найчастіше питання — «а де чат підтримки?». Готовий текст, щоб
                  не набирати його щоразу; він описує РЕАЛЬНИЙ шлях у застосунку. */}
              <button type="button"
                onClick={() => setAnswerText(t("feedbackInbox.answerTemplateSupport", { handle: SUPPORT_TELEGRAM }))}
                style={{ alignSelf: "flex-start", minHeight: 44, padding: "0 12px", borderRadius: 999, cursor: "pointer", border: "1px dashed var(--ds-border,#eceef3)", background: "var(--ds-surface,#fff)", color: "var(--sub,#62677E)", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 14 }}>
                {t("feedbackInbox.answerTemplateSupportLabel")}
              </button>
              <textarea
                aria-label={t("feedbackInbox.answerLabel")}
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                rows={5}
                maxLength={2000}
                placeholder={t("feedbackInbox.answerPlaceholder")}
                className="w-full rounded-[12px] border border-input p-3 text-[15px]"
                style={{ color: "var(--ds-txt,#0f0f1a)", background: "var(--ds-surface,#fff)" }}
              />
              <button type="button" disabled={sending || answerText.trim().length < 2} onClick={() => void sendAnswer()}
                style={{ height: 50, borderRadius: 14, cursor: sending ? "wait" : "pointer", border: "none", background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 16, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: answerText.trim().length < 2 ? 0.6 : 1 }}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Reply className="h-4 w-4" />}
                {t("feedbackInbox.answerSend")}
              </button>
              <a href={supportFallbackUrl("oTutorHub")} target="_blank" rel="noopener noreferrer"
                className="text-center text-[14px] underline" style={{ color: "var(--sub,#62677E)", minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {t("feedbackInbox.answerViaTelegram")}
              </a>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
