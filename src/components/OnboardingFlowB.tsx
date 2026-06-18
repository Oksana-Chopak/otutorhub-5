/**
 * OnboardingFlowB — "Один крок за раз" — повноекранний онбординг репетитора.
 * Дизайн-референс: design_handoff_onboarding_flowB/README.md
 *
 * Виправлення v2:
 * - Desktop: max-w-[430px] mx-auto (не розтягується на весь екран)
 * - Subject: chip multi-select (не combobox dropdown)
 * - Student: inline форма (не QuickAddStudentDialog dialog)
 * - Lesson:  inline форма (не QuickLessonDialog dialog)
 * - Availability: спрощено — day toggles + hours input
 * - Telegram: кнопка #229ED9 з plane SVG + DigestRow компоненти
 * - XP total: 950 (не 875)
 * - State: pickedSubjects → student prefill; addedStudentId → lesson/chat
 */
import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Check } from "lucide-react";
import confetti from "canvas-confetti";
import { StepVictoryOverlay } from "@/components/StepVictoryOverlay";
import type { StepProgress } from "@/components/OnboardingContent";
import i18nInstance from "@/i18n";

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  teal: "#2BBFAA", tealD: "#25a896", tealL: "#f0fdf9",
  dark: "#0f0f1a", bg: "#F5F4F0", surface: "#ffffff",
  txt: "#0f0f1a", sub: "#9398b0", muted: "#b0b4c8", border: "#eceef3",
  success: "#0CA678", warn: "#F59E0B", tg: "#229ED9",
  display: "'Inter', system-ui, sans-serif",
  body: "'Plus Jakarta Sans', system-ui, sans-serif",
};

const TOTAL_XP = 950;

// ── Step definitions ──────────────────────────────────────────────────────────
interface StepDef {
  id: number; emoji: string;
  group: "essential" | "setup" | "bonus";
  action: string; xp: number;
  title: string; desc: string; cta: string; hint: string;
  autoKey?: keyof StepProgress;
}

const ALL_STEPS: StepDef[] = [
  { id:0, emoji:"📚", group:"essential", action:"subject",      xp:25,  title:"step.subject.title",      desc:"step.subject.desc",      cta:"step.subject.cta",    hint:"step.subject.hint",      autoKey:"hasSubject" },
  { id:1, emoji:"👋", group:"essential", action:"student",      xp:50,  title:"step.student.title",      desc:"step.student.desc",      cta:"step.student.cta",    hint:"step.student.hint",      autoKey:"hasStudent" },
  { id:2, emoji:"📅", group:"essential", action:"lesson",       xp:75,  title:"step.lesson.title",       desc:"step.lesson.desc",       cta:"step.lesson.cta",     hint:"step.lesson.hint",       autoKey:"hasLesson" },
  { id:3, emoji:"🔔", group:"setup",     action:"proRules",     xp:75,  title:"step.proRules.title",     desc:"step.proRules.desc",     cta:"step.proRules.cta",   hint:"step.proRules.hint",     autoKey:"hasPaymentRules" },
  { id:4, emoji:"✅", group:"setup",     action:"autoMark",     xp:50,  title:"step.autoMark.title",     desc:"step.autoMark.desc",     cta:"step.autoMark.cta",   hint:"step.autoMark.hint",     autoKey:"hasAutoCompleteChoice" },
  { id:5, emoji:"🕐", group:"bonus",     action:"availability", xp:75,  title:"step.availability.title", desc:"step.availability.desc", cta:"step.availability.cta", hint:"step.availability.hint", autoKey:"hasAvailability" },
  { id:6, emoji:"📲", group:"setup",     action:"telegram",     xp:75,  title:"step.telegram.title",     desc:"step.telegram.desc",     cta:"step.telegram.cta",   hint:"step.telegram.hint" },
  { id:7, emoji:"🎁", group:"bonus",     action:"referral",     xp:100, title:"step.referral.title",     desc:"step.referral.desc",     cta:"step.referral.cta",  hint:"step.referral.hint",     autoKey:"hasReferral" },
  { id:8, emoji:"🎥", group:"bonus",     action:"zoom",         xp:50,  title:"step.zoom.title",         desc:"step.zoom.desc",         cta:"step.zoom.cta",      hint:"step.zoom.hint",         autoKey:"hasMeetingUrl" },
  { id:9, emoji:"💬", group:"bonus",     action:"chat",         xp:50,  title:"step.chat.title",         desc:"step.chat.desc",         cta:"step.chat.cta",      hint:"step.chat.hint",         autoKey:"hasChat" },
  { id:10,emoji:"💰", group:"bonus",     action:"finance",      xp:100, title:"step.finance.title",      desc:"step.finance.desc",      cta:"step.finance.cta",   hint:"step.finance.hint",      autoKey:"hasPaidLesson" },
  { id:11,emoji:"📆", group:"bonus",     action:"calendar",     xp:75,  title:"step.calendar.title",     desc:"step.calendar.desc",     cta:"step.calendar.cta",  hint:"step.calendar.hint",     autoKey:"hasGoogleCalendar" },
  { id:12,emoji:"✨", group:"bonus",     action:"ai",           xp:150, title:"step.ai.title",           desc:"step.ai.desc",           cta:"step.ai.cta",     hint:"step.ai.hint" },
];

const CORE  = ALL_STEPS.filter(s => s.group !== "bonus");
const BONUS = ALL_STEPS.filter(s => s.group === "bonus");

// ── Confetti ──────────────────────────────────────────────────────────────────
function burst(kind: "step" | "final") {
  const colors = [T.teal, T.success, T.warn, "#5b6bf5", "#FF7A59"];
  if (kind === "final") {
    confetti({ particleCount: 150, spread: 80, origin: { y: 0.5 }, colors });
    setTimeout(() => confetti({ particleCount: 80, angle: 60,  spread: 55, origin: { x: 0 }, colors }), 180);
    setTimeout(() => confetti({ particleCount: 80, angle: 120, spread: 55, origin: { x: 1 }, colors }), 340);
  } else {
    confetti({ particleCount: 46, spread: 52, origin: { y: 0.4 }, colors, scalar: 0.85 });
  }
}

// ── UI atoms ──────────────────────────────────────────────────────────────────
function Btn({ children, onClick, disabled, className = "" }: any) {
  return (
    <button
      onClick={onClick} disabled={disabled}
      className={cn("w-full h-[52px] rounded-2xl font-bold text-white text-base transition-transform active:scale-[.97]",
        disabled ? "opacity-40 cursor-not-allowed" : "shadow-lg", className)}
      style={{ background: disabled ? T.muted : `linear-gradient(135deg,${T.teal},${T.tealD})`,
               fontFamily: T.display, boxShadow: disabled ? "none" : "0 8px 20px -8px rgba(43,191,170,.6)" }}>
      {children}
    </button>
  );
}

function GhostBtn({ children, onClick, style = {} }: any) {
  return (
    <button onClick={onClick}
      className="px-3 py-2 rounded-xl text-sm font-medium transition-colors hover:bg-black/5"
      style={{ fontFamily: T.display, color: T.sub, ...style }}>
      {children}
    </button>
  );
}

function XpSticker({ xp }: { xp: number }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[13px] font-bold"
      style={{ background: "#fef9ec", color: "#92400e", outline: "1px solid #fbbf24", fontFamily: T.display }}>
      ⭐ {xp} XP
    </span>
  );
}

function Medallion({ emoji }: { emoji: string }) {
  return (
    <div className="ob-float mx-auto flex items-center justify-center text-[44px]"
      style={{ width: 92, height: 92, borderRadius: 27, fontSize: 44,
               background: `linear-gradient(135deg,${T.teal},${T.tealD})`,
               boxShadow: "0 18px 40px -14px rgba(43,191,170,.7)" }}>
      {emoji}
    </div>
  );
}

function ProgressSegments({ total, active }: { total: number; active: number }) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="flex-1 h-1.5 rounded-full overflow-hidden"
          style={{ background: "rgba(15,15,26,.08)" }}>
          <div className="h-full rounded-full"
            style={{ width: i < active ? "100%" : i === active ? "45%" : "0%",
                     background: T.teal, transition: "width .45s cubic-bezier(.34,1.56,.64,1)" }} />
        </div>
      ))}
    </div>
  );
}

