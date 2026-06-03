/**
 * OnboardingFlowB — "One step at a time" fullscreen onboarding for independent tutors.
 * Design: /design_handoff_onboarding_flowB/README.md
 * 7 core steps (3 essential + 4 setup) inline → celebration → 6 bonus power-ups.
 * No navigation away from this screen during core steps.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import confetti from "canvas-confetti";

import { SubjectComboBox } from "@/components/SubjectComboBox";
import { QuickAddStudentDialog } from "@/components/QuickAddStudentDialog";
import { QuickLessonDialog } from "@/components/QuickLessonDialog";
import { ProRulesCard } from "@/components/ProRulesCard";
import { AvailabilityManager } from "@/components/AvailabilityManager";
import { TelegramLinkCard } from "@/components/TelegramLinkCard";
import { StepVictoryOverlay } from "@/components/StepVictoryOverlay";
import type { StepProgress } from "@/components/OnboardingContent";

// ── Design tokens (mirror README §9 / src/index.css) ──────────────────────────
const TEAL = "#2BBFAA";
const TEAL_D = "#25a896";
const DS_BG = "#F5F4F0";
const DS_SUB = "#9398b0";
const DS_MUTED = "#b0b4c8";
const TOTAL_XP = 875;

// ── Step definitions ───────────────────────────────────────────────────────────
interface StepDef {
  id: number;
  emoji: string;
  group: "essential" | "setup" | "bonus";
  action: string;
  xp: number;
  titleKey: string;
  descKey: string;
  ctaKey: string;
  hintKey: string;
  autoKey?: keyof StepProgress | "hasTelegramLink";
}

const STEPS: StepDef[] = [
  { id: 0,  emoji: "📚", group: "essential", action: "subject",      xp: 25,  titleKey: "onboardingContent.subjectTitle",        descKey: "onboardingContent.subjectDesc",          ctaKey: "onboardingContent.subjectCta",        hintKey: "onboardingContent.subjectDone",      autoKey: "hasSubject" },
  { id: 1,  emoji: "👋", group: "essential", action: "student",      xp: 50,  titleKey: "onboardingContent.addStudentTitle",     descKey: "onboardingContent.addStudentDesc",       ctaKey: "onboardingContent.addStudentCta",     hintKey: "onboardingContent.addStudentHint",   autoKey: "hasStudent" },
  { id: 2,  emoji: "📅", group: "essential", action: "lesson",       xp: 75,  titleKey: "onboardingContent.scheduleTitle",       descKey: "onboardingContent.scheduleDesc",         ctaKey: "onboardingContent.scheduleCta",       hintKey: "onboardingContent.scheduleDone",     autoKey: "hasLesson" },
  { id: 3,  emoji: "🔔", group: "setup",     action: "proRules",     xp: 75,  titleKey: "onboardingContent.proRulesTitle",       descKey: "onboardingContent.proRulesDesc",         ctaKey: "onboardingContent.proRulesCta",       hintKey: "onboardingContent.proRulesDone",     autoKey: "hasPaymentRules" },
  { id: 4,  emoji: "✅", group: "setup",     action: "autoMark",     xp: 50,  titleKey: "onboardingContent.autoMarkTitle",       descKey: "onboardingContent.autoMarkDesc",         ctaKey: "onboardingContent.autoMarkCta",       hintKey: "onboardingContent.autoMarkDone",     autoKey: "hasAutoCompleteChoice" },
  { id: 5,  emoji: "🕐", group: "setup",     action: "availability", xp: 75,  titleKey: "onboardingContent.availabilityTitle",   descKey: "onboardingContent.availabilityDesc",     ctaKey: "onboardingContent.availabilityCta",   hintKey: "onboardingContent.availabilityDone", autoKey: "hasAvailability" },
  { id: 6,  emoji: "📲", group: "setup",     action: "telegram",     xp: 75,  titleKey: "onboardingTelegram.telegramStepTitle",  descKey: "onboardingTelegram.telegramStepDesc",    ctaKey: "onboardingTelegram.telegramConnectCta", hintKey: "onboardingTelegram.telegramHint", autoKey: "hasTelegramLink" },
  { id: 7,  emoji: "🎁", group: "bonus",     action: "referral",     xp: 100, titleKey: "onboardingContent.referralTitle",       descKey: "onboardingContent.referralDesc",         ctaKey: "onboardingContent.referralCta",       hintKey: "onboardingContent.referralDone",     autoKey: "hasReferral" },
  { id: 8,  emoji: "🎥", group: "bonus",     action: "zoom",         xp: 50,  titleKey: "onboardingContent.zoomTitle",           descKey: "onboardingContent.zoomDesc",             ctaKey: "onboardingContent.zoomCta",           hintKey: "onboardingContent.zoomDone",         autoKey: "hasMeetingUrl" },
  { id: 9,  emoji: "💬", group: "bonus",     action: "chat",         xp: 50,  titleKey: "onboardingContent.chatTitle",           descKey: "onboardingContent.chatDesc",             ctaKey: "onboardingContent.chatCta",           hintKey: "onboardingContent.chatDone",         autoKey: "hasChat" },
  { id: 10, emoji: "💰", group: "bonus",     action: "finance",      xp: 100, titleKey: "onboardingContent.financeMarkTitle",    descKey: "onboardingContent.financeMarkDesc",      ctaKey: "onboardingContent.financeMarkCta",    hintKey: "onboardingContent.financeMarkDone",  autoKey: "hasPaidLesson" },
  { id: 11, emoji: "📆", group: "bonus",     action: "calendar",     xp: 75,  titleKey: "onboardingContent.calendarTitle",       descKey: "onboardingContent.calendarDesc",         ctaKey: "onboardingContent.calendarCta",       hintKey: "onboardingContent.calendarDone",     autoKey: "hasGoogleCalendar" },
  { id: 12, emoji: "✨", group: "bonus",     action: "ai",           xp: 150, titleKey: "onboardingContent.aiTitle",             descKey: "onboardingContent.aiDesc",               ctaKey: "onboardingContent.aiCta",             hintKey: "onboardingContent.aiDone" },
];

const CORE = STEPS.filter(s => s.group !== "bonus");
const BONUS = STEPS.filter(s => s.group === "bonus");

function burst(kind: "step" | "final") {
  const colors = [TEAL, "#0CA678", "#F59E0B", "#5b6bf5", "#FF7A59"];
  if (kind === "final") {
    confetti({ particleCount: 150, spread: 80, origin: { y: 0.5 }, colors });
    setTimeout(() => confetti({ particleCount: 80, angle: 60, spread: 55, origin: { x: 0 }, colors }), 180);
    setTimeout(() => confetti({ particleCount: 80, angle: 120, spread: 55, origin: { x: 1 }, colors }), 340);
  } else {
    confetti({ particleCount: 46, spread: 52, origin: { y: 0.4 }, colors, scalar: 0.85 });
  }
}

// ── Progress segments bar ──────────────────────────────────────────────────────
function ProgressSegments({ total, active }: { total: number; active: number }) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: total }).map((_, i) => {
        const pct = i < active ? "100%" : i === active ? "45%" : "0%";
        return (
          <div key={i} className="flex-1 h-1.5 rounded-full overflow-hidden bg-black/8">
            <div
              className="h-full rounded-full"
              style={{ width: pct, background: TEAL, transition: "width .45s cubic-bezier(.34,1.56,.64,1)" }}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── XP sticker ────────────────────────────────────────────────────────────────
function XpSticker({ xp }: { xp: number }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ring-1"
      style={{ background: "#fef9ec", color: "#92400e", ringColor: "#fbbf24" }}>
      ⭐ {xp} XP
    </span>
  );
}

// ── Hero medallion ────────────────────────────────────────────────────────────
function HeroMedallion({ emoji }: { emoji: string }) {
  return (
    <div
      className="ob-float mx-auto flex items-center justify-center text-[44px]"
      style={{
        width: 92, height: 92, borderRadius: 27,
        background: `linear-gradient(135deg, ${TEAL}, ${TEAL_D})`,
        boxShadow: "0 18px 40px -14px rgba(43,191,170,0.7)",
      }}
    >
      {emoji}
    </div>
  );
}

// ── AutoMark inline action ─────────────────────────────────────────────────────
function AutoMarkAction({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation();
  const { updateSettings } = useWorkspaceSettings();
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await updateSettings({ auto_complete_prompted: true } as any);
    setSaving(false);
    onComplete();
  };

  const opts = [
    { v: "auto" as const,   title: t("autoCompletePrompt.autoTitle") || "Автоматично",  desc: t("autoCompletePrompt.autoDesc") || "Урок позначається проведеним через годину після початку." },
    { v: "manual" as const, title: t("autoCompletePrompt.manualTitle") || "Вручну",     desc: t("autoCompletePrompt.manualDesc") || "Я відмічатиму сам після кожного уроку." },
  ];

  return (
    <div className="flex flex-col gap-3">
      {opts.map(o => (
        <button key={o.v} onClick={() => setMode(o.v)}
          className={cn("w-full text-left rounded-2xl p-4 flex items-start gap-3 transition-all",
            mode === o.v ? "ring-2 ring-[#2BBFAA] bg-[#f0fdf9]" : "border border-border bg-white"
          )}>
          <span className={cn("w-5 h-5 rounded-full mt-0.5 border-2 flex-shrink-0 bg-white transition-all",
            mode === o.v ? "border-[#2BBFAA] border-[6px]" : "border-[#b0b4c8]"
          )} />
          <span>
            <span className="block font-bold text-[15px] text-foreground">{o.title}</span>
            <span className="block text-[13px] mt-0.5 leading-snug" style={{ color: DS_SUB }}>{o.desc}</span>
          </span>
        </button>
      ))}
      <Button className="w-full h-12 rounded-2xl font-bold text-white shadow-lg shadow-teal/30"
        style={{ background: `linear-gradient(135deg,${TEAL},${TEAL_D})` }}
        onClick={save} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (t("onboardingContent.autoMarkCta") || "Обрати режим")}
      </Button>
    </div>
  );
}

// ── Telegram inline action ─────────────────────────────────────────────────────
function TelegramAction({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation();
  const { settings, updateSettings } = useWorkspaceSettings();
  const [daily, setDaily] = useState(true);
  const [weekly, setWeekly] = useState(true);
  const isConnected = Boolean((settings as any)?.telegram_chat_id);

  useEffect(() => {
    if (isConnected) onComplete();
  }, [isConnected]);

  const savePrefs = async () => {
    await updateSettings({ telegram_daily_digest: daily, telegram_weekly_digest: weekly } as any);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-border bg-white p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-bold text-[14.5px] text-foreground">{t("onboardingTelegram.telegramDailyTitle") || "Щоденний дайджест"}</p>
            <p className="text-[12.5px] mt-0.5 leading-snug" style={{ color: DS_SUB }}>{t("onboardingTelegram.telegramDailyDesc") || "Список уроків на день, хто в боргах — щоранку."}</p>
          </div>
          <Switch checked={daily} onCheckedChange={v => { setDaily(v); savePrefs(); }} />
        </div>
        <div className="h-px bg-border/50" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-bold text-[14.5px] text-foreground">{t("onboardingTelegram.telegramWeeklyTitle") || "Щотижневий підсумок"}</p>
            <p className="text-[12.5px] mt-0.5 leading-snug" style={{ color: DS_SUB }}>{t("onboardingTelegram.telegramWeeklyDesc") || "Скільки заробив, к-сть уроків — щопонеділка."}</p>
          </div>
          <Switch checked={weekly} onCheckedChange={v => { setWeekly(v); savePrefs(); }} />
        </div>
      </div>
      <TelegramLinkCard />
      <Button variant="ghost" className="text-sm" style={{ color: DS_MUTED }} onClick={onComplete}>
        {t("common.skipForNow") || "Пропустити поки що"}
      </Button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props { onFinish: () => void }

export function OnboardingFlowB({ onFinish }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { settings, updateSettings, loading: wsLoading } = useWorkspaceSettings();

  // Core step index (0–CORE.length); at CORE.length = celebration
  const [idx, setIdx] = useState<number>(0);
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<StepProgress & { hasTelegramLink?: boolean }>({
    hasSubject: false, hasStudent: false, hasLesson: false, hasAvailability: false,
    hasReferral: false, hasMeetingUrl: false, hasChat: false, hasPaidLesson: false,
    hasPaymentRules: false, hasAutoCompleteChoice: false, hasGoogleCalendar: false,
    hasTelegramLink: false,
  });
  const [progressLoading, setProgressLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [victoryStep, setVictoryStep] = useState<{ emoji: string; title: string; xp: number; isFinal: boolean } | null>(null);

  // Dialogs for steps 1 & 2
  const [addStudentOpen, setAddStudentOpen] = useState(false);
  const [quickLessonOpen, setQuickLessonOpen] = useState(false);
  const [subjectDraft, setSubjectDraft] = useState("");
  const [savingSubject, setSavingSubject] = useState(false);

  // Bonus sheet
  const [activeBonus, setActiveBonus] = useState<StepDef | null>(null);

  // Restore saved step position
  useEffect(() => {
    if (!wsLoading && settings) {
      const saved = (settings as any).onboarding_step ?? 0;
      if (saved > 0 && saved <= CORE.length) setIdx(saved);
    }
  }, [wsLoading]);

  // Progress loading
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const safe = async <T,>(p: PromiseLike<T>, fallback: T): Promise<T> => {
      try { return await p; } catch { return fallback; }
    };
    const patch = (p: Partial<typeof progress>) => { if (!cancelled) setProgress(prev => ({ ...prev, ...p })); };

    (async () => {
      setProgressLoading(true);
      const [studentsRes, lessonsRes, tgRes] = await Promise.all([
        safe(supabase.from("student_rates").select("student_id").eq("tutor_id", user.id).eq("source", "independent").limit(1), { data: [] } as any),
        safe(supabase.from("lessons").select("id, meeting_url").eq("tutor_id", user.id).eq("source", "independent").limit(50), { data: [] } as any),
        safe(supabase.from("user_telegram_links").select("id").eq("user_id", user.id).limit(1), { data: [] } as any),
      ]);
      const lessons = (lessonsRes as any).data ?? [];
      patch({
        hasStudent: ((studentsRes as any).data?.length ?? 0) > 0,
        hasLesson: lessons.length > 0,
        hasMeetingUrl: lessons.some((l: any) => l.meeting_url?.trim()),
        hasPaymentRules: Boolean((settings as any)?.payment_rules_configured),
        hasAutoCompleteChoice: Boolean((settings as any)?.auto_complete_prompted),
        hasTelegramLink: ((tgRes as any).data?.length ?? 0) > 0,
      });
      if (!cancelled) setProgressLoading(false);

      // Secondary checks
      safe(supabase.from("tutor_details").select("subjects").eq("tutor_id", user.id).maybeSingle(), null as any).then((r: any) => {
        if (r?.data?.subjects?.length > 0) patch({ hasSubject: true });
      });
      safe(supabase.from("tutor_availability_weekly").select("id").eq("tutor_id", user.id).limit(1), { data: [] } as any).then((r: any) => {
        patch({ hasAvailability: (r.data?.length ?? 0) > 0 });
      });
      safe(supabase.from("referral_codes").select("id").eq("tutor_id", user.id).limit(1), { data: [] } as any).then((r: any) => {
        patch({ hasReferral: (r.data?.length ?? 0) > 0 });
      });
      safe(supabase.from("chat_threads").select("id").eq("tutor_id", user.id).limit(1), { data: [] } as any).then((r: any) => {
        patch({ hasChat: (r.data?.length ?? 0) > 0 });
      });
      safe(supabase.from("google_calendar_tokens").select("id").eq("user_id", user.id).limit(1), { data: [] } as any).then((r: any) => {
        patch({ hasGoogleCalendar: (r.data?.length ?? 0) > 0 });
      });
    })();
    return () => { cancelled = true; };
  }, [user?.id, reloadKey, settings?.onboarding_completed]);

  const reload = () => setReloadKey(k => k + 1);

  // Mark step as completed + show victory
  const markDone = (stepId: number) => {
    setCompleted(prev => new Set([...prev, stepId]));
    const step = STEPS[stepId];
    const isFinal = stepId === CORE[CORE.length - 1].id;
    burst(isFinal ? "final" : "step");
    setVictoryStep({ emoji: step.emoji, title: t(step.titleKey) || step.titleKey, xp: step.xp, isFinal });
    reload();
  };

  const advance = async () => {
    const nextIdx = idx + 1;
    setIdx(nextIdx);
    await updateSettings({ onboarding_step: nextIdx } as any);
    if (nextIdx >= CORE.length) {
      burst("final");
      await updateSettings({ onboarding_completed: false, onboarding_step: CORE.length } as any);
    }
  };

  const stepIsDone = (stepId: number): boolean => {
    const step = STEPS.find(s => s.id === stepId);
    if (!step?.autoKey) return completed.has(stepId);
    return Boolean(progress[step.autoKey]) || completed.has(stepId);
  };

  const earnedXP = STEPS.filter(s => stepIsDone(s.id)).reduce((sum, s) => sum + s.xp, 0);

  // Google Calendar OAuth return
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("calendar") === "connected") {
      toast.success(t("googleCalendar.connected") || "Google Calendar підключено!");
      url.searchParams.delete("calendar");
      window.history.replaceState({}, "", url.pathname + url.search);
      reload();
    }
  }, []);

  // ── Celebration screen ───────────────────────────────────────────────────────
  if (idx >= CORE.length) {
    const bonusDone = BONUS.filter(s => stepIsDone(s.id)).length;
    return (
      <>
        {victoryStep && (
          <StepVictoryOverlay {...victoryStep} onDone={() => setVictoryStep(null)} />
        )}
        <div className="min-h-screen flex flex-col" style={{ background: DS_BG, fontFamily: "'Plus Jakarta Sans', system-ui" }}>
          <div className="px-5 py-16 flex flex-col items-center text-center">
            <div className="ob-bounce text-[72px] leading-none">🎉</div>
            <h1 className="mt-4 font-black text-[27px] tracking-tight text-foreground" style={{ fontFamily: "'Inter', system-ui", letterSpacing: "-0.02em" }}>
              {t("onboardingExtra.questDone") || "Кабінет готовий!"}
            </h1>
            <p className="mt-2 text-[14.5px] leading-relaxed px-6" style={{ color: DS_SUB }}>
              {t("onboardingExtra.questDoneSubtitle") || "Основне налаштовано. Ось ще кілька підсилювачів — додай, коли буде час."}
            </p>
            <div className="mt-4 inline-flex">
              <XpSticker xp={earnedXP} />
            </div>
          </div>

          <div className="px-5 pb-4">
            <p className="text-[11px] font-black uppercase tracking-widest mb-3" style={{ color: DS_SUB }}>
              {t("onboardingExtra.bonusLabel") || `Підсилювачі · ${bonusDone}/${BONUS.length}`}
            </p>
            <div className="flex flex-col gap-2.5">
              {BONUS.map(step => {
                const done = stepIsDone(step.id);
                return (
                  <button key={step.id} disabled={done}
                    onClick={() => !done && setActiveBonus(step)}
                    className={cn("flex items-center gap-3 w-full text-left rounded-2xl border p-3.5 transition-all active:scale-[.98]",
                      done ? "opacity-60 cursor-default" : "bg-white border-border hover:border-[#2BBFAA]/40 cursor-pointer"
                    )}>
                    <div className="w-11 h-11 rounded-[13px] flex items-center justify-center text-xl flex-shrink-0"
                      style={{ background: done ? "#f0fdf9" : `linear-gradient(135deg,${TEAL}22,${TEAL}11)` }}>
                      {done ? "✅" : step.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-[14.5px] text-foreground" style={{ fontFamily: "'Inter', system-ui" }}>
                        {t(step.titleKey) || step.titleKey}
                      </p>
                      <p className="text-[12.5px] truncate" style={{ color: DS_SUB }}>
                        {done ? (t(step.hintKey) || "✓") : (t(step.descKey) || step.descKey)}
                      </p>
                    </div>
                    {!done && <XpSticker xp={step.xp} />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="px-5 py-5 mt-auto">
            <button className="w-full h-[52px] rounded-2xl font-bold text-white text-[16px] transition-transform active:scale-[.97]"
              style={{ background: `linear-gradient(135deg,#0f0f1a,#1a1a2e)`, fontFamily: "'Inter', system-ui" }}
              onClick={async () => {
                await updateSettings({ onboarding_completed: true } as any);
                onFinish();
              }}>
              {t("onboardingExtra.toDashboard") || "На дашборд →"}
            </button>
          </div>
        </div>

        {/* Bonus bottom-sheet */}
        {activeBonus && (
          <div className="fixed inset-0 z-50" onClick={() => setActiveBonus(null)}>
            <div className="absolute inset-0 bg-[#0f0f1a]/45 backdrop-blur-sm" />
            <div
              className="ob-sheet absolute bottom-0 left-0 right-0 bg-white rounded-t-[24px] max-h-[88vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex justify-center pt-2.5 pb-1">
                <div className="w-10 h-1.5 rounded-full bg-black/10" />
              </div>
              <div className="px-5 py-3 flex items-center gap-3 border-b border-border/50">
                <div className="w-11 h-11 rounded-[13px] flex items-center justify-center text-xl"
                  style={{ background: "#f0fdf9" }}>{activeBonus.emoji}</div>
                <div className="flex-1">
                  <p className="font-black text-[18px]" style={{ fontFamily: "'Inter', system-ui" }}>
                    {t(activeBonus.titleKey) || activeBonus.titleKey}
                  </p>
                </div>
                <XpSticker xp={activeBonus.xp} />
              </div>
              <div className="px-5 py-4">
                <BonusActionBody step={activeBonus} onComplete={() => {
                  markDone(activeBonus.id);
                  setActiveBonus(null);
                }} onReload={reload} navigate={navigate} />
              </div>
            </div>
          </div>
        )}

        {/* Dialogs for bonus steps */}
        <QuickAddStudentDialog open={addStudentOpen} onOpenChange={setAddStudentOpen} onCreated={() => { reload(); }} />
      </>
    );
  }

  // ── Core step screen ──────────────────────────────────────────────────────────
  const step = CORE[idx];
  const isEssential = step.group === "essential";
  const alreadyDone = stepIsDone(step.id);

  return (
    <>
      <style>{`
        @keyframes ob-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-7px)} }
        @keyframes ob-bounce { 0%{transform:scale(0.5);opacity:0} 70%{transform:scale(1.15)} 100%{transform:scale(1);opacity:1} }
        @keyframes ob-step-in { from{transform:translateX(22px);opacity:.25} to{transform:translateX(0);opacity:1} }
        @keyframes ob-sheet { from{transform:translateY(34px);opacity:.35} to{transform:translateY(0);opacity:1} }
        .ob-float { animation: ob-float 3.2s ease-in-out infinite; }
        .ob-bounce { animation: ob-bounce .55s cubic-bezier(.34,1.56,.64,1) both; }
        .ob-step-in { animation: ob-step-in .36s cubic-bezier(.32,.72,0,1) both; }
        .ob-sheet { animation: ob-sheet .34s cubic-bezier(.32,.72,0,1) both; }
        @media (prefers-reduced-motion: reduce) { .ob-float,.ob-bounce,.ob-step-in,.ob-sheet { animation: none; } }
      `}</style>

      {victoryStep && (
        <StepVictoryOverlay {...victoryStep} onDone={() => setVictoryStep(null)} />
      )}

      <div className="min-h-screen flex flex-col" style={{ background: DS_BG, padding: "54px 22px 26px", fontFamily: "'Plus Jakarta Sans', system-ui" }}>
        {/* Progress + meta */}
        <div className="mb-2.5">
          <ProgressSegments total={CORE.length} active={idx} />
        </div>
        <div className="flex items-center justify-between mb-6">
          <span className="text-[13px] font-bold" style={{ fontFamily: "'Inter', system-ui", color: DS_SUB }}>
            {t("onboarding.stepOf") ? t("onboarding.stepOf", { n: idx + 1, total: CORE.length }) : `Крок ${idx + 1} з ${CORE.length}`}
            {isEssential && <span style={{ color: DS_MUTED }}> · основне</span>}
          </span>
          <XpSticker xp={earnedXP} />
        </div>

        {/* Hero + action — key resets animation per step */}
        <div key={idx} className="ob-step-in flex-1 flex flex-col">
          <div className="text-center mb-6">
            <HeroMedallion emoji={step.emoji} />
            <h1 className="mt-5 font-black text-[24px] leading-snug tracking-tight text-foreground"
              style={{ fontFamily: "'Inter', system-ui", letterSpacing: "-0.02em" }}>
              {t(step.titleKey) || step.titleKey}
            </h1>
            <p className="mt-2.5 text-[15px] leading-relaxed px-2" style={{ color: DS_SUB }}>
              {t(step.descKey) || step.descKey}
            </p>
          </div>

          <div className="flex-1">
            {alreadyDone ? (
              <div className="flex flex-col items-center gap-4 pt-2">
                <span className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-bold"
                  style={{ background: "#f0fdf9", color: "#0CA678", outline: "1px solid #0CA678" }}>
                  {t(step.hintKey) || "Готово ✓"}
                </span>
                <button className="w-full h-[52px] rounded-2xl font-bold text-white transition-transform active:scale-[.97]"
                  style={{ background: `linear-gradient(135deg,${TEAL},${TEAL_D})`, fontFamily: "'Inter', system-ui" }}
                  onClick={advance}>
                  {idx === CORE.length - 1 ? (t("onboarding.finish") || "Завершити →") : (t("onboarding.next") || "Далі →")}
                </button>
              </div>
            ) : (
              <CoreActionBody
                step={step}
                progress={progress}
                subjectDraft={subjectDraft}
                setSubjectDraft={setSubjectDraft}
                savingSubject={savingSubject}
                setSavingSubject={setSavingSubject}
                addStudentOpen={addStudentOpen}
                setAddStudentOpen={setAddStudentOpen}
                quickLessonOpen={quickLessonOpen}
                setQuickLessonOpen={setQuickLessonOpen}
                user={user}
                onComplete={() => { markDone(step.id); advance(); }}
                onReload={reload}
              />
            )}
          </div>
        </div>

        {/* Nav */}
        <div className="flex items-center justify-between mt-4 min-h-[44px]">
          <button
            className="flex items-center gap-1 px-3 py-2 rounded-xl text-[14px] font-medium transition-colors hover:bg-black/5"
            style={{ color: DS_SUB, visibility: idx === 0 ? "hidden" : "visible" }}
            onClick={() => setIdx(i => Math.max(0, i - 1))}>
            ← {t("common.back") || "Назад"}
          </button>
          {!isEssential && !alreadyDone && (
            <button className="px-3 py-2 rounded-xl text-[14px] font-medium transition-colors hover:bg-black/5"
              style={{ color: DS_MUTED }} onClick={advance}>
              {t("common.skip") || "Пропустити"}
            </button>
          )}
        </div>
      </div>

      {/* Dialogs for core steps */}
      <QuickAddStudentDialog
        open={addStudentOpen}
        onOpenChange={setAddStudentOpen}
        onCreated={() => { reload(); markDone(1); advance(); }}
      />
      <QuickLessonDialog
        open={quickLessonOpen}
        onOpenChange={setQuickLessonOpen}
        startsAt={new Date()}
        onCreated={() => { reload(); markDone(2); advance(); }}
      />
    </>
  );
}

