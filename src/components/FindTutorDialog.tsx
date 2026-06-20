import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { HandHeart, Loader2, X, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { notifyManagers } from "@/lib/notifications";
import { useTranslation } from "react-i18next";
import { useSubjects } from "@/hooks/useSubjects";

interface Props {
  trigger?: React.ReactNode;
  onCreated?: () => void;
}

// Design system tokens (CSS vars are mostly absent in this app; mirror the handoff).
const TEAL = "#2BBFAA";
const TEAL_D = "#25a896";
const GRAD_TEAL = "linear-gradient(135deg,#2BBFAA,#25a896)";
const SHADOW_TEAL = "0 8px 20px -8px rgba(43,191,170,.6)";
const SHADOW_SM = "0 1px 2px rgba(15,15,26,.06)";
const TXT = "#0f0f1a";
const SUB = "#9398b0";
const MUTED = "#b0b4c8";
const BORDER = "#eceef3";
const GOLD = "#9a6a12";
const FONT = "Inter, system-ui, sans-serif";
// Emoji + hour ranges are locale-independent; the time NAMES come from i18n.
const TIME_META = [
  { emoji: "🌅", hours: "9–12" },
  { emoji: "☀️", hours: "12–17" },
  { emoji: "🌆", hours: "17–21" },
];

/**
 * Запит на підбір репетитора (FindA · «Структурований»). Каркас = форма учня (SF_A):
 * bottom-sheet, header+✕, чипи предметів (обраний = teal-капсула), золота картка бюджету,
 * чипи рівня, кружечки днів + чипи часу, золота нотатка побажань, один teal CTA.
 * Поля 1:1 з tutor_referral_requests; чипи — лише UX поверх текстових колонок.
 */
export function FindTutorDialog({ trigger, onCreated }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { subjects } = useSubjects();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState("");
  const [budget, setBudget] = useState("");
  const [days, setDays] = useState<string[]>([]);
  const [times, setTimes] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [otherOpen, setOtherOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [subjFocus, setSubjFocus] = useState(false);
  const [notesFocus, setNotesFocus] = useState(false);

  const levels = t("findTutor.levels", { returnObjects: true }) as string[];
  const budgets = t("findTutor.budgets", { returnObjects: true }) as string[];
  const dayLabels = t("findTutor.days", { returnObjects: true }) as string[];
  const timeNames = t("findTutor.timeNames", { returnObjects: true }) as string[];

  const subjectNames = useMemo(() => (subjects ?? []).map((s) => s.name), [subjects]);
  const quickSubjects = useMemo(
    () => subjectNames.filter((s) => s !== subject).slice(0, 6),
    [subjectNames, subject],
  );
  const matches = useMemo(
    () =>
      subjectNames
        .filter((s) => (!draft || s.toLowerCase().includes(draft.toLowerCase())) && s !== subject)
        .slice(0, 6),
    [subjectNames, draft, subject],
  );

  const reset = () => {
    setSubject(""); setLevel(""); setBudget(""); setDays([]); setTimes([]);
    setMessage(""); setOtherOpen(false); setDraft("");
  };
  const toggle = (arr: string[], set: (v: string[]) => void, v: string) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const pickSubject = (s: string) => { setSubject(s.trim()); setDraft(""); setOtherOpen(false); };

  const submit = async () => {
    if (!user) return;
    if (!subject.trim()) {
      toast.error(t("findTutor.subjectRequired"));
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("tutor_referral_requests").insert({
      student_id: user.id,
      subject: subject.trim(),
      preferred_level: level.trim() || null,
      budget_note: budget.trim() || null,
      preferred_days: days.length ? days.join(", ") : null,
      preferred_times: times.length ? times.join(", ") : null,
      message: message.trim() || null,
      source: "self_service",
    });
    setSubmitting(false);
    if (error) {
      console.error(error);
      toast.error(t("findTutor.requestFailed"));
      return;
    }
    toast.success(t("findTutor.requestSent"));
    const studentName = user.email?.split("@")[0] || t("shared.student");
    void notifyManagers({
      type: "tutor_request",
      title: t("notifications.tutorRequestTitle", { name: studentName, subject: subject.trim() }),
      link: "/referrals",
    });
    setOpen(false);
    reset();
    onCreated?.();
  };

  const lbl = (text: string, opts?: { req?: boolean; hint?: string }) => (
    <div style={{ marginBottom: 10, display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ fontFamily: FONT, fontWeight: 800, fontSize: 17, color: TXT }}>
        {text}{opts?.req && <span style={{ color: TEAL }}> *</span>}
      </span>
      {opts?.hint && <span style={{ fontFamily: FONT, fontSize: 14, color: MUTED }}>{opts.hint}</span>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline">
            <HandHeart className="mr-2 h-4 w-4" />
            {t("findTutor.dialogTitle")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="w-full max-w-lg p-0 gap-0 rounded-t-[26px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[92vh] flex flex-col [&>button.absolute]:hidden">
        {/* Drag handle (mobile) */}
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden flex-shrink-0">
          <div style={{ width: 38, height: 4, borderRadius: 999, background: "rgba(15,15,26,.14)" }} />
        </div>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "16px 20px 12px", flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 22, letterSpacing: "-.01em", color: TXT }}>
              {t("findTutor.headerTitle")}
            </div>
            <div style={{ fontSize: 14.5, color: SUB, marginTop: 4, lineHeight: 1.45 }}>
              {t("findTutor.headerSub")}
            </div>
          </div>
          <button onClick={() => setOpen(false)} aria-label={t("findTutor.cancelBtn")}
            style={{ width: 44, height: 44, borderRadius: 13, flexShrink: 0, border: "none", background: "#F5F4F0", color: SUB, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 20px 14px", display: "flex", flexDirection: "column", gap: 22 }}>
          {/* 1 · Subject (main accent) */}
          <div>
            {lbl(t("findTutor.subjectQuestion"), { req: true })}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {subject && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 50, padding: "0 12px 0 18px", borderRadius: 15, background: GRAD_TEAL, color: "#fff", boxShadow: SHADOW_TEAL, fontFamily: FONT, fontWeight: 800, fontSize: 18 }}>
                  {subject}
                  <button onClick={() => setSubject("")} aria-label={t("findTutor.removeSubject")}
                    style={{ width: 30, height: 30, borderRadius: 999, border: "none", cursor: "pointer", background: "rgba(255,255,255,.25)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <X size={16} strokeWidth={2.6} />
                  </button>
                </span>
              )}
              {quickSubjects.map((s) => (
                <button key={s} onClick={() => pickSubject(s)}
                  style={{ minHeight: 50, padding: "0 18px", borderRadius: 15, cursor: "pointer", fontFamily: FONT, fontWeight: 700, fontSize: 17, background: "#fff", color: TXT, border: `1.5px solid ${BORDER}`, boxShadow: SHADOW_SM }}>
                  {s}
                </button>
              ))}
              <button onClick={() => setOtherOpen((v) => !v)}
                style={{ minHeight: 50, padding: "0 18px 0 15px", borderRadius: 15, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, fontFamily: FONT, fontWeight: 700, fontSize: 17, border: `1.5px ${otherOpen ? "solid" : "dashed"} ${otherOpen ? TEAL : BORDER}`, background: otherOpen ? "var(--teal-l,#f0fdf9)" : "#fff", color: otherOpen ? TEAL_D : SUB }}>
                <Plus size={18} strokeWidth={2.4} />{t("findTutor.otherSubject")}
              </button>
            </div>
            {otherOpen && (
              <div style={{ marginTop: 12, padding: 14, borderRadius: 16, background: "#fbfbfc", border: `1px solid ${BORDER}` }}>
                <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                  placeholder={t("findTutor.otherSubjectPlaceholder")}
                  onFocus={() => setSubjFocus(true)} onBlur={() => setSubjFocus(false)}
                  onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { e.preventDefault(); pickSubject(draft); } }}
                  style={{ width: "100%", height: 52, borderRadius: 14, padding: "0 16px", fontSize: 16, fontFamily: FONT, color: TXT, boxSizing: "border-box", outline: "none", background: "#fff", border: `1.5px solid ${subjFocus ? TEAL : BORDER}`, boxShadow: subjFocus ? "0 0 0 3px rgba(43,191,170,.12)" : "none" }} />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                  {matches.map((s) => (
                    <button key={s} onClick={() => pickSubject(s)}
                      style={{ minHeight: 44, padding: "0 16px", borderRadius: 999, cursor: "pointer", border: `1px dashed ${BORDER}`, background: "#fff", color: SUB, fontFamily: FONT, fontWeight: 600, fontSize: 15 }}>
                      {s}
                    </button>
                  ))}
                  {draft.trim() && !subjectNames.some((s) => s.toLowerCase() === draft.trim().toLowerCase()) && (
                    <button onClick={() => pickSubject(draft)}
                      style={{ minHeight: 44, padding: "0 16px", borderRadius: 999, cursor: "pointer", border: "none", background: GRAD_TEAL, color: "#fff", fontFamily: FONT, fontWeight: 700, fontSize: 15 }}>
                      + «{draft.trim()}»
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 2 · Budget (gold card) */}
          <div style={{ borderRadius: 18, padding: 16, background: "linear-gradient(135deg,#FFF7E6,#FFEFD0)", border: "1px solid rgba(245,181,68,.4)" }}>
            <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 16, color: GOLD, marginBottom: 12 }}>
              {t("findTutor.budgetCardTitle")}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {budgets.map((b) => {
                const on = budget === b;
                return (
                  <button key={b} onClick={() => setBudget(on ? "" : b)}
                    style={{ minHeight: 50, padding: "0 18px", borderRadius: 14, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, fontFamily: FONT, fontWeight: 800, fontSize: 17, background: on ? "#fff" : "rgba(255,255,255,.55)", color: on ? GOLD : "#b08a3a", border: `1.5px solid ${on ? "#F5B544" : "rgba(245,181,68,.5)"}`, boxShadow: on ? "0 4px 12px -6px rgba(245,181,68,.6)" : "none" }}>
                    <span style={{ fontSize: 15 }}>₴</span>{b}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3 · Level */}
          <div>
            {lbl(t("findTutor.levelTitle"))}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {levels.map((l) => {
                const on = level === l;
                return (
                  <button key={l} onClick={() => setLevel(on ? "" : l)}
                    style={{ minHeight: 50, padding: "0 20px", borderRadius: 15, cursor: "pointer", fontFamily: FONT, fontWeight: 700, fontSize: 17, background: on ? "var(--teal-l,#f0fdf9)" : "#fff", color: on ? TEAL_D : TXT, border: `1.5px solid ${on ? TEAL : BORDER}`, boxShadow: on ? "none" : SHADOW_SM }}>
                    {l}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4 · When (days + times) */}
          <div>
            {lbl(t("findTutor.scheduleTitle"), { hint: t("findTutor.scheduleHint") })}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
                {dayLabels.map((d) => {
                  const on = days.includes(d);
                  return (
                    <button key={d} onClick={() => toggle(days, setDays, d)}
                      style={{ width: 50, height: 50, borderRadius: 999, cursor: "pointer", fontFamily: FONT, fontWeight: 700, fontSize: 16, background: on ? GRAD_TEAL : "#fff", color: on ? "#fff" : TXT, border: `1.5px solid ${on ? "transparent" : BORDER}`, boxShadow: on ? SHADOW_TEAL : SHADOW_SM, flexShrink: 0 }}>
                      {d}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {timeNames.map((n, i) => {
                  const on = times.includes(n);
                  return (
                    <button key={n} onClick={() => toggle(times, setTimes, n)}
                      style={{ minHeight: 50, padding: "8px 18px", borderRadius: 15, cursor: "pointer", display: "inline-flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: 2, fontFamily: FONT, fontWeight: 700, fontSize: 17, lineHeight: 1.1, background: on ? "var(--teal-l,#f0fdf9)" : "#fff", color: on ? TEAL_D : TXT, border: `1.5px solid ${on ? TEAL : BORDER}`, boxShadow: on ? "none" : SHADOW_SM }}>
                      <span>{TIME_META[i]?.emoji} {n}</span>
                      <span style={{ fontFamily: FONT, fontWeight: 600, fontSize: 14, color: on ? TEAL_D : MUTED }}>{TIME_META[i]?.hours}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 5 · Wishes (gold note) */}
          <div>
            {lbl(t("findTutor.wishesTitle"), { hint: t("findTutor.wishesHint") })}
            <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1500}
              placeholder={t("findTutor.wishesPlaceholder")}
              onFocus={() => setNotesFocus(true)} onBlur={() => setNotesFocus(false)}
              style={{ width: "100%", borderRadius: 14, padding: "13px 16px", fontSize: 16, fontFamily: FONT, color: TXT, boxSizing: "border-box", outline: "none", resize: "none", lineHeight: 1.5, background: notesFocus ? "#fff" : "#FFFCF4", border: `1.5px solid ${notesFocus ? "#F5B544" : "rgba(245,181,68,.35)"}`, boxShadow: notesFocus ? "0 0 0 3px rgba(245,181,68,.16)" : "none" }} />
          </div>
        </div>

        {/* Footer */}
        <div style={{ flexShrink: 0, padding: "14px 20px 20px", borderTop: `1px solid ${BORDER}`, background: "#fff", display: "flex", gap: 10 }}>
          <button onClick={() => setOpen(false)}
            style={{ height: 54, padding: "0 22px", borderRadius: 15, border: `1.5px solid ${BORDER}`, background: "#fff", color: SUB, fontFamily: FONT, fontWeight: 700, fontSize: 16, cursor: "pointer" }}>
            {t("findTutor.cancelBtn")}
          </button>
          <button onClick={submit} disabled={submitting}
            style={{ flex: 1, height: 54, borderRadius: 15, border: "none", background: GRAD_TEAL, color: "#fff", fontFamily: FONT, fontWeight: 700, fontSize: 17, cursor: "pointer", boxShadow: SHADOW_TEAL, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: submitting ? 0.7 : 1 }}>
            {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send size={19} strokeWidth={2.1} />}
            {t("findTutor.submitBtn")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