const SUBJECTS_LIST = [
  i18nInstance.t("onboardingFlowB.subjectOptionEnglish"),
  i18nInstance.t("onboardingFlowB.subjectOptionMath"),
  i18nInstance.t("onboardingFlowB.subjectOptionUkrainian"),
  i18nInstance.t("onboardingFlowB.subjectOptionPhysics"),
  i18nInstance.t("onboardingFlowB.subjectOptionChemistry"),
  i18nInstance.t("onboardingFlowB.subjectOptionGerman"),
  i18nInstance.t("onboardingFlowB.subjectOptionProgramming"),
  i18nInstance.t("onboardingFlowB.subjectOptionBiology"),
  i18nInstance.t("onboardingFlowB.subjectOptionGeography"),
  i18nInstance.t("onboardingFlowB.subjectOptionHistory"),
];
const DAYS_UA       = ["Пн","Вт","Ср","Чт","Пт","Сб","Нд"];

// ── Subject inline action ─────────────────────────────────────────────────────
function SubjectAction({ onComplete, user }: { onComplete: (subs: string[]) => void; user: any }) {
  const { t } = useTranslation();
  const [list, setList] = useState(SUBJECTS_LIST);
  const [sel, setSel]   = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [saving, setSaving] = useState(false);

  const toggle = (s: string) => setSel(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s]);

  const addCustom = () => {
    const v = custom.trim();
    if (!v) return;
    if (!list.some(x => x.toLowerCase() === v.toLowerCase())) setList(p => [...p, v]);
    if (!sel.some(x => x.toLowerCase() === v.toLowerCase()))  setSel(p => [...p, v]);
    setCustom("");
  };

  const save = async () => {
    if (!user || !sel.length) return;
    setSaving(true);
    await supabase.from("tutor_details").upsert(
      { user_id: user.id, subjects: sel }, { onConflict: "user_id" }
    );
    setSaving(false);
    onComplete(sel);
  };

  return (
    <div className="flex flex-col gap-4">
      <p style={{ color: T.sub, fontSize: 14.5, lineHeight: 1.45, margin: 0 }}>
        {t("onboardingFlowB.subjectIntro")}
      </p>
      <div className="flex flex-wrap gap-2">
        {list.map(s => (
          <button key={s} onClick={() => toggle(s)}
            className="h-[42px] px-4 rounded-full text-sm font-semibold transition-all"
            style={{
              border: sel.includes(s) ? `1.5px solid ${T.teal}` : `1px solid ${T.border}`,
              background: sel.includes(s) ? T.tealL : "#fff",
              color: sel.includes(s) ? T.tealD : T.txt,
              boxShadow: sel.includes(s) ? "0 2px 8px -4px rgba(43,191,170,.5)" : "none",
              fontFamily: T.body,
            }}>
            {s}
          </button>
        ))}
      </div>
      <div>
        <p className="text-[13px] font-bold uppercase tracking-wider mb-1.5" style={{ color: T.sub }}>{t("onboardingFlowB.subjectCustomLabel")}</p>
        <div className="flex gap-2">
          <Input value={custom} onChange={e => setCustom(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addCustom()}
            placeholder={t("onboardingFlowB.subjectCustomPlaceholder")}
            className="h-12 rounded-xl text-[15px]" style={{ flex: 1 }} />
          <button onClick={addCustom} disabled={!custom.trim()}
            className="h-12 w-12 rounded-xl font-bold text-lg flex-shrink-0 transition-colors"
            style={{ background: custom.trim() ? T.dark : "rgba(15,15,26,.1)", color: custom.trim() ? "#fff" : T.muted, border: "none" }}>
            +
          </button>
        </div>
      </div>
      <Btn disabled={!sel.length || saving} onClick={save}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : (sel.length ? t("onboardingFlowB.subjectSaveCount", { count: sel.length }) : t("onboardingFlowB.subjectSave"))}
      </Btn>
    </div>
  );
}

// ── Student inline action ─────────────────────────────────────────────────────
function StudentAction({ defaultSubject, onComplete, user }: {
  defaultSubject: string; onComplete: (id: string, name: string, subject: string) => void; user: any;
}) {
  const { t } = useTranslation();
  const [name,    setName]    = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  const [price,   setPrice]   = useState("");
  const [saving,  setSaving]  = useState(false);
  const ok = name.trim() && subject.trim() && price.trim();

  const save = async () => {
    if (!user || !ok) return;
    setSaving(true);
    const parts   = name.trim().split(/\s+/);
    const fn      = parts[0] ?? "";
    const ln      = parts.slice(1).join(" ");
    const newId   = crypto.randomUUID();

    const { error: profErr } = await supabase.from("profiles")
      .insert({ id: newId, first_name: fn, last_name: ln, is_pending: true } as any);
    if (profErr) { setSaving(false); toast.error(t("onboardingFlowB.studentSaveError")); return; }

    await supabase.from("user_roles").insert({ user_id: newId, role: "student" } as any);
    await supabase.from("student_rates").insert({
      tutor_id: user.id, student_id: newId, subject: subject.trim(),
      price_per_lesson: Number(price) || 0, source: "independent",
    } as any);
    await (supabase.from("student_details") as any).upsert({ user_id: newId }, { onConflict: "user_id" });

    setSaving(false);
    onComplete(newId, name.trim(), subject.trim());
  };

  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <Label className="text-[13px] font-bold uppercase tracking-wider mb-1.5 block" style={{ color: T.sub }}>{t("onboardingFlowB.studentNameLabel")}</Label>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder={t("onboardingFlowB.studentNamePlaceholder")} className="h-12 rounded-xl text-[15px]" />
      </div>
      <div className="flex gap-3">
        <div style={{ flex: 1.3 }}>
          <Label className="text-[13px] font-bold uppercase tracking-wider mb-1.5 block" style={{ color: T.sub }}>{t("onboardingFlowB.studentSubjectLabel")}</Label>
          <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder={t("onboardingFlowB.studentSubjectPlaceholder")} className="h-12 rounded-xl text-[15px]" />
          {defaultSubject && subject === defaultSubject && (
            <p className="text-[13px] font-semibold mt-1" style={{ color: T.tealD }}>{t("onboardingFlowB.studentSubjectPrefilled")}</p>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <Label className="text-[13px] font-bold uppercase tracking-wider mb-1.5 block" style={{ color: T.sub }}>{t("onboardingFlowB.studentPriceLabel")}</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-[15px] select-none pointer-events-none" style={{ color: T.sub }}>₴</span>
            <Input value={price} onChange={e => setPrice(e.target.value.replace(/\D/g, ""))}
              placeholder="500" inputMode="numeric"
              className="h-12 rounded-xl text-[15px] pl-7" />
          </div>
        </div>
      </div>
      <p className="text-[13px]" style={{ color: T.muted }}>{t("onboardingFlowB.studentInviteNote")}</p>
      <Btn disabled={!ok || saving} onClick={save}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : t("onboardingFlowB.studentSubmit")}
      </Btn>
    </div>
  );
}