// ── Core step inline action body ──────────────────────────────────────────────
interface CoreActionProps {
  step: StepDef;
  progress: any;
  subjectDraft: string;
  setSubjectDraft: (v: string) => void;
  savingSubject: boolean;
  setSavingSubject: (v: boolean) => void;
  addStudentOpen: boolean;
  setAddStudentOpen: (v: boolean) => void;
  quickLessonOpen: boolean;
  setQuickLessonOpen: (v: boolean) => void;
  user: any;
  onComplete: () => void;
  onReload: () => void;
}

function CoreActionBody({ step, subjectDraft, setSubjectDraft, savingSubject, setSavingSubject,
  setAddStudentOpen, setQuickLessonOpen, user, onComplete, onReload }: CoreActionProps) {
  const { t } = useTranslation();

  const PrimaryBtn = ({ children, onClick, disabled }: any) => (
    <button disabled={disabled} onClick={onClick}
      className={cn("w-full h-[52px] rounded-2xl font-bold text-white text-[16px] transition-transform",
        disabled ? "opacity-40 cursor-not-allowed" : "active:scale-[.97] shadow-lg")}
      style={{ background: `linear-gradient(135deg,${TEAL},${TEAL_D})`, fontFamily: "'Inter', system-ui",
        boxShadow: disabled ? "none" : "0 8px 20px -8px rgba(43,191,170,0.6)" }}>
      {children}
    </button>
  );

  if (step.action === "subject") {
    const saveSubject = async () => {
      if (!user || !subjectDraft.trim()) return;
      setSavingSubject(true);
      await supabase.from("tutor_details").upsert({ tutor_id: user.id, subjects: [subjectDraft] } as any, { onConflict: "tutor_id" });
      setSavingSubject(false);
      onReload();
      onComplete();
    };
    return (
      <div className="flex flex-col gap-4">
        <SubjectComboBox value={subjectDraft} onChange={setSubjectDraft} />
        <PrimaryBtn disabled={!subjectDraft.trim() || savingSubject} onClick={saveSubject}>
          {savingSubject ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : (t("onboardingContent.subjectCta") || "Зберегти предмет")}
        </PrimaryBtn>
      </div>
    );
  }

  if (step.action === "student") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[14px] leading-relaxed" style={{ color: "#9398b0" }}>
          {t("onboardingContent.addStudentHint") || "Ім'я, контакт, предмет і ціна. Учень отримає запрошення."}
        </p>
        <PrimaryBtn onClick={() => setAddStudentOpen(true)}>
          {t("onboardingContent.addStudentCta") || "Додати учня"}
        </PrimaryBtn>
      </div>
    );
  }

  if (step.action === "lesson") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[14px] leading-relaxed" style={{ color: "#9398b0" }}>
          {t("onboardingExtra.scheduleHintAlt") || "Обери учня, дату і час. Можна повторювати щотижня."}
        </p>
        <PrimaryBtn onClick={() => setQuickLessonOpen(true)}>
          {t("onboardingContent.scheduleCta") || "Додати урок"}
        </PrimaryBtn>
      </div>
    );
  }

  if (step.action === "proRules") {
    return <ProRulesCard />;
  }

  if (step.action === "autoMark") {
    return <AutoMarkAction onComplete={onComplete} />;
  }

  if (step.action === "availability") {
    return (
      <div className="rounded-2xl overflow-hidden border border-border bg-white">
        <AvailabilityManager />
        <div className="px-4 pb-4 pt-2">
          <PrimaryBtn onClick={onComplete}>{t("onboardingContent.availabilityCta") || "Зберегти та продовжити"}</PrimaryBtn>
        </div>
      </div>
    );
  }

  if (step.action === "telegram") {
    return <TelegramAction onComplete={onComplete} />;
  }

  return null;
}

