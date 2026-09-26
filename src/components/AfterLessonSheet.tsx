import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, ChevronRight, Loader2, SkipForward, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { updateLessonDetailsSafe } from "@/lib/lessonDetailsSafe";
import { useLessonStatus } from "@/hooks/useLessonStatus";
import { useHaptic } from "@/hooks/useHaptic";
import { burstConfetti } from "@/lib/confetti";
import { getLocale } from "@/lib/locale";
import { formatPrice } from "@/lib/currency";
import { useAutoGrowTextarea } from "@/hooks/useAutoGrowTextarea";

export type QueueLesson = {
  id: string;
  subject: string;
  starts_at: string;
  duration_minutes: number;
  student_id: string | null;
  source: "hub" | "independent";
  student_price?: number | null;
  student_payment_status?: string | null;
  currency?: string | null;
};

/**
 * АРКУШ «ПІСЛЯ УРОКУ» З ЧЕРГОЮ — важіль 1 аудиту шляхів 24.09.
 *
 * Що було: момент «урок закінчився» — єдиний за день, коли репетитор точно
 * тримає телефон у руках, — обслуговувався полюванням по екрану: позначити
 * проведеним на картці, оплату — в іншому місці, конспект — у діалозі уроку,
 * де спершу «Зустріч» і приватні нотатки, а текст нижче. Непозначений урок —
 * це невидимі гроші, тож кожен зайвий дотик тут коштує реально.
 *
 * Що тепер: один аркуш на урок — Проведено · Оплачено · Конспект · Домашка —
 * і після збереження він САМ переходить до наступного незакритого уроку
 * (черга, як «вхідні до нуля»). Конспект і домашка стоять ПЕРШИМИ, решта —
 * під «показати більше» в деталях уроку, куди аркуш і веде за потреби.
 *
 * Межі свідомі:
 *  · груповий урок має гроші й матеріали на УЧАСНИКАХ, а не на уроці, тож для
 *    нього аркуш показує лише «Проведено / Скасовано» (як і раніше);
 *  · «Оплачено» не показуємо хабовому репетитору: оплату учня отримує школа,
 *    і позначає її менеджер (`canMarkPaid`);
 *  · святкуємо лише збережене: конфеті — після відповіді бази, і лише коли
 *    черга дійшла до кінця.
 */