// ── Lesson inline action ──────────────────────────────────────────────────────
function LessonAction({ studentId, studentName, subject, onComplete, user }: {
  studentId: string | null; studentName: string; subject: string;
  onComplete: (lessonId: string) => void; user: any;
}) {
  const { t } = useTranslation();
  const today = new Date().toISOString().split("T")[0];
  const [date,    setDate]    = useState(today);
  const [hour,    setHour]    = useState("");
  const [minute,  setMinute]  = useState("00");
  const [repeat,  setRepeat]  = useState(true);
  const [saving,  setSaving]  = useState(false);

  const HOURS   = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const MINUTES = ["00", "15", "30", "45"];
  const timeStr = hour ? `${hour}:${minute}` : "";
  const ok = Boolean(hour);

  const selStyle = (hasVal: boolean) => ({
    height: 48, borderRadius: 12, border: `1px solid ${hasVal ? T.teal : T.border}`,
    background: "#fbfbfc", padding: "0 12px", fontSize: 15, fontFamily: T.body,
    color: hasVal ? T.txt : T.muted, cursor: "pointer", outline: "none",
    appearance: "none" as const, WebkitAppearance: "none" as const,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%239398b0' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center", paddingRight: 36,
    width: "100%",
  });

  const saveLesson = async () => {
    if (!user || !ok) return;
    setSaving(true);
    const startsAt = new Date(`${date}T${hour}:${minute}:00`);
    const { data: created, error } = await supabase.from("lessons")
      .insert({
        tutor_id: user.id, student_id: studentId,
        subject: subject || t("onboardingFlowB.lessonDefaultSubject"),
        starts_at: startsAt.toISOString(),
        duration_minutes: 60, status: "scheduled" as const,
        created_by: user.id, source: "independent",
      } as any).select("id").single();

    if (!error && created) {
      await (supabase.from("lesson_details") as any).upsert(
        { lesson_id: created.id, student_price: 0, tutor_payout: 0,
          student_payment_status: "unpaid", tutor_payout_status: "unpaid" },
        { onConflict: "lesson_id" }
      );
      if (repeat) {
        for (let w = 1; w <= 3; w++) {
          const next = new Date(startsAt);
          next.setDate(next.getDate() + 7 * w);
          const { data: r } = await supabase.from("lessons")
            .insert({ tutor_id: user.id, student_id: studentId, subject: subject || t("onboardingFlowB.lessonDefaultSubject"),
              starts_at: next.toISOString(), duration_minutes: 60, status: "scheduled" as const,
              created_by: user.id, source: "independent" } as any)
            .select("id").single();
          if (r) {
            await (supabase.from("lesson_details") as any).upsert(
              { lesson_id: r.id, student_price: 0, tutor_payout: 0,
                student_payment_status: "unpaid", tutor_payout_status: "unpaid" },
              { onConflict: "lesson_id" }
            );
          }
        }
      }
      setSaving(false);
      onComplete(created.id);
    } else {
      setSaving(false);
      toast.error(t("onboardingFlowB.lessonSaveError"));
    }
  };

  return (
    <div className="flex flex-col gap-3.5">
      {/* Student pre-filled */}
      {studentName && (
        <div className="h-12 rounded-xl border flex items-center justify-between px-3 text-[15px]"
          style={{ borderColor: T.border, background: "#fbfbfc", color: T.txt }}>
          <span>{studentName}{subject ? ` · ${subject}` : ""}</span>
        </div>
      )}

      {/* Date */}
      <div>
        <Label className="text-[13px] font-bold uppercase tracking-wider mb-1.5 block" style={{ color: T.sub }}>{t("onboardingFlowB.lessonDateLabel")}</Label>
        <Input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="h-12 rounded-xl text-[15px]" />
      </div>

      {/* Time — custom 24h selects */}
      <div>
        <Label className="text-[13px] font-bold uppercase tracking-wider mb-1.5 block" style={{ color: T.sub }}>
          {t("onboardingFlowB.lessonTimeLabel")} {timeStr && <span style={{ color: T.tealD, fontWeight: 700 }}>· {timeStr}</span>}
        </Label>
        <div className="flex gap-2 items-center">
          <select value={hour} onChange={e => setHour(e.target.value)} style={selStyle(Boolean(hour))}>
            <option value="" disabled>{t("onboardingFlowB.lessonHourPlaceholder")}</option>
            {HOURS.map(h => (
              <option key={h} value={h}>{h}:00</option>
            ))}
          </select>
          <span className="text-xl font-bold flex-shrink-0" style={{ color: T.muted }}>:</span>
          <select value={minute} onChange={e => setMinute(e.target.value)} style={selStyle(Boolean(hour))}>
            {MINUTES.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        {!hour && (
          <p className="text-[13px] mt-1.5" style={{ color: T.muted }}>{t("onboardingFlowB.lessonTimeHint")}</p>
        )}
      </div>

      {/* Weekly repeat toggle */}
      <button onClick={() => setRepeat(v => !v)}
        className="flex items-center gap-2.5 text-sm font-medium py-1"
        style={{ background: "transparent", border: "none", cursor: "pointer", color: T.txt, fontFamily: T.body }}>
        <span className="flex-shrink-0 relative h-6 w-11 rounded-full transition-colors"
          style={{ background: repeat ? T.teal : "rgba(15,15,26,.15)" }}>
          <span className="absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white transition-all"
            style={{ left: repeat ? "calc(100% - 21px)" : "3px", boxShadow: "0 1px 3px rgba(0,0,0,.2)" }} />
        </span>
        {t("onboardingFlowB.lessonRepeatWeekly")}
      </button>

      <Btn disabled={!ok || saving} onClick={saveLesson}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : t("onboardingFlowB.lessonSubmit")}
      </Btn>
    </div>
  );
}

// ── ProRules inline action ────────────────────────────────────────────────────
function ProRulesAction({ onComplete, user }: { onComplete: () => void; user: any }) {
  const { t } = useTranslation();
  const { updateSettings } = useWorkspaceSettings();
  const [reminder, setReminder] = useState(true);
  const [mode,    setMode]    = useState<"prepaid"|"before_lesson"|"after_lesson">("before_lesson");
  const [days,    setDays]    = useState("1");
  const [hours,   setHours]   = useState("24");
  const [fee,     setFee]     = useState(0);
  const [saving,  setSaving]  = useState(false);

  const MODES = [
    { v: "prepaid"       as const, title: t("onboardingFlowB.proRulesModePrepaidTitle"),     desc: t("onboardingFlowB.proRulesModePrepaidDesc") },
    { v: "before_lesson" as const, title: t("onboardingFlowB.proRulesModeBeforeTitle"),      desc: t("onboardingFlowB.proRulesModeBeforeDesc") },
    { v: "after_lesson"  as const, title: t("onboardingFlowB.proRulesModeAfterTitle"),       desc: t("onboardingFlowB.proRulesModeAfterDesc") },
  ];

  const RadioCard = ({ v, title, desc }: any) => (
    <button onClick={() => setMode(v)}
      className="w-full text-left rounded-2xl p-3.5 flex items-start gap-3 transition-all"
      style={{ border: mode === v ? `1.5px solid ${T.teal}` : `1px solid ${T.border}`,
               background: mode === v ? T.tealL : "#fff" }}>
      <span className="w-5 h-5 rounded-full mt-0.5 flex-shrink-0 bg-white transition-all"
        style={{ border: mode === v ? `6px solid ${T.teal}` : `2px solid ${T.muted}`, boxSizing: "border-box" as const }} />
      <span>
        <span className="block font-bold text-[15px]" style={{ fontFamily: T.display }}>{title}</span>
        <span className="block text-[13px] mt-0.5 leading-snug" style={{ color: T.sub }}>{desc}</span>
      </span>
    </button>
  );

  const save = async () => {
    setSaving(true);
    await updateSettings({
      payment_reminder_enabled: reminder, payment_due_mode: mode as any,
      payment_due_days: Number(days), cancel_free_hours: Number(hours),
      cancel_fee_percent: fee, payment_rules_configured: true,
    } as any);
    setSaving(false);
    onComplete();
  };

  return (
    <div className="flex flex-col gap-4 overflow-y-auto">
      {/* Reminder toggle */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-bold text-[14.5px]" style={{ fontFamily: T.display }}>{t("onboardingFlowB.proRulesReminderTitle")}</p>
          <p className="text-[13px] mt-0.5 leading-snug" style={{ color: T.sub }}>{t("onboardingFlowB.proRulesReminderDesc")}</p>
        </div>
        <Switch checked={reminder} onCheckedChange={setReminder} />
      </div>
      {/* Mode */}
      <div style={{ opacity: reminder ? 1 : .5, pointerEvents: reminder ? "auto" : "none" }}>
        <p className="text-[13px] font-bold uppercase tracking-wider mb-2" style={{ color: T.sub }}>{t("onboardingFlowB.proRulesWhenLabel")}</p>
        <div className="flex flex-col gap-2">
          {MODES.map(o => <RadioCard key={o.v} {...o} />)}
        </div>
        {mode !== "prepaid" && (
          <div className="flex items-center gap-2.5 mt-3">
            <Input value={days} inputMode="numeric" onChange={e => setDays(e.target.value.replace(/\D/g,"").slice(0,2))}
              className="h-12 rounded-xl text-center text-[15px]" style={{ width: 76 }} />
            <span className="text-[13.5px]" style={{ color: T.sub }}>{mode === "before_lesson" ? t("onboardingFlowB.proRulesDaysBefore") : t("onboardingFlowB.proRulesDaysAfter")}</span>
          </div>
        )}
      </div>
      {/* Free cancel */}
      <div>
        <p className="text-[13px] font-bold uppercase tracking-wider mb-2" style={{ color: T.sub }}>{t("onboardingFlowB.proRulesFreeCancelLabel")}</p>
        <div className="flex items-center gap-2.5">
          <Input value={hours} inputMode="numeric" onChange={e => setHours(e.target.value.replace(/\D/g,"").slice(0,3))}
            className="h-12 rounded-xl text-center text-[15px]" style={{ width: 76 }} />
          <span className="text-[13.5px]" style={{ color: T.sub }}>{t("onboardingFlowB.proRulesHoursBefore")}</span>
        </div>
      </div>
      {/* Fee % */}
      <div>
        <p className="text-[13px] font-bold uppercase tracking-wider mb-2" style={{ color: T.sub }}>{t("onboardingFlowB.proRulesFeeLabel")}</p>
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(5,1fr)" }}>
          {[0,10,25,50,100].map(p => (
            <button key={p} onClick={() => setFee(p)}
              className="h-[46px] rounded-xl font-bold text-sm transition-all"
              style={{ fontFamily: T.display,
                       border: fee === p ? `1.5px solid ${T.teal}` : `1px solid ${T.border}`,
                       background: fee === p ? T.tealL : "#fff", color: fee === p ? T.tealD : T.txt }}>
              {p === 0 ? "Off" : `${p}%`}
            </button>
          ))}
        </div>
        <p className="text-[13px] mt-2 leading-snug" style={{ color: T.muted }}>
          {fee === 0 ? t("onboardingFlowB.proRulesFeeOffNote") : t("onboardingFlowB.proRulesFeeOnNote", { hours, fee })}
        </p>
      </div>
      <Btn disabled={saving} onClick={save}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : t("onboardingFlowB.proRulesSubmit")}
      </Btn>
    </div>
  );
}

// ── AutoMark inline action ────────────────────────────────────────────────────
function AutoMarkAction({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation();
  const { updateSettings } = useWorkspaceSettings();
  const [pick, setPick] = useState(0);
  const [saving, setSaving] = useState(false);

  const opts = [
    { title: t("onboardingFlowB.autoMarkAutoTitle"),   desc: t("onboardingFlowB.autoMarkAutoDesc") },
    { title: t("onboardingFlowB.autoMarkManualTitle"), desc: t("onboardingFlowB.autoMarkManualDesc") },
  ];

  const save = async () => {
    setSaving(true);
    await updateSettings({ auto_complete_lessons: pick === 0, auto_complete_prompted: true } as any);
    setSaving(false);
    onComplete();
  };

  return (
    <div className="flex flex-col gap-3">
      {opts.map((o, i) => (
        <button key={i} onClick={() => setPick(i)}
          className="w-full text-left rounded-2xl p-4 flex items-start gap-3 transition-all"
          style={{ border: pick === i ? `1.5px solid ${T.teal}` : `1px solid ${T.border}`,
                   background: pick === i ? T.tealL : "#fff" }}>
          <span className="w-5 h-5 rounded-full mt-0.5 flex-shrink-0 bg-white"
            style={{ border: pick === i ? `6px solid ${T.teal}` : `2px solid ${T.muted}`, boxSizing: "border-box" as const }} />
          <span>
            <span className="block font-bold text-[15px]" style={{ fontFamily: T.display }}>{o.title}</span>
            <span className="block text-[13px] mt-0.5 leading-snug" style={{ color: T.sub }}>{o.desc}</span>
          </span>
        </button>
      ))}
      <Btn disabled={saving} onClick={save}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : t("onboardingFlowB.autoMarkSubmit")}
      </Btn>
    </div>
  );
}

// ── Availability inline action ────────────────────────────────────────────────
function AvailabilityAction({ onComplete, user }: { onComplete: () => void; user: any }) {
  const { t } = useTranslation();
  const [selDays, setSelDays] = useState<string[]>(["Пн","Ср","Пт"]);
  const [fromH,   setFromH]   = useState("10:00");
  const [toH,     setToH]     = useState("20:00");
  const [saving,  setSaving]  = useState(false);

  const toggle = (d: string) => setSelDays(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d]);

  const timeToMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  const save = async () => {
    if (!user || !selDays.length) return;
    setSaving(true);
    await supabase.from("tutor_availability_weekly").delete().eq("tutor_id", user.id);
    const rows = selDays.map(d => ({
      tutor_id: user.id,
      weekday: DAYS_UA.indexOf(d),
      start_minute: timeToMin(fromH),
      end_minute: timeToMin(toH),
    }));
    await supabase.from("tutor_availability_weekly").insert(rows as any);
    setSaving(false);
    onComplete();
  };

  return (
    <div className="flex flex-col gap-4">
      <p style={{ color: T.sub, fontSize: 14.5, lineHeight: 1.45, margin: 0 }}>{t("onboardingFlowB.availabilityIntro")}</p>
      <div className="flex gap-1.5 flex-wrap">
        {DAYS_UA.map((d, di) => (
          <button key={d} onClick={() => toggle(d)}
            className="font-bold text-sm transition-all"
            style={{ width: 44, height: 44, borderRadius: 12, border: "none",
                     background: selDays.includes(d) ? T.teal : "#fff",
                     color: selDays.includes(d) ? "#fff" : T.txt,
                     outline: selDays.includes(d) ? "none" : `1px solid ${T.border}`,
                     fontFamily: T.display }}>
            {t(`onboardingFlowB.weekday.${di}`)}
          </button>
        ))}
      </div>
      <div>
        <p className="text-[13px] font-bold uppercase tracking-wider mb-2" style={{ color: T.sub }}>{t("onboardingFlowB.availabilityHoursLabel")}</p>
        <div className="flex items-center gap-2">
          <Input type="time" value={fromH} onChange={e => setFromH(e.target.value)} className="h-12 rounded-xl text-[15px] flex-1" />
          <span style={{ color: T.muted, fontFamily: T.display, flexShrink: 0 }}>—</span>
          <Input type="time" value={toH}   onChange={e => setToH(e.target.value)}   className="h-12 rounded-xl text-[15px] flex-1" />
        </div>
      </div>
      <Btn disabled={!selDays.length || saving} onClick={save}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : t("onboardingFlowB.availabilitySubmit")}
      </Btn>
    </div>
  );
}