// ── Bonus action body (for celebration bottom-sheet) ─────────────────────────
function BonusActionBody({ step, onComplete, onReload, navigate }: {
  step: StepDef; onComplete: () => void; onReload: () => void; navigate: any;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [addStudentOpen, setAddStudentOpen] = useState(false);
  const [zoomUrl, setZoomUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [connectingCalendar, setConnectingCalendar] = useState(false);

  const PrimaryBtn = ({ children, onClick, disabled }: any) => (
    <button disabled={disabled} onClick={onClick}
      className={cn("w-full h-[52px] rounded-2xl font-bold text-white text-[16px] mt-4 transition-transform",
        disabled ? "opacity-40 cursor-not-allowed" : "active:scale-[.97]")}
      style={{ background: `linear-gradient(135deg,${TEAL},${TEAL_D})`, fontFamily: "'Inter', system-ui" }}>
      {children}
    </button>
  );

  if (step.action === "referral") {
    return (
      <>
        <p className="text-[14px] leading-relaxed mb-4" style={{ color: DS_SUB }}>
          {t("onboardingContent.referralDesc") || "Друг отримає 21 день тріалу, а ти — місяць Pro безкоштовно."}
        </p>
        <PrimaryBtn onClick={() => navigate("/my-referrals")}>
          {t("onboardingContent.referralCta") || "Запросити колегу →"}
        </PrimaryBtn>
      </>
    );
  }

  if (step.action === "zoom") {
    const save = async () => {
      if (!user || !zoomUrl.trim()) return;
      setSaving(true);
      await supabase.from("tutor_student_defaults").upsert(
        { tutor_id: user.id, default_meeting_url: zoomUrl.trim() } as any,
        { onConflict: "tutor_id" }
      );
      setSaving(false);
      onReload();
      onComplete();
    };
    return (
      <div className="flex flex-col gap-3">
        <Label className="text-xs font-bold uppercase tracking-wider" style={{ color: DS_SUB }}>
          {t("onboardingContent.zoomCta") || "Посилання на зустріч"}
        </Label>
        <Input value={zoomUrl} onChange={e => setZoomUrl(e.target.value)}
          placeholder="https://zoom.us/j/... або meet.google.com/..."
          className="h-12 rounded-xl text-[15px]" />
        <PrimaryBtn disabled={!zoomUrl.trim() || saving} onClick={save}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : (t("onboardingContent.zoomCta") || "Зберегти посилання")}
        </PrimaryBtn>
      </div>
    );
  }

  if (step.action === "chat") {
    return (
      <>
        <p className="text-[14px] leading-relaxed mb-4" style={{ color: DS_SUB }}>
          {t("onboardingContent.chatDesc") || "Файли, домашка, нагадування — в одному місці."}
        </p>
        <PrimaryBtn onClick={() => navigate("/chats")}>
          {t("onboardingContent.chatCta") || "Відкрити чати →"}
        </PrimaryBtn>
      </>
    );
  }

  if (step.action === "finance") {
    return (
      <>
        <p className="text-[14px] leading-relaxed mb-4" style={{ color: DS_SUB }}>
          {t("onboardingContent.financeMarkDesc") || "Відміть оплату уроку — бачиш статистику в реальному часі."}
        </p>
        <PrimaryBtn onClick={() => navigate("/")}>
          {t("onboardingContent.financeMarkCta") || "До фінансів →"}
        </PrimaryBtn>
      </>
    );
  }

  if (step.action === "calendar") {
    const connect = async () => {
      if (!user || connectingCalendar) return;
      setConnectingCalendar(true);
      const { data, error } = await supabase.functions.invoke("google-calendar-auth", {
        body: { return_to: `${window.location.origin}/onboarding?calendar=connected` },
      });
      if (error || !data?.redirect_url) {
        toast.error(t("googleCalendar.connectFailed") || "Помилка підключення");
        setConnectingCalendar(false);
        return;
      }
      window.location.href = data.redirect_url;
    };
    return (
      <>
        <p className="text-[14px] leading-relaxed mb-4" style={{ color: DS_SUB }}>
          {t("onboardingContent.calendarDesc") || "Уроки автоматично синхронізуються у Google Календар."}
        </p>
        <PrimaryBtn disabled={connectingCalendar} onClick={connect}>
          {connectingCalendar ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : (t("onboardingContent.calendarCta") || "Підключити Google Calendar")}
        </PrimaryBtn>
      </>
    );
  }

  if (step.action === "ai") {
    return (
      <>
        <p className="text-[14px] leading-relaxed mb-4" style={{ color: DS_SUB }}>
          {t("onboardingContent.aiDesc") || "Fireflies запише урок, AI зробить підсумок: що пройшли, що задано."}
        </p>
        <PrimaryBtn onClick={onComplete}>
          {t("onboardingContent.aiCta") || "Зрозуміло, готово ✓"}
        </PrimaryBtn>
      </>
    );
  }

  return null;
}