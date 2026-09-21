import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { X, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubjectMultiSelect } from "@/components/SubjectMultiSelect";
import { PayoutScheduleCard } from "@/components/PayoutScheduleCard";
import { supabase } from "@/integrations/supabase/client";
import { currencySymbol } from "@/lib/currency";

/**
 * Ставка репетитора (менеджер школи) — ЄДИНА форма на весь застосунок (UI CANON).
 *
 * 21.09, розрив у флоу, який побачила власниця: Telegram каже «ставку не
 * задано», картка уроку теж каже — а дотик відкривав ДЕТАЛІ уроку, де ставки
 * немає. Тепер картка уроку, деталі уроку, «Люди» і кнопка з дайджесту
 * (`/people?open=<id>&rate=1`) відкривають ЦЮ форму напряму, з репетитором і
 * предметом уроку вже підставленими.
 *
 * Що вона гарантує (FINANCE INVARIANTS):
 *  - дані читає САМА при відкритті (tutor_details.subjects ∪ tutor_subject_rates),
 *    тож із будь-якої сторінки показує свіжі ставки, а не кеш списку;
 *  - предмет уроку, з якого прийшли, ДОДАЄТЬСЯ в список, якщо його ще нема, —
 *    без цього менеджер не побачив би, де саме бракує суми;
 *  - збереження ЗАВЖДИ тягне `backfill_tutor_payouts_for_tutor`: ставка,
 *    поставлена після того, як уроки вже є, доїжджає до їхніх виплат — це
 *    і є те, заради чого людина сюди прийшла;
 *  - ставки з таблиці, яких нема в tutor_details.subjects, НЕ втрачаються
 *    (стара форма в «Людях» показувала лише subjects і при збереженні тихо
 *    видаляла решту).
 */
export interface TutorRateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tutorId: string | null;
  /** Предмет уроку, з якого прийшли: стане рядком форми, якщо його ще немає. */
  presetSubject?: string | null;
  /** Після успішного запису (сторінка перечитує уроки й побачить виплату). */
  onSaved?: (result: { backfilled: number }) => void;
}

const normSubj = (x: string) => x.toLowerCase().replace(/\s+/g, " ").replace(/[\s.]+$/g, "").trim();

/** Обʼєднати списки предметів без дублів «Англійська» / «англійська». */
export function mergeSubjects(...lists: Array<Array<string | null | undefined>>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const raw of list) {
      const s = (raw ?? "").trim();
      if (!s) continue;
      const k = normSubj(s);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
  }
  return out;
}

export function TutorRateDialog({ open, onOpenChange, tutorId, presetSubject, onSaved }: TutorRateDialogProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [rates, setRates] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || !tutorId) return;
    let alive = true;
    setLoading(true);
    (async () => {
      // Мережа може зависнути (ловили на стенді): після 8 с показуємо форму з
      // предметом уроку і кажемо, що чинні ставки не прочитались, — а не
      // крутимо спінер без виходу.
      const loaded = await Promise.race([
        Promise.all([
          supabase.from("tutor_details").select("subjects, rate_per_lesson").eq("user_id", tutorId).maybeSingle(),
          supabase.from("tutor_subject_rates").select("subject, rate_per_lesson").eq("tutor_id", tutorId),
        ]),
        new Promise<null>((r) => setTimeout(() => r(null), 8000)),
      ]);
      if (!alive) return;
      const td = loaded?.[0] ?? { data: null, error: true };
      const sr = loaded?.[1] ?? { data: null, error: true };
      if (td.error || sr.error) {
        toast.error(t("people.tutorRateLoadFailed"));
      }
      const rateRows = (sr.data ?? []) as Array<{ subject: string; rate_per_lesson: number }>;
      const list = mergeSubjects((td.data as { subjects?: string[] } | null)?.subjects ?? [], rateRows.map((r) => r.subject), [presetSubject]);
      const byNorm = new Map(rateRows.map((r) => [normSubj(r.subject), r.rate_per_lesson]));
      const next: Record<string, string> = {};
      for (const s of list) {
        const v = byNorm.get(normSubj(s));
        next[s] = v != null && Number(v) > 0 ? String(v) : "";
      }
      setSubjects(list);
      setRates(next);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [open, tutorId, presetSubject, t]);

  useEffect(() => {
    if (!open) { setSubjects([]); setRates({}); setLoading(false); setSaving(false); }
  }, [open]);

  const save = async () => {
    if (!tutorId || saving || loading) return;
    if (subjects.length === 0) {
      toast.error(t("people.selectAtLeastOneSubject"));
      return;
    }
    const parsed: Array<{ subject: string; rate: number }> = [];
    for (const s of subjects) {
      const raw = (rates[s] ?? "").trim();
      if (raw === "") {
        toast.error(t("people.enterRateForSubject", { subject: s }));
        return;
      }
      const v = parseFloat(raw);
      if (isNaN(v) || v < 0) {
        toast.error(t("people.invalidRateForSubject", { subject: s }));
        return;
      }
      parsed.push({ subject: s, rate: v });
    }
    setSaving(true);
    try {
      // 1. Список предметів на tutor_details (rate_per_lesson = перша, як фолбек).
      const { error: tdErr } = await supabase
        .from("tutor_details")
        .upsert({ user_id: tutorId, rate_per_lesson: parsed[0].rate, subjects }, { onConflict: "user_id" });
      if (tdErr) {
        console.error("Failed to save tutor details", tdErr);
        toast.error(t("people.saveFailed"));
        return;
      }
      // 2. Ставка на кожен предмет.
      const rows = parsed.map((p) => ({ tutor_id: tutorId, subject: p.subject, rate_per_lesson: p.rate }));
      const { error: srErr } = await supabase.from("tutor_subject_rates").upsert(rows, { onConflict: "tutor_id,subject" });
      if (srErr) {
        console.error("Failed to save subject rates", srErr);
        toast.error(t("people.subjectRatesSaveFailed"));
        return;
      }
      // 3. Прибрати ставки предметів, яких у списку більше немає — порівняння
      // нормалізоване, інакше інше написання зносило чинну ставку.
      const keptNorm = new Set(subjects.map(normSubj));
      const { data: existingRates } = await supabase.from("tutor_subject_rates").select("subject").eq("tutor_id", tutorId);
      const toDelete = (existingRates ?? []).map((r) => r.subject as string).filter((subj) => !keptNorm.has(normSubj(subj)));
      if (toDelete.length > 0) {
        const { error: delErr } = await supabase.from("tutor_subject_rates").delete().eq("tutor_id", tutorId).in("subject", toDelete);
        if (delErr) console.warn("Failed to cleanup obsolete subject rates", delErr);
      }
      // 4. Ставка доїжджає до вже наявних невиплачених хабових уроків.
      // supabase.rpc не кидає виняток — помилка приходить полем error.
      let backfilled = 0;
      const { data: filled, error: bfErr } = await (supabase.rpc as any)("backfill_tutor_payouts_for_tutor", { _tutor_id: tutorId });
      if (bfErr) {
        console.error("backfill_tutor_payouts_for_tutor failed", bfErr);
        toast.error(t("people.payoutBackfillFailed", { msg: bfErr.message ?? "" }));
      } else if (typeof filled === "number" && filled > 0) {
        backfilled = filled;
        toast.success(t("people.payoutBackfilled", { count: filled }));
      }
      toast.success(t("people.saved"));
      onSaved?.({ backfilled });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent aria-describedby={undefined} className="w-full max-w-md p-0 gap-0 rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[92vh] flex flex-col [&>button.absolute]:hidden">
        <DialogTitle className="sr-only">{t("people.dialogTutorRateTitle")}</DialogTitle>
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden flex-shrink-0">
          <div className="h-1 w-9 rounded-full bg-border" />
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "12px 20px 10px", flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 20, letterSpacing: "-.01em", color: "var(--ds-txt,#0f0f1a)" }}>{t("people.dialogTutorRateTitle")}</div>
            <div style={{ fontSize: 14, color: "var(--sub,#62677E)", marginTop: 2, lineHeight: 1.4 }}>{t("people.dialogTutorRateDesc")}</div>
          </div>
          <button type="button" onClick={() => onOpenChange(false)} aria-label={t("common.close")}
            style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, border: "none", background: "var(--ds-bg,#F5F4F0)", color: "var(--sub,#62677E)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 overflow-y-auto flex-1 min-h-0" style={{ padding: "4px 20px 14px" }}>
          {loading ? (
            <div className="flex items-center justify-center py-8" aria-busy="true">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Ставки — ПЕРШИМИ: сюди людина приходить із картки «ставку не задано»,
                  і рядок без суми мусить бути на екрані одразу, а не під списком предметів. */}
              {subjects.length > 0 && (
                <div className="space-y-2">
                  <Label>{t("people.ratePerSubject")}</Label>
                  <p className="text-[14px] text-muted-foreground">{t("people.ratePerSubjectDesc")}</p>
                  <div className="space-y-2">
                    {subjects.map((subj, i) => {
                      const missing = (rates[subj] ?? "").trim() === "";
                      const firstMissing = missing && subjects.findIndex((x) => (rates[x] ?? "").trim() === "") === i;
                      return (
                        <div key={subj} className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm text-foreground" style={{ lineHeight: 1.25 }}>{subj}</div>
                            {/* Рядок без суми підписаний словами — саме за ним людина прийшла. */}
                            {missing && <div className="text-[13px] font-semibold text-warning">{t("people.rateMissingTag")}</div>}
                          </div>
                          <Input aria-label={`${t("people.ratePlaceholder")}: ${subj}`}
                            type="number"
                            min="0"
                            step="any"
                            inputMode="decimal"
                            autoFocus={firstMissing}
                            className="w-28 shrink-0"
                            style={missing ? { borderColor: "rgba(245,158,11,.75)" } : undefined}
                            value={rates[subj] ?? ""}
                            onChange={(e) => setRates((prev) => ({ ...prev, [subj]: e.target.value }))}
                            placeholder={t("people.ratePlaceholder")}
                          />
                          <span className="text-[14px] text-muted-foreground">{currencySymbol("UAH")}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div>
                <Label>{t("people.fieldSubjects")}</Label>
                <p className="text-[14px] text-muted-foreground mb-2">{t("people.clickToSelect")}</p>
                <SubjectMultiSelect
                  value={subjects}
                  onChange={(next) => {
                    setSubjects(next);
                    setRates((prev) => Object.fromEntries(next.map((subj) => [subj, prev[subj] ?? ""])));
                  }}
                />
              </div>
              {tutorId && <PayoutScheduleCard tutorId={tutorId} />}
            </>
          )}
        </div>
        <div style={{ flexShrink: 0, padding: "12px 20px 18px", borderTop: "0.5px solid var(--border, #f0f1f5)", background: "var(--ds-surface,#fff)", display: "flex", gap: 10 }}>
          <button type="button" onClick={() => onOpenChange(false)} disabled={saving}
            style={{ height: 50, padding: "0 18px", borderRadius: 14, border: "1px solid var(--ds-border,#eceef3)", background: "var(--ds-surface,#fff)", color: "var(--sub,#62677E)", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15, cursor: "pointer", flexShrink: 0 }}>
            {t("people.cancelBtn")}
          </button>
          <button type="button" onClick={save} disabled={saving || loading}
            style={{ flex: 1, height: 50, borderRadius: 14, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15.5, boxShadow: "0 8px 20px -8px rgba(43,191,170,.6)", opacity: saving || loading ? 0.7 : 1 }}>
            {saving ? t("people.savingBtn") : t("people.saveBtn")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default TutorRateDialog;
