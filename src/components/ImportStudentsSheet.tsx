import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCoreLock } from "@/hooks/useCoreLock";
import {
  IMPORT_CURRENCY,
  parseStudentList,
  netDebtAndPrepay,
  scheduleToStarts,
  type ParsedStudent,
  type ImportWarning,
} from "@/lib/importStudents";
import { formatPrice } from "@/lib/currency";
import { logEvent } from "@/lib/analytics";
import { Loader2 } from "lucide-react";

/** Скільки тижнів розкладу створюємо наперед (рішення власниці 07.09: 4). */
export const IMPORT_SCHEDULE_WEEKS = 4;

/**
 * «Перенести все, що є» (05.09 — учні; 07.09 — борги, передоплати, розклад,
 * контакти). Репетиторка тримає учнів у зошиті/нотатках/таблиці; переносити
 * по одному — ті самі пів години, на яких помирав тріал. Тут: вставила текст
 * (або таблицю з Excel) → превʼю з розбором → одна кнопка. Запис іде через
 * ОДИН серверний RPC на учня (import_student_bundle), який усередині кличе
 * канонічні add_or_link_independent_student / update_lesson_details_safe /
 * wallet_topup — жодного паралельного шляху створення (UI CANON).
 *
 * Замок (рішення 07.09): самі імена — завжди безкоштовно (це веде до
 * грошового «ага»); борги/передоплати/розклад після простроченого тріалу —
 * PaywallSheet, як і будь-який інший грошовий запис. Сервер перевіряє те саме.
 */