// ── Telegram inline action ────────────────────────────────────────────────────
function TelegramAction({ onComplete, user }: { onComplete: () => void; user: any }) {
  const { t } = useTranslation();
  const { updateSettings } = useWorkspaceSettings();
  const [daily,      setDaily]      = useState(true);
  const [weekly,     setWeekly]     = useState(true);
  const [remind1h,   setRemind1h]   = useState(true);
  const [remind15m,  setRemind15m]  = useState(true);
  const [botUrl,     setBotUrl]     = useState("");

  useEffect(() => {
    if (!user) return;
    supabase.functions.invoke("telegram-bot-info").then(({ data }) => {
      if (data?.bot_username) {
        setBotUrl(`https://t.me/${data.bot_username}?start=${user.id}`);
      } else {
        setBotUrl(`https://t.me/oTutorHubBot?start=${user.id}`);
      }
    }).catch(() => {
      setBotUrl(`https://t.me/oTutorHubBot?start=${user.id}`);
    });
  }, [user?.id]);

  const openBot = async () => {
    await updateSettings({
      telegram_daily_digest:    daily,
      telegram_weekly_digest:   weekly,
      telegram_reminder_1h:     remind1h,
      telegram_reminder_15m:    remind15m,
    } as any);
    window.open(botUrl || `https://t.me/oTutorHubBot`, "_blank", "noopener");
  };

  const DigestRow = ({ on, setOn, emoji, title, desc }: any) => (
    <div className="flex items-center gap-3 rounded-2xl p-3.5 transition-colors"
      style={{ border: `1px solid ${T.border}`, background: on ? T.tealL : "#fff" }}>
      <span className="text-2xl flex-shrink-0">{emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-[14.5px]" style={{ fontFamily: T.display }}>{title}</p>
        <p className="text-[13px] leading-snug mt-0.5" style={{ color: T.sub }}>{desc}</p>
      </div>
      <Switch checked={on} onCheckedChange={setOn} />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <p style={{ color: T.sub, fontSize: 14.5, lineHeight: 1.45, margin: 0 }}>
        {t("onboardingFlowB.telegramIntro")}
      </p>
      <div className="flex flex-col gap-2.5">
        <DigestRow on={daily}     setOn={setDaily}     emoji="🌅" title={t("onboardingFlowB.telegramDailyTitle")}
          desc={t("onboardingFlowB.telegramDailyDesc")} />
        <DigestRow on={weekly}    setOn={setWeekly}    emoji="📊" title={t("onboardingFlowB.telegramWeeklyTitle")}
          desc={t("onboardingFlowB.telegramWeeklyDesc")} />
        <DigestRow on={remind1h}  setOn={setRemind1h}  emoji="🔔" title={t("onboardingFlowB.telegramRemind1hTitle")}
          desc={t("onboardingFlowB.telegramRemind1hDesc")} />
        <DigestRow on={remind15m} setOn={setRemind15m} emoji="⏰" title={t("onboardingFlowB.telegramRemind15mTitle")}
          desc={t("onboardingFlowB.telegramRemind15mDesc")} />
      </div>
      {/* Telegram blue button with plane icon */}
      <button onClick={openBot}
        className="w-full h-[52px] rounded-2xl font-bold text-white flex items-center justify-center gap-2.5 transition-transform active:scale-[.97]"
        style={{ background: T.tg, fontFamily: T.display, fontSize: 16,
                 boxShadow: "0 8px 20px -8px rgba(34,158,217,.6)" }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
          <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/>
        </svg>
        {t("onboardingFlowB.telegramConnect")}
      </button>
      <p className="text-center text-[13px]" style={{ color: T.muted }}>{t("onboardingFlowB.telegramBotHint")}</p>
      <GhostBtn onClick={onComplete}>{t("onboardingFlowB.telegramSkip")}</GhostBtn>
    </div>
  );
}

// ── Bonus: Finance (LessonCard anatomy) ───────────────────────────────────────
function FinanceBonus({ lessonId, studentName, subject, onComplete, navigate }: {
  lessonId: string | null; studentName: string; subject: string; onComplete: () => void; navigate: any;
}) {
  const { t } = useTranslation();
  const [paid, setPaid] = useState(false);
  const [saving, setSaving] = useState(false);
  const price = 500;

  const togglePaid = async () => {
    if (!lessonId) { setPaid(v => !v); return; }
    setSaving(true);
    await (supabase.from("lesson_details") as any).upsert(
      { lesson_id: lessonId, student_payment_status: paid ? "unpaid" : "paid" },
      { onConflict: "lesson_id" }
    );
    setPaid(v => !v);
    setSaving(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <p style={{ color: T.sub, fontSize: 14.5, lineHeight: 1.45, margin: 0 }}>
        {t("onboardingFlowB.financeIntro")}
      </p>
      {/* LessonCard anatomy */}
      <div className="relative rounded-xl bg-white overflow-hidden transition-colors"
        style={{ border: `1px solid ${T.border}`, borderLeft: `4px solid ${paid ? T.success : T.teal}` }}>
        {/* Status pill */}
        <div className="absolute left-3 top-2 rounded-full px-2.5 py-0.5 text-[13px] font-bold"
          style={{ fontFamily: T.display,
                   background: paid ? "rgba(12,166,120,.15)" : "rgba(43,191,170,.15)",
                   color: paid ? T.success : T.tealD,
                   outline: `1px solid ${paid ? "rgba(12,166,120,.3)" : "rgba(43,191,170,.3)"}` }}>
          {paid ? t("onboardingFlowB.financeStatusDone") : t("onboardingFlowB.financeStatusScheduled")}
        </div>
        <div className="flex items-stretch pt-8 pb-3.5 px-3.5">
          {/* Time block */}
          <div className="flex flex-col justify-center" style={{ minWidth: 88 }}>
            <span className="font-black text-[21px] leading-tight tracking-tight" style={{ fontFamily: T.display }}>{t("onboardingFlowB.financeToday")}</span>
            <span className="font-black text-[21px] leading-tight tracking-tight" style={{ fontFamily: T.display }}>18:00</span>
            <span className="text-[13px] uppercase tracking-wide mt-1" style={{ color: T.muted }}>{t("onboardingFlowB.financeDuration")}</span>
          </div>
          {/* Divider */}
          <div className="w-px mx-3.5" style={{ background: T.border }} />
          {/* Content */}
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            <span className="font-bold text-base" style={{ fontFamily: T.display }}>{studentName || t("onboardingFlowB.demoStudentName")}</span>
            <span className="text-sm mt-0.5" style={{ color: T.sub }}>{subject || t("onboardingFlowB.demoSubject")}</span>
          </div>
        </div>
        {/* Payment toggle row */}
        <button onClick={togglePaid} disabled={saving}
          className="w-full flex items-center justify-between px-3.5 py-3 border-t transition-colors"
          style={{ borderColor: T.border, background: paid ? "rgba(12,166,120,.06)" : "transparent",
                   borderRadius: "0 0 11px 11px" }}>
          <span className="flex items-center gap-2 text-sm font-semibold"
            style={{ color: paid ? T.success : T.sub }}>
            <span className="text-base">{paid ? "✓" : "⏳"}</span>
            {paid ? t("onboardingFlowB.financePaid") : t("onboardingFlowB.financeAwaiting")}
          </span>
          <span className="font-black text-base" style={{ fontFamily: T.display, color: paid ? T.success : T.txt }}>
            {price} ₴
          </span>
        </button>
      </div>
      {paid ? (
        <Btn onClick={() => { onComplete(); navigate("/finances"); }}>
          {t("onboardingFlowB.financeGoToFinances")}
        </Btn>
      ) : (
        <p className="text-center text-sm font-medium py-2" style={{ color: T.muted }}>
          {t("onboardingFlowB.financeTapHint")}
        </p>
      )}
    </div>
  );
}

// ── Bonus: Chat ───────────────────────────────────────────────────────────────
function ChatBonus({ studentId, studentName, subject, onComplete, navigate }: {
  studentId: string | null; studentName: string; subject: string;
  onComplete: () => void; navigate: any;
}) {
  const { t } = useTranslation();
  const firstLetter = (studentName || "А").charAt(0).toUpperCase();
  return (
    <div className="flex flex-col gap-4">
      {/* Student card */}
      <div className="flex items-center gap-3 rounded-2xl p-3.5"
        style={{ border: `1px solid ${T.border}`, background: "#fbfbfc" }}>
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-black text-base flex-shrink-0"
          style={{ background: `linear-gradient(135deg,${T.teal},${T.tealD})`, fontFamily: T.display }}>
          {firstLetter}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-[15px]" style={{ fontFamily: T.display }}>{studentName || t("onboardingFlowB.demoStudentName")}</p>
          <p className="text-[13px]" style={{ color: T.sub }}>{t("onboardingFlowB.chatStudentSubtitle", { subject: subject || t("onboardingFlowB.demoSubject") })}</p>
        </div>
        <span className="text-[13px] font-bold px-2.5 py-1 rounded-full"
          style={{ background: T.tealL, color: T.tealD, outline: `1px solid ${T.teal}66`, fontFamily: T.display }}>
          {t("onboardingFlowB.chatNewBadge")}
        </span>
      </div>
      {/* Chat preview */}
      <div className="rounded-2xl p-3.5 flex flex-col gap-2.5"
        style={{ background: "#fbfbfc", border: `1px solid ${T.border}` }}>
        <div className="self-start max-w-[82%] rounded-[14px_14px_14px_4px] px-3.5 py-2.5 text-sm bg-white"
          style={{ border: `1px solid ${T.border}` }}>
          {t("onboardingFlowB.chatPreviewIncoming")}
        </div>
        <div className="self-end max-w-[82%] rounded-[14px_14px_4px_14px] px-3.5 py-2.5 text-sm text-white"
          style={{ background: T.teal }}>
          {t("onboardingFlowB.chatPreviewOutgoing")}
        </div>
      </div>
      <p className="text-sm" style={{ color: T.muted }}>
        {t("onboardingFlowB.chatDescription")}
      </p>
      <Btn onClick={() => {
        onComplete();
        navigate(studentId ? `/chats?with=${studentId}` : "/chats");
      }}>
        {t("onboardingFlowB.chatStartWith", { name: studentName?.split(" ")[0] || t("onboardingFlowB.chatStudentFallback") })}
      </Btn>
    </div>
  );
}

// ── Bonus: Referral ───────────────────────────────────────────────────────────
function ReferralBonus({ user, onComplete }: { user: any; onComplete: () => void }) {
  const { t } = useTranslation();
  const [link, setLink]     = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user) return;
    (supabase.from("referral_codes") as any).select("code").eq("tutor_id", user.id).limit(1)
      .then(({ data }: any) => {
        if (data?.[0]?.code) setLink(`${window.location.origin}/join/${data[0].code}`);
        else setLink(`${window.location.origin}/join`);
      });
  }, [user?.id]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <span className="text-[13px] font-bold px-2.5 py-1 rounded-full" style={{ background: "#dcfce7", color: "#166534" }}>{t("onboardingFlowB.referralBadgeYou")}</span>
        <span className="text-[13px] font-bold px-2.5 py-1 rounded-full" style={{ background: T.tealL, color: T.tealD }}>{t("onboardingFlowB.referralBadgeFriend")}</span>
      </div>
      <p style={{ color: T.sub, fontSize: 14.5, lineHeight: 1.45, margin: 0 }}>
        {t("onboardingFlowB.referralDescription")}
      </p>
      <div className="flex gap-2">
        <div className="h-12 flex-1 rounded-xl border flex items-center px-3 text-sm font-semibold truncate"
          style={{ borderColor: T.border, background: "#fbfbfc", color: T.tealD }}>
          {link || "otutorhub.com/join/..."}
        </div>
        <button onClick={() => { navigator.clipboard?.writeText(link); setCopied(true); }}
          className="h-12 px-4 rounded-xl font-bold text-sm text-white flex-shrink-0"
          style={{ background: copied ? T.success : T.dark, fontFamily: T.display }}>
          {copied ? t("onboardingFlowB.referralCopied") : t("onboardingFlowB.referralCopy")}
        </button>
      </div>
      <Btn onClick={onComplete}>{t("onboardingFlowB.referralDone")}</Btn>
    </div>
  );
}