export function AfterLessonSheet({
  open,
  lessons,
  studentNames,
  canMarkPaid,
  onClose,
  onChanged,
}: {
  open: boolean;
  lessons: QueueLesson[];
  studentNames: Record<string, string>;
  /** Чи ця персона взагалі позначає оплату учня (не хабовий репетитор). */
  canMarkPaid: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const haptic = useHaptic();
  const { complete: flowComplete, cancel: flowCancel } = useLessonStatus();
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState("");
  const [homework, setHomework] = useState("");
  const [paid, setPaid] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const summaryGrow = useAutoGrowTextarea(summary);
  const homeworkGrow = useAutoGrowTextarea(homework);

  const lesson = lessons[index];
  const isGroup = !lesson?.student_id;

  // Матеріали читаємо поштучно: аркуш відкривається на ОДИН урок, і вантажити
  // конспекти всієї черги наперед — це чужа робота і чужий трафік.
  const loadDetails = useCallback(async () => {
    setLoaded(false);
    setSummary(""); setHomework("");
    setPaid((lesson?.student_payment_status ?? "unpaid") === "paid");
    if (!lesson || isGroup) { setLoaded(true); return; }
    try {
      const { data } = await supabase
        .from("lesson_details")
        .select("summary, homework")
        .eq("lesson_id", lesson.id)
        .maybeSingle();
      if (data) {
        setSummary((data as { summary: string | null }).summary ?? "");
        setHomework((data as { homework: string | null }).homework ?? "");
      }
    } catch { /* не прочитали — поля просто порожні, це не помилка екрана */ }
    setLoaded(true);
  }, [lesson?.id, isGroup]);

  useEffect(() => { if (open) void loadDetails(); }, [open, loadDetails]);
  useEffect(() => { if (open) setIndex(0); }, [open]);

  if (!open || !lesson) return null;

  const next = (celebrate: boolean) => {
    if (index + 1 < lessons.length) {
      setIndex(index + 1);
      return;
    }
    // Черга закрита — ось тут і тільки тут доречне свято.
    if (celebrate) { haptic.success(); burstConfetti(); toast.success(t("afterLesson.queueDone", { count: lessons.length })); }
    onChanged();
    onClose();
  };

  const saveAndNext = async () => {
    setBusy(true);
    let ok = true;
    try {
      // 1) статус: «проведено» — канонічним шляхом (useLessonStatus), той самий,
      //    що на картці уроку: сповіщення, календар, гейти персони.
      ok = await flowComplete(lesson as never, { canMarkPay: false });
      // 2) матеріали й оплата — одним записом, лише якщо є що писати.
      if (ok && !isGroup) {
        const patch: Record<string, unknown> = {};
        const s = summary.trim(); const h = homework.trim();
        if (s) patch.summary = s;
        if (h) patch.homework = h;
        if (canMarkPaid && paid && (lesson.student_payment_status ?? "unpaid") !== "paid") {
          patch.student_payment_status = "paid";
          patch.student_paid_at = new Date().toISOString();
        }
        if (Object.keys(patch).length > 0) {
          const { error } = await updateLessonDetailsSafe(lesson.id, patch as never);
          if (error) { ok = false; toast.error(t("afterLesson.saveFailed")); }
        }
      }
    } catch {
      ok = false;
      toast.error(t("afterLesson.saveFailed"));
    } finally {
      setBusy(false);
    }
    if (!ok) return;
    haptic.tap();
    next(true);
  };

  const skipLesson = () => { haptic.tap(); next(false); };

  const cancelLesson = async () => {
    setBusy(true);
    let ok = false;
    try {
      ok = await flowCancel(lesson as never);
    } catch {
      ok = false;
    } finally {
      setBusy(false);
    }
    if (ok) next(false);
  };

  const when = new Date(lesson.starts_at);
  const name = lesson.student_id ? (studentNames[lesson.student_id] ?? t("roles.student")) : t("groupLessons.cardLabel");
  const price = Number(lesson.student_price ?? 0);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="max-h-[92vh] w-full max-w-md overflow-y-auto p-5 rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto">
        <DialogTitle className="text-[19px] font-extrabold">{t("afterLesson.title")}</DialogTitle>
        <p className="text-[15px]" style={{ color: "var(--sub,#62677E)" }}>
          {name} · {lesson.subject} · {when.toLocaleString(getLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
        </p>
        {lessons.length > 1 && (
          <p className="text-[14px] font-semibold" style={{ color: "var(--teal-text,#1a7a6c)" }}>
            {t("afterLesson.progress", { current: index + 1, total: lessons.length })}
          </p>
        )}

        {!isGroup && (
          <>
            {/* Конспект і домашка — ПЕРШИМИ: це те, що пишуть одразу після уроку. */}
            <label className="text-[14px] font-semibold" htmlFor="al-summary">{t("afterLesson.summary")}</label>
            <textarea
              id="al-summary"
              ref={summaryGrow}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
              placeholder={t("afterLesson.summaryPlaceholder")}
              className="w-full rounded-[12px] border border-input p-3 text-[15px]"
              style={{ color: "var(--ds-txt,#0f0f1a)", background: "var(--ds-surface,#fff)" }}
            />
            <label className="text-[14px] font-semibold" htmlFor="al-homework">{t("afterLesson.homework")}</label>
            <textarea
              id="al-homework"
              ref={homeworkGrow}
              value={homework}
              onChange={(e) => setHomework(e.target.value)}
              rows={2}
              placeholder={t("afterLesson.homeworkPlaceholder")}
              className="w-full rounded-[12px] border border-input p-3 text-[15px]"
              style={{ color: "var(--ds-txt,#0f0f1a)", background: "var(--ds-surface,#fff)" }}
            />
            {canMarkPaid && price > 0 && (
              <button
                type="button"
                onClick={() => { haptic.tap(); setPaid((p) => !p); }}
                aria-pressed={paid}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-[12px] px-3.5 text-[15px] font-bold"
                style={{
                  background: paid ? "rgba(43,191,170,.14)" : "var(--ds-surface3,#f6f5f1)",
                  border: `1px solid ${paid ? "#2BBFAA" : "var(--ds-border,#eceef3)"}`,
                  color: paid ? "var(--teal-text,#1a7a6c)" : "var(--ds-txt,#0f0f1a)",
                  cursor: "pointer",
                }}
              >
                <span>{t("afterLesson.paid", { amount: formatPrice(price, lesson.currency ?? "UAH") })}</span>
                {paid ? <Check className="h-5 w-5" /> : <span style={{ color: "var(--sub,#62677E)" }}>{t("afterLesson.markPaid")}</span>}
              </button>
            )}
          </>
        )}
        {isGroup && (
          <p className="text-[14px]" style={{ color: "var(--sub,#62677E)" }}>{t("afterLesson.groupNote")}</p>
        )}

        <button
          type="button"
          disabled={busy || !loaded}
          onClick={() => void saveAndNext()}
          className="flex h-[50px] w-full items-center justify-center gap-2 rounded-[14px] text-[16px] font-bold"
          style={{ background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", border: "none", cursor: busy ? "wait" : "pointer" }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {index + 1 < lessons.length ? t("afterLesson.saveAndNext") : t("afterLesson.saveAndFinish")}
          {index + 1 < lessons.length && <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={skipLesson}
            className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[12px] text-[15px] font-bold"
            style={{ background: "var(--ds-surface,#fff)", color: "var(--sub,#62677E)", border: "1px solid var(--ds-border,#eceef3)", cursor: "pointer" }}
          >
            <SkipForward className="h-4 w-4" />
            {t("afterLesson.skip")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void cancelLesson()}
            className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[12px] text-[15px] font-bold"
            style={{ background: "var(--ds-surface,#fff)", color: "var(--danger-text,#B3261E)", border: "1px solid rgba(179,38,30,.3)", cursor: "pointer" }}
          >
            <X className="h-4 w-4" />
            {t("afterLesson.didNotHappen")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