export function ImportStudentsSheet({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onImported?: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const lock = useCoreLock();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const rows = useMemo(() => parseStudentList(text), [text]);
  const valid = rows.filter((r) => !r.error);
  const broken = rows.filter((r) => r.error);

  const hasMoneyOrSchedule = (r: ParsedStudent) =>
    r.debtAmount !== null || r.debtLessons !== null || r.prepayLessons !== null || r.prepayAmount !== null || r.schedule.length > 0;
  const needsPro = valid.some(hasMoneyOrSchedule);

  // Підсумок для кнопки: борги (нетто), уроків на 4 тижні.
  const summary = useMemo(() => {
    let debt = 0;
    let lessons = 0;
    let prepay = 0;
    for (const r of valid) {
      const n = netDebtAndPrepay(r);
      debt += n.debtAmount + (r.price ?? 0) * n.debtLessons;
      prepay += n.prepayAmount + (r.price ?? 0) * n.prepayLessons;
      lessons += r.schedule.length * IMPORT_SCHEDULE_WEEKS;
    }
    return { debt, prepay, lessons };
  }, [valid]);

  const runImport = async () => {
    if (lock.locked && needsPro) { lock.openPaywall(); return; }
    if (!user || valid.length === 0 || busy) return;
    setBusy(true);
    setProgress({ done: 0, total: valid.length });
    let added = 0;
    let linked = 0;
    let failed = 0;
    let debtTotal = 0;
    let scheduled = 0;
    const notes: Array<{ student_id: string; note: string }> = [];
    // Послідовно, не Promise.all: RPC створює профілі й уроки, і паралельний
    // шквал лише збільшує шанс гонок/лімітів; 20 учнів = кілька секунд.
    for (let i = 0; i < valid.length; i++) {
      const r = valid[i];
      const net = netDebtAndPrepay(r);
      const starts = scheduleToStarts(r.schedule, IMPORT_SCHEDULE_WEEKS).map((d) => d.toISOString());
      try {
        // cast: import_student_bundle потрапляє у згенеровані типи після міграції
        const { data, error } = await (supabase as any).rpc("import_student_bundle", {
          _first_name: r.firstName,
          _last_name: r.lastName,
          _email: r.email ?? "",
          _phone: r.phone ?? "",
          _telegram: r.telegram ?? "",
          _subject: r.subject ?? t("importStudents.defaultSubject"),
          _price: r.price ?? 0,
          _currency: IMPORT_CURRENCY,
          _debt_amount: net.debtAmount,
          _debt_lessons: net.debtLessons,
          _prepay_lessons: net.prepayLessons,
          _prepay_amount: net.prepayAmount,
          _lesson_starts: starts,
          _duration_minutes: r.durationMinutes ?? 60,
          _wallet_note: t("importStudents.walletNote"),
        });
        if (error || !data) {
          const msg = String(error?.message ?? "");
          if (/SUBSCRIPTION_REQUIRED/.test(msg)) { setBusy(false); setProgress(null); lock.openPaywall(); return; }
          failed++;
        } else {
          const d = data as { student_id?: string; action?: string; debt_total?: number; scheduled?: number };
          if (d.action === "linked") linked++; else added++;
          debtTotal += Number(d.debt_total ?? 0);
          scheduled += Number(d.scheduled ?? 0);
          if (r.note && d.student_id) notes.push({ student_id: d.student_id, note: r.note });
        }
      } catch {
        failed++;
      }
      setProgress({ done: i + 1, total: valid.length });
    }
    // Нерозпізнані хвости («мама платить 1 числа») — у приватну нотатку про
    // учня (та сама tutor_student_notes, що й у формі додавання), best-effort.
    for (const n of notes) {
      await (supabase as any)
        .from("tutor_student_notes")
        .upsert({ tutor_id: user.id, student_id: n.student_id, notes: n.note }, { onConflict: "tutor_id,student_id" });
    }
    setBusy(false);
    setProgress(null);
    logEvent("students_imported", { added, linked, failed, total: valid.length, debtTotal, scheduled });
    if (added + linked > 0) {
      const parts: string[] = [];
      if (debtTotal > 0) parts.push(t("importStudents.doneDebts", { sum: formatPrice(debtTotal, IMPORT_CURRENCY) }));
      if (scheduled > 0) parts.push(t("importStudents.doneLessons", { count: scheduled }));
      if (failed > 0) parts.push(t("importStudents.doneFailed", { count: failed }));
      toast.success(t("importStudents.doneTitle", { count: added + linked }), {
        description: parts.length ? parts.join(" · ") : undefined,
      });
      setText("");
      onOpenChange(false);
      onImported?.();
    } else {
      toast.error(t("importStudents.allFailed"));
    }
  };

  const warnText = (w: ImportWarning) => t(`importStudents.warn_${w}`);
  const dayName = (wd: number) => t(`importStudents.day${wd}`);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent
        aria-describedby={undefined}
        className="w-full max-w-md p-0 gap-0 rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[92vh] flex flex-col [&>button.absolute]:hidden"
      >
        <DialogTitle className="sr-only">{t("importStudents.title")}</DialogTitle>
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden flex-shrink-0">
          <div className="h-1 w-9 rounded-full bg-border" />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: "12px 20px 20px" }}>
          <p className="text-[20px] font-extrabold text-foreground" style={{ fontFamily: "Inter, system-ui, sans-serif", letterSpacing: "-.01em" }}>
            📋 {t("importStudents.title")}
          </p>
          <p className="mt-1 text-[14px] text-muted-foreground">{t("importStudents.subtitle")}</p>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label={t("importStudents.title")}
            placeholder={t("importStudents.placeholder")}
            rows={6}
            disabled={busy}
            className="mt-3 w-full rounded-xl border-[0.5px] border-input bg-background p-3 text-[15px] text-foreground focus:outline-none"
            style={{ resize: "vertical", minHeight: 120 }}
          />

          {rows.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-[13px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sub,#666b82)" }}>
                {t("importStudents.previewLabel", { count: valid.length })}
              </p>
              {valid.slice(0, 40).map((r, i) => {
                const net = netDebtAndPrepay(r);
                const chips: string[] = [];
                if (r.subject) chips.push(r.subject);
                chips.push(r.price !== null ? formatPrice(r.price, IMPORT_CURRENCY) : t("importStudents.noPrice"));
                if (net.debtAmount > 0) chips.push(t("importStudents.chipDebt", { sum: formatPrice(net.debtAmount, IMPORT_CURRENCY) }));
                if (net.debtLessons > 0) chips.push(t("importStudents.chipDebtLessons", { count: net.debtLessons }));
                if (net.prepayLessons > 0) chips.push(t("importStudents.chipPrepayLessons", { count: net.prepayLessons }));
                if (net.prepayAmount > 0) chips.push(t("importStudents.chipPrepay", { sum: formatPrice(net.prepayAmount, IMPORT_CURRENCY) }));
                if (r.schedule.length > 0) chips.push(r.schedule.map((s) => `${dayName(s.weekday)} ${s.time}`).join(", "));
                if (r.phone) chips.push("📞");
                if (r.email) chips.push("✉️");
                // Аудит 09.09: нерозпізнаний хвіст їде в приватну нотатку про учня,
                // але в превʼю його не було — репетитор бачив, що зрозуміли предмет,
                // ціну й час, а свій коментар не бачив і не знав, чи він узагалі
                // прийнявся. Ехо тим самим патерном, що 📞 і ✉️.
                if (r.note) chips.push(`📝 ${r.note}`);
                return (
                  <div key={i} className="text-[14px] text-foreground">
                    <div className="flex items-start gap-2">
                      <span aria-hidden style={{ color: "var(--teal,#2BBFAA)" }}>✓</span>
                      <span className="min-w-0">
                        <span className="font-semibold">{r.firstName} {r.lastName}</span>
                        <span className="text-muted-foreground"> · {chips.join(" · ")}</span>
                      </span>
                    </div>
                    {r.warnings.map((w) => (
                      <p key={w} className="ml-6 text-[13px] text-amber-700 dark:text-amber-400">⚠️ {warnText(w)}</p>
                    ))}
                  </div>
                );
              })}
              {valid.length > 40 && <p className="text-[13px] text-muted-foreground">{t("importStudents.moreRows", { count: valid.length - 40 })}</p>}
              {broken.map((r, i) => (
                <div key={`b${i}`} className="flex items-center gap-2 text-[14px] text-muted-foreground">
                  <span aria-hidden>⚠️</span>
                  <span className="min-w-0 truncate">{r.raw} — {t("importStudents.lineSkipped")}</span>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={runImport}
            disabled={busy || valid.length === 0}
            className="mt-4 flex h-[50px] w-full items-center justify-center gap-2 rounded-[14px] text-[16px] font-semibold text-white"
            style={{
              background: "linear-gradient(135deg,#2BBFAA,#25a896)",
              opacity: busy || valid.length === 0 ? 0.5 : 1,
              border: "none",
              cursor: busy || valid.length === 0 ? "default" : "pointer",
            }}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy && progress
              ? t("importStudents.progress", { done: progress.done, total: progress.total })
              : t("importStudents.addBtn", { count: valid.length })}
          </button>
          {valid.length > 0 && (summary.debt > 0 || summary.lessons > 0 || summary.prepay > 0) && (
            <p className="mt-2 text-[13px] text-muted-foreground">
              {[
                summary.debt > 0 ? t("importStudents.sumDebt", { sum: formatPrice(summary.debt, IMPORT_CURRENCY) }) : null,
                summary.prepay > 0 ? t("importStudents.sumPrepay", { sum: formatPrice(summary.prepay, IMPORT_CURRENCY) }) : null,
                summary.lessons > 0 ? t("importStudents.sumLessons", { count: summary.lessons, weeks: IMPORT_SCHEDULE_WEEKS }) : null,
              ].filter(Boolean).join(" · ")}
            </p>
          )}
          <p className="mt-2 text-[13px] text-muted-foreground">{t("importStudents.priceHint")}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