// ── Bonus: Zoom ───────────────────────────────────────────────────────────────
function ZoomBonus({ user, onComplete }: { user: any; onComplete: () => void }) {
  const { t } = useTranslation();
  const [url, setUrl]     = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!user || !url.trim()) return;
    setSaving(true);
    await (supabase.from("tutor_student_defaults") as any).upsert(
      { tutor_id: user.id, default_meeting_url: url.trim() }, { onConflict: "tutor_id" }
    );
    setSaving(false);
    onComplete();
  };

  return (
    <div className="flex flex-col gap-4">
      <p style={{ color: T.sub, fontSize: 14.5, lineHeight: 1.45, margin: 0 }}>
        {t("onboardingFlowB.zoomIntro")}
      </p>
      <div>
        <Label className="text-[13px] font-bold uppercase tracking-wider mb-1.5 block" style={{ color: T.sub }}>{t("onboardingFlowB.zoomUrlLabel")}</Label>
        <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://zoom.us/j/..."
          className="h-12 rounded-xl text-[15px]" />
      </div>
      <Btn disabled={!url.trim() || saving} onClick={save}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : t("onboardingFlowB.zoomSubmit")}
      </Btn>
    </div>
  );
}

// ── Bonus: Calendar ───────────────────────────────────────────────────────────
function CalendarBonus({ user, onComplete }: { user: any; onComplete: () => void }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const connect = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("google-calendar-auth", {
      body: { return_to: `${window.location.origin}/onboarding?calendar=connected` },
    });
    if (error || !data?.redirect_url) {
      toast.error(t("onboardingFlowB.calendarConnectError")); setLoading(false); return;
    }
    window.location.href = data.redirect_url;
  };

  return (
    <div className="flex flex-col gap-4">
      <p style={{ color: T.sub, fontSize: 14.5, lineHeight: 1.45, margin: 0 }}>
        {t("onboardingFlowB.calendarIntro")}
      </p>
      <button onClick={connect} disabled={loading}
        className="h-[52px] rounded-2xl border flex items-center justify-center gap-2.5 font-bold text-sm transition-transform active:scale-[.97]"
        style={{ border: `1px solid ${T.border}`, background: "#fff", fontFamily: T.display, color: T.txt }}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
          <svg width="20" height="20" viewBox="0 0 48 48">
            <path fill="#4285F4" d="M45 24c0-1.6-.1-2.8-.4-4H24v7.5h12c-.2 2-1.6 5-4.6 7l7 5.4C42.6 36.7 45 31 45 24z"/>
            <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-7-5.4c-1.9 1.3-4.4 2.2-7.5 2.2-5.8 0-10.7-3.9-12.4-9.1l-7.3 5.6C7.5 41.2 15.1 46 24 46z"/>
            <path fill="#FBBC05" d="M11.6 28.4c-.5-1.4-.7-2.9-.7-4.4s.3-3 .7-4.4l-7.3-5.6C2.8 17 2 20.4 2 24s.8 7 2.3 10z"/>
            <path fill="#EA4335" d="M24 10.8c3.2 0 6 1.1 8.2 3.2l6.2-6.2C34.9 4.1 29.9 2 24 2 15.1 2 7.5 6.8 4.3 14l7.3 5.6C13.3 14.7 18.2 10.8 24 10.8z"/>
          </svg>
        )}
        {t("onboardingFlowB.calendarConnect")}
      </button>
    </div>
  );
}

// ── Bonus: AI ─────────────────────────────────────────────────────────────────
function AiBonus({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-[13px] flex items-center justify-center text-xl flex-shrink-0" style={{ background: T.tealL }}>🎙</div>
        <div>
          <p className="font-bold text-[15px]" style={{ fontFamily: T.display }}>{t("onboardingFlowB.aiHeaderTitle")}</p>
          <p className="text-[13px]" style={{ color: T.sub }}>{t("onboardingFlowB.aiHeaderDesc")}</p>
        </div>
      </div>
      <p className="text-sm leading-relaxed" style={{ color: T.sub }}>
        {t("onboardingFlowB.aiInstructions")}
      </p>
      <div className="flex flex-col gap-2">
        {[
          { e: "📝", t: t("onboardingFlowB.aiSummaryTitle"),    d: t("onboardingFlowB.aiSummaryDesc") },
          { e: "✅", t: t("onboardingFlowB.aiActionItemsTitle"), d: t("onboardingFlowB.aiActionItemsDesc") },
          { e: "🎬", t: t("onboardingFlowB.aiRecordingTitle"),   d: t("onboardingFlowB.aiRecordingDesc") },
        ].map(x => (
          <div key={x.t} className="flex items-center gap-3 rounded-xl p-3"
            style={{ border: `1px solid ${T.border}`, background: "#fbfbfc" }}>
            <span className="text-[18px]">{x.e}</span>
            <div className="flex-1">
              <p className="font-bold text-[13.5px]" style={{ fontFamily: T.display }}>{x.t}</p>
              <p className="text-[13px]" style={{ color: T.sub }}>{x.d}</p>
            </div>
          </div>
        ))}
      </div>
      <Btn onClick={onComplete}>{t("onboardingFlowB.aiDone")}</Btn>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function OnboardingFlowB({ onFinish }: { onFinish: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user }  = useAuth();
  const { settings, updateSettings, loading: wsLoading } = useWorkspaceSettings();

  const [idx, setIdx]             = useState(0);
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const [progress, setProgress]   = useState<StepProgress>({
    hasSubject:false, hasStudent:false, hasLesson:false, hasAvailability:false,
    hasReferral:false, hasMeetingUrl:false, hasChat:false, hasPaidLesson:false,
    hasPaymentRules:false, hasAutoCompleteChoice:false, hasGoogleCalendar:false,
  });
  const [progressLoading, setProgressLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [victory, setVictory]     = useState<{ emoji:string; title:string; xp:number; isFinal:boolean }|null>(null);
  const [activeBonus, setActiveBonus] = useState<StepDef|null>(null);

  // Cross-step state
  const [pickedSubjects,  setPickedSubjects]  = useState<string[]>([]);
  const [addedStudentId,  setAddedStudentId]  = useState<string|null>(null);
  const [addedStudentName,setAddedStudentName]= useState("");
  const [addedSubject,    setAddedSubject]    = useState("");
  const [createdLessonId, setCreatedLessonId] = useState<string|null>(null);

  // Restore saved step
  useEffect(() => {
    if (!wsLoading && settings) {
      const s = (settings as any).onboarding_step ?? 0;
      if (s > 0 && s <= CORE.length) setIdx(s);
    }
  }, [wsLoading]);

  // Progress loading
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const safe = async <T,>(p: PromiseLike<T>, fb: T): Promise<T> => { try { return await p; } catch { return fb; } };
    const patch = (p: Partial<StepProgress>) => { if (!cancelled) setProgress(prev => ({ ...prev, ...p })); };

    (async () => {
      setProgressLoading(true);
      const [studRes, lesRes] = await Promise.all([
        safe(supabase.from("student_rates").select("student_id").eq("tutor_id", user.id).eq("source","independent").limit(1), {data:[]} as any),
        safe(supabase.from("lessons").select("id,meeting_url").eq("tutor_id", user.id).eq("source","independent").limit(50), {data:[]} as any),
      ]);
      const les = (lesRes as any).data ?? [];
      patch({
        hasStudent: ((studRes as any).data?.length ?? 0) > 0,
        hasLesson: les.length > 0,
        hasMeetingUrl: les.some((l:any) => l.meeting_url?.trim()),
        hasPaymentRules: Boolean((settings as any)?.payment_rules_configured),
        hasAutoCompleteChoice: Boolean((settings as any)?.auto_complete_prompted),
      });
      if (!cancelled) setProgressLoading(false);

      safe(supabase.from("tutor_details").select("subjects").eq("user_id", user.id).maybeSingle(), null as any)
        .then((r: any) => { if (r?.data?.subjects?.length > 0) patch({ hasSubject: true }); });
      safe(supabase.from("tutor_availability_weekly").select("id").eq("tutor_id", user.id).limit(1), {data:[]} as any)
        .then((r: any) => patch({ hasAvailability: (r.data?.length ?? 0) > 0 }));
      safe(supabase.from("referral_codes" as any).select("id").eq("tutor_id", user.id).limit(1), {data:[]} as any)
        .then((r: any) => patch({ hasReferral: (r.data?.length ?? 0) > 0 }));
      safe(supabase.from("chat_threads").select("id").eq("tutor_id", user.id).limit(1), {data:[]} as any)
        .then((r: any) => patch({ hasChat: (r.data?.length ?? 0) > 0 }));
      safe(supabase.from("google_calendar_tokens" as any).select("id").eq("user_id", user.id).limit(1), {data:[]} as any)
        .then((r: any) => patch({ hasGoogleCalendar: (r.data?.length ?? 0) > 0 }));
    })();
    return () => { cancelled = true; };
  }, [user?.id, reloadKey, settings?.onboarding_completed]);

  const reload = useCallback(() => setReloadKey(k => k+1), []);

  // Google Calendar OAuth return
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("calendar") === "connected") {
      toast.success(t("onboardingFlowB.calendarConnectedToast"));
      url.searchParams.delete("calendar");
      window.history.replaceState({}, "", url.pathname + url.search);
      reload();
    }
  }, []);

  const stepIsDone = (id: number): boolean => {
    const s = ALL_STEPS.find(x => x.id === id);
    if (!s?.autoKey) return completed.has(id);
    return Boolean(progress[s.autoKey]) || completed.has(id);
  };

  const earnedXP = ALL_STEPS.filter(s => stepIsDone(s.id)).reduce((sum, s) => sum + s.xp, 0);

  const markDone = (id: number) => {
    setCompleted(p => new Set([...p, id]));
    const s = ALL_STEPS.find(x => x.id === id)!;
    const isFinal = id === CORE[CORE.length-1].id;
    burst(isFinal ? "final" : "step");
    setVictory({ emoji: s.emoji, title: t(`onboardingFlowB.${s.title}`), xp: s.xp, isFinal });
    reload();
  };

  const advance = async () => {
    const next = idx + 1;
    setIdx(next);
    await updateSettings({ onboarding_step: next } as any);
  };

  // ── CSS animations (injected once) ─────────────────────────────────────────
  const styles = `
    @keyframes ob-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-7px)} }
    @keyframes ob-bounce { 0%{transform:scale(.5);opacity:0} 70%{transform:scale(1.15)} 100%{transform:scale(1);opacity:1} }
    @keyframes ob-step-in { from{transform:translateX(22px);opacity:.25} to{transform:translateX(0);opacity:1} }
    @keyframes ob-sheet { from{transform:translateY(34px);opacity:.35} to{transform:translateY(0);opacity:1} }
    .ob-float  { animation: ob-float  3.2s ease-in-out infinite; }
    .ob-bounce { animation: ob-bounce  .55s cubic-bezier(.34,1.56,.64,1) both; }
    .ob-step-in{ animation: ob-step-in .36s cubic-bezier(.32,.72,0,1) both; }
    .ob-sheet  { animation: ob-sheet   .34s cubic-bezier(.32,.72,0,1) both; }
    @media (prefers-reduced-motion:reduce) { .ob-float,.ob-bounce,.ob-step-in,.ob-sheet { animation:none; } }
  `;

  // ── CELEBRATION SCREEN ──────────────────────────────────────────────────────
  if (idx >= CORE.length) {
    const bonusDone = BONUS.filter(s => stepIsDone(s.id)).length;
    return (
      <>
        <style>{styles}</style>
        {victory && <StepVictoryOverlay {...victory} onDone={() => setVictory(null)} />}

        <div className="min-h-screen" style={{ background: T.bg, fontFamily: T.body }}>
          {/* Centered container — phone width on desktop */}
          <div className="max-w-[430px] mx-auto px-5 pb-6">
            <div className="pt-14 pb-6 text-center">
              <div className="ob-bounce text-[72px] leading-none">🎉</div>
              <h1 className="mt-4 text-[27px] font-black tracking-tight" style={{ fontFamily: T.display, letterSpacing: "-0.02em" }}>
                {t("onboardingFlowB.celebrationTitle")}
              </h1>
              <p className="mt-2 text-[14.5px] leading-relaxed px-6" style={{ color: T.sub }}>
                {t("onboardingFlowB.celebrationSubtitle")}
              </p>
              <div className="mt-4 inline-flex">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold"
                  style={{ background: "#fef9ec", color: "#92400e", outline: "1.5px solid #fbbf24", fontFamily: T.display }}>
                  {t("onboardingFlowB.celebrationXp", { earned: earnedXP, total: TOTAL_XP })}
                </span>
              </div>
            </div>

            <p className="text-[13px] font-black uppercase tracking-widest mb-3" style={{ color: T.sub }}>
              {t("onboardingFlowB.boostersLabel", { done: bonusDone, total: BONUS.length })}
            </p>

            <div className="flex flex-col gap-2.5">
              {BONUS.map(step => {
                const done = stepIsDone(step.id);
                return (
                  <button key={step.id} disabled={done}
                    onClick={() => !done && setActiveBonus(step)}
                    className={cn("flex items-center gap-3 w-full text-left rounded-2xl border p-3.5 bg-white transition-all active:scale-[.98]",
                      done ? "opacity-60 cursor-default" : "cursor-pointer")}
                    style={{ borderColor: T.border }}>
                    <div className="w-11 h-11 rounded-[13px] flex items-center justify-center text-xl flex-shrink-0"
                      style={{ background: done ? "#f0fdf9" : `${T.teal}18` }}>
                      {done ? "✅" : step.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-[14.5px]" style={{ fontFamily: T.display }}>{t(`onboardingFlowB.${step.title}`)}</p>
                      <p className="text-[13px] truncate" style={{ color: T.sub }}>
                        {done ? t(`onboardingFlowB.${step.hint}`) : t(`onboardingFlowB.${step.desc}`)}
                      </p>
                    </div>
                    {!done && <XpSticker xp={step.xp} />}
                  </button>
                );
              })}
            </div>

            <div className="mt-5">
              <button className="w-full h-[52px] rounded-2xl font-bold text-white text-base transition-transform active:scale-[.97]"
                style={{ background: `linear-gradient(135deg,${T.dark},#1a1a2e)`, fontFamily: T.display }}
                onClick={async () => {
                  await updateSettings({ onboarding_completed: true } as any);
                  onFinish();
                }}>
                {t("onboardingFlowB.goToDashboard")}
              </button>
            </div>
          </div>
        </div>

        {/* Bonus bottom-sheet */}
        {activeBonus && (
          <div className="fixed inset-0 z-50" onClick={() => setActiveBonus(null)}>
            <div className="absolute inset-0" style={{ background: "rgba(15,15,26,.45)", backdropFilter: "blur(2px)" }} />
            <div className="absolute bottom-0 left-0 right-0 flex justify-center">
              <div className="ob-sheet w-full max-w-[430px] bg-white rounded-t-[24px] max-h-[88vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}>
                <div className="flex justify-center pt-2.5 pb-1">
                  <div className="w-10 h-1.5 rounded-full" style={{ background: "rgba(15,15,26,.14)" }} />
                </div>
                <div className="px-5 py-3 flex items-center gap-3" style={{ borderBottom: `1px solid ${T.border}` }}>
                  <div className="w-11 h-11 rounded-[13px] flex items-center justify-center text-2xl flex-shrink-0" style={{ background: T.tealL }}>
                    {activeBonus.emoji}
                  </div>
                  <p className="flex-1 font-black text-[18px]" style={{ fontFamily: T.display }}>{t(`onboardingFlowB.${activeBonus.title}`)}</p>
                  <XpSticker xp={activeBonus.xp} />
                </div>
                <div className="px-5 py-4">
                  {activeBonus.action === "referral"  && <ReferralBonus user={user} onComplete={() => { markDone(activeBonus.id); setActiveBonus(null); }} />}
                  {activeBonus.action === "zoom"      && <ZoomBonus    user={user} onComplete={() => { markDone(activeBonus.id); setActiveBonus(null); reload(); }} />}
                  {activeBonus.action === "chat"      && <ChatBonus studentId={addedStudentId} studentName={addedStudentName} subject={addedSubject} navigate={navigate} onComplete={() => { markDone(activeBonus.id); setActiveBonus(null); }} />}
                  {activeBonus.action === "finance"   && <FinanceBonus lessonId={createdLessonId} studentName={addedStudentName} subject={addedSubject} navigate={navigate} onComplete={() => { markDone(activeBonus.id); setActiveBonus(null); reload(); }} />}
                  {activeBonus.action === "calendar"  && <CalendarBonus user={user} onComplete={() => { markDone(activeBonus.id); setActiveBonus(null); reload(); }} />}
                  {activeBonus.action === "ai"        && <AiBonus onComplete={() => { markDone(activeBonus.id); setActiveBonus(null); }} />}
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // ── CORE STEP SCREEN ────────────────────────────────────────────────────────
  const step = CORE[idx];
  const isEssential = step.group === "essential";
  const alreadyDone = stepIsDone(step.id);

  return (
    <>
      <style>{styles}</style>
      {victory && <StepVictoryOverlay {...victory} onDone={() => setVictory(null)} />}

      <div className="min-h-screen flex flex-col" style={{ background: T.bg, fontFamily: T.body }}>
        {/* Centered phone-width container */}
        <div className="max-w-[430px] mx-auto w-full flex flex-col flex-1 px-5 pt-14 pb-6">
          {/* Progress + meta */}
          <div className="mb-2.5"><ProgressSegments total={CORE.length} active={idx} /></div>
          <div className="flex items-center justify-between mb-6">
            <span className="text-[13px] font-bold" style={{ fontFamily: T.display, color: T.sub }}>
              {t("onboardingFlowB.stepCounter", { current: idx+1, total: CORE.length })}
              {isEssential && <span style={{ color: T.muted }}>{t("onboardingFlowB.stepEssentialSuffix")}</span>}
            </span>
            <XpSticker xp={earnedXP} />
          </div>

          {/* Hero + action — keyed to animate per step */}
          <div key={idx} className="ob-step-in flex-1 flex flex-col">
            <div className="text-center mb-6">
              <Medallion emoji={step.emoji} />
              <h1 className="mt-5 text-[24px] font-black leading-snug"
                style={{ fontFamily: T.display, letterSpacing: "-0.02em" }}>
                {t(`onboardingFlowB.${step.title}`)}
              </h1>
              <p className="mt-2.5 text-[15px] leading-relaxed px-2" style={{ color: T.sub }}>
                {t(`onboardingFlowB.${step.desc}`)}
              </p>
            </div>

            <div className="flex-1">
              {alreadyDone ? (
                <div className="flex flex-col items-center gap-4 pt-2">
                  <span className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-bold"
                    style={{ background: "#f0fdf9", color: T.success, outline: `1px solid ${T.success}` }}>
                    <Check className="h-3.5 w-3.5" strokeWidth={3} /> {t(`onboardingFlowB.${step.hint}`)}
                  </span>
                  <Btn onClick={advance}>{idx === CORE.length-1 ? t("onboardingFlowB.finishStep") : t("onboardingFlowB.nextStep")}</Btn>
                </div>
              ) : (
                <>
                  {step.action === "subject"      && <SubjectAction user={user} onComplete={(subs) => { setPickedSubjects(subs); markDone(step.id); advance(); }} />}
                  {step.action === "student"      && <StudentAction user={user} defaultSubject={pickedSubjects[0] ?? ""} onComplete={(id, name, sub) => { setAddedStudentId(id); setAddedStudentName(name); setAddedSubject(sub); markDone(step.id); advance(); reload(); }} />}
                  {step.action === "lesson"       && <LessonAction  user={user} studentId={addedStudentId} studentName={addedStudentName} subject={addedSubject} onComplete={(lid) => { setCreatedLessonId(lid); markDone(step.id); advance(); }} />}
                  {step.action === "proRules"     && <ProRulesAction user={user} onComplete={() => { markDone(step.id); advance(); }} />}
                  {step.action === "autoMark"     && <AutoMarkAction onComplete={() => { markDone(step.id); advance(); }} />}
                  {step.action === "availability" && <AvailabilityAction user={user} onComplete={() => { markDone(step.id); advance(); }} />}
                  {step.action === "telegram"     && <TelegramAction user={user} onComplete={() => { markDone(step.id); advance(); }} />}
                </>
              )}
            </div>
          </div>

          {/* Bottom nav */}
          <div className="flex items-center justify-between mt-4 min-h-[44px]">
            <GhostBtn onClick={() => setIdx(i => Math.max(0,i-1))}
              style={{ visibility: idx === 0 ? "hidden" : "visible" }}>
              {t("onboardingFlowB.back")}
            </GhostBtn>
            {!isEssential && !alreadyDone && (
              <GhostBtn onClick={advance} style={{ color: T.muted }}>{t("onboardingFlowB.skip")}</GhostBtn>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
