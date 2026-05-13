import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  UserPlus,
  CalendarClock,
  Video,
  Sparkles,
  MessageCircle,
  CreditCard,
  CheckCircle2,
  ArrowRight,
  Loader2,
  PartyPopper,
  Clock,
  Gift,
  BellRing,
  CheckSquare,
  CalendarCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { QuickAddStudentDialog } from "@/components/QuickAddStudentDialog";

interface Step {
  id: number;
  title: string;
  description: string;
  cta: string;
  to: string;
  icon: typeof UserPlus;
  emoji: string;
  xp: number;
  badge?: string;
  autoKey?: keyof StepProgress;
  autoHint?: string;
  action?: "addStudent";
}

export interface StepProgress {
  hasStudent: boolean;
  hasLesson: boolean;
  hasAvailability: boolean;
  hasReferral: boolean;
  hasMeetingUrl: boolean;
  hasChat: boolean;
  hasPaidLesson: boolean;
  hasPaymentRules: boolean;
  hasAutoCompleteChoice: boolean;
  hasGoogleCalendar: boolean;
}

const steps: Step[] = [
  {
    id: 1,
    title: "Додайте першого учня",
    description:
      "Введіть ім'я, телефон, email, телеграм/інстаграм. Учень отримає запрошення приєднатися до вашого кабінету.",
    cta: "Додати учня",
    to: "/my-students",
    action: "addStudent",
    icon: UserPlus,
    emoji: "👋",
    xp: 50,
    autoKey: "hasStudent",
    autoHint: "Учень доданий ✓",
  },
  {
    id: 2,
    title: "Складіть розклад",
    description:
      "Створіть перші уроки. Можна повторити щотижня, додати ціну, статус оплати — все в одному місці.",
    cta: "Перейти до розкладу",
    to: "/schedule",
    icon: CalendarClock,
    emoji: "📅",
    xp: 75,
    autoKey: "hasLesson",
    autoHint: "Урок створено ✓",
  },
  {
    id: 3,
    title: "Встанови доступні години",
    description:
      "Вкажи коли ти вільний для нових учнів — вони зможуть бронювати уроки самостійно у твої вільні слоти.",
    cta: "Налаштувати доступність",
    to: "/availability",
    icon: Clock,
    emoji: "🕐",
    xp: 75,
    autoKey: "hasAvailability",
    autoHint: "Доступність налаштовано ✓",
  },
  {
    id: 4,
    title: "Запроси колегу",
    description:
      "Поділись посиланням з іншим репетитором — він отримає 21 день тріалу, а ти — місяць безкоштовно коли він підпишеться.",
    cta: "Запросити колегу",
    to: "/referrals",
    icon: Gift,
    emoji: "🎁",
    xp: 100,
    badge: "Бонус",
    autoKey: "hasReferral",
    autoHint: "Запрошення створено ✓",
  },
  {
    id: 5,
    title: "Налаштуйте нагадування про оплату (Pro)",
    description:
      "Оберіть, коли учень отримує нагадування про оплату — передоплата, до уроку чи після. І чи стягувати % за пізнє скасування. Налаштування — у Профілі.",
    cta: "Перейти до правил Pro",
    to: "/profile",
    icon: BellRing,
    emoji: "🔔",
    xp: 75,
    badge: "Pro",
    autoKey: "hasPaymentRules",
    autoHint: "Правила збережено ✓",
  },
  {
    id: 6,
    title: "Як відмічати уроки проведеними",
    description:
      "Оберіть зручний для вас режим: автоматично через 1 годину після завершення — або вручну після кожного уроку. Перемикач — у Профілі.",
    cta: "Налаштувати у профілі",
    to: "/profile",
    icon: CheckSquare,
    emoji: "✅",
    xp: 50,
    autoKey: "hasAutoCompleteChoice",
    autoHint: "Режим обрано ✓",
  },
  {
    id: 7,
    title: "Підключіть Zoom або Google Meet",
    description:
      "Відкрийте картку учня → «Редагувати» і вставте постійне посилання на Zoom або Meet. Учень підключатиметься одним кліком з кожного уроку.",
    cta: "Відкрити «Мої учні»",
    to: "/my-students",
    action: "addStudent",
    icon: Video,
    emoji: "🎥",
    xp: 50,
    autoKey: "hasMeetingUrl",
    autoHint: "Посилання збережено ✓",
  },
  {
    id: 8,
    title: "Спілкуйтеся в чаті",
    description:
      "З кожним учнем — окремий чат. Надсилайте файли, домашку, нагадування. Все зберігається.",
    cta: "Відкрити чати",
    to: "/chats",
    icon: MessageCircle,
    emoji: "💬",
    xp: 50,
    autoKey: "hasChat",
    autoHint: "Чат відкрито ✓",
  },
  {
    id: 9,
    title: "Відмічайте оплати",
    description:
      "Позначайте оплачені уроки в розділі «Фінанси». Бачите статистику — скільки заробили, хто винен.",
    cta: "Перейти до фінансів",
    to: "/finances",
    icon: CreditCard,
    emoji: "💰",
    xp: 100,
    autoKey: "hasPaidLesson",
    autoHint: "Оплату відмічено ✓",
  },
  {
    id: 10,
    title: "Підключіть Google Calendar",
    description:
      "Уроки автоматично синхронізуються у ваш Google Календар — і для вас, і для учнів, які підключать свій акаунт.",
    cta: "Підключити Google Calendar",
    to: "/profile",
    icon: CalendarCheck,
    emoji: "📆",
    xp: 75,
    autoKey: "hasGoogleCalendar",
    autoHint: "Calendar підключено ✓",
  },
  {
    id: 11,
    title: "AI-конспекти лекцій",
    description:
      "Скоро: підключіть Fireflies — і Gemini сам зробить структурований конспект після кожного уроку.",
    cta: "Дізнатися більше",
    to: "/schedule",
    icon: Sparkles,
    emoji: "✨",
    xp: 150,
    badge: "Скоро",
  },
];

interface OnboardingContentProps {
  /** When set, link clicks will call this (e.g. close a containing modal) before navigating */
  onNavigate?: () => void;
  /** Called when user finishes the onboarding (Complete button) */
  onFinish?: () => void;
}

export function OnboardingContent({ onNavigate, onFinish }: OnboardingContentProps) {
  const navigate = useNavigate();
  const { user, roles } = useAuth();
  const { settings, loading, updateSettings, isIndependent } = useWorkspaceSettings();
  const [activatingIndependent, setActivatingIndependent] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [progress, setProgress] = useState<StepProgress>({
    hasStudent: false,
    hasLesson: false,
    hasAvailability: false,
    hasReferral: false,
    hasMeetingUrl: false,
    hasChat: false,
    hasPaidLesson: false,
    hasPaymentRules: false,
    hasAutoCompleteChoice: false,
    hasGoogleCalendar: false,
  });
  const [progressLoading, setProgressLoading] = useState(true);
  const [addStudentOpen, setAddStudentOpen] = useState(false);
  const [progressReloadKey, setProgressReloadKey] = useState(0);
  const [demoNotice, setDemoNotice] = useState<string | null>(null);

  // Auto-import demo data captured on the landing page (LandingTryDemo).
  useEffect(() => {
    if (!user || !isIndependent) return;
    let cancelled = false;
    (async () => {
      const raw = localStorage.getItem("tutorhub.demo");
      if (!raw) return;
      let demo: any;
      try { demo = JSON.parse(raw); } catch { localStorage.removeItem("tutorhub.demo"); return; }
      if (!demo) { localStorage.removeItem("tutorhub.demo"); return; }

      try {
        let studentId: string | null = null;
        const studentName: string | null =
          demo?.student?.name || demo?.lesson?.studentName || demo?.payment?.studentName || null;

        if (studentName) {
          const [first, ...rest] = studentName.split(/\s+/);
          const last = rest.join(" ");
          studentId = crypto.randomUUID();

          const { error: profErr } = await supabase
            .from("profiles")
            .insert({ id: studentId, first_name: first, last_name: last, is_pending: true });
          if (profErr) throw profErr;

          await supabase.from("user_roles").insert({ user_id: studentId, role: "student" });

          const subject = (demo?.student?.subject || "Загальний предмет").toString();
          const price = Number(demo?.student?.price ?? demo?.payment?.amount ?? 0) || 0;
          await supabase.from("student_rates").insert({
            tutor_id: user.id,
            student_id: studentId,
            subject,
            price_per_lesson: price,
            source: "independent",
          });
        }

        if (studentId && demo?.lesson?.date && demo?.lesson?.time) {
          const startsAt = new Date(`${demo.lesson.date}T${demo.lesson.time}:00`);
          if (!isNaN(startsAt.getTime())) {
            const subject = (demo?.student?.subject || "Загальний предмет").toString();
            const price = Number(demo?.student?.price ?? 0) || 0;
            const { data: inserted } = await supabase.from("lessons").insert({
              tutor_id: user.id,
              student_id: studentId,
              subject,
              starts_at: startsAt.toISOString(),
              duration_minutes: 60,
              status: "scheduled",
              source: "independent",
              created_by: user.id,
            } as any).select("id").single();
            if (inserted?.id) {
              await supabase.from("lesson_details").upsert({
                lesson_id: inserted.id,
                student_price: price,
                tutor_payout: 0,
                student_payment_status: "unpaid",
                tutor_payout_status: "unpaid",
              } as any, { onConflict: "lesson_id" });
            }
          }
        }

        if (!cancelled) {
          setDemoNotice(studentName);
          setProgressReloadKey((k) => k + 1);
        }
      } catch (err) {
        console.error("Demo import failed", err);
      } finally {
        localStorage.removeItem("tutorhub.demo");
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, isIndependent]);

  useEffect(() => {
    if (!user || !isIndependent) {
      setProgressLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setProgressLoading(true);
      const [
        { data: students },
        { data: lessons },
        { data: defaults },
        { data: threads },
        { data: paid },
        { data: availability },
        { data: referrals },
      ] = await Promise.all([
        supabase.from("student_rates").select("student_id").eq("tutor_id", user.id).eq("source", "independent").limit(1),
        supabase.from("lessons").select("id, meeting_url").eq("tutor_id", user.id).eq("source", "independent").limit(50),
        supabase.from("tutor_student_defaults").select("default_meeting_url").eq("tutor_id", user.id).limit(20),
        supabase.from("chat_threads").select("id").eq("tutor_id", user.id).limit(1),
        supabase
          .from("lesson_details")
          .select("lesson_id, lessons!inner(tutor_id, source)")
          .eq("lessons.tutor_id", user.id)
          .eq("lessons.source", "independent")
          .eq("student_payment_status", "paid")
          .limit(1),
        supabase.from("tutor_availability_weekly").select("id").eq("tutor_id", user.id).limit(1),
        supabase.from("referral_codes").select("id").eq("tutor_id", user.id).limit(1),
      ]);

      if (cancelled) return;

      const lessonsList = lessons ?? [];
      const defaultsList = defaults ?? [];
      const hasMeetingUrl =
        lessonsList.some((l: any) => l.meeting_url && l.meeting_url.trim()) ||
        defaultsList.some((d: any) => d.default_meeting_url && d.default_meeting_url.trim());

      setProgress({
        hasStudent: (students?.length ?? 0) > 0,
        hasLesson: lessonsList.length > 0,
        hasAvailability: (availability?.length ?? 0) > 0,
        hasReferral: (referrals?.length ?? 0) > 0,
        hasMeetingUrl,
        hasChat: (threads?.length ?? 0) > 0,
        hasPaidLesson: (paid?.length ?? 0) > 0,
        hasPaymentRules: Boolean((settings as any)?.payment_rules_configured),
        hasAutoCompleteChoice: Boolean((settings as any)?.auto_complete_prompted),
      });
      setProgressLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, isIndependent, progressReloadKey, (settings as any)?.payment_rules_configured, (settings as any)?.auto_complete_prompted]);

  const autoCompletedIds = useMemo(() => {
    const ids = new Set<number>();
    steps.forEach((s) => {
      if (s.autoKey && progress[s.autoKey]) ids.add(s.id);
    });
    return ids;
  }, [progress]);

  const savedStep = settings?.onboarding_step ?? 1;
  const completed = settings?.onboarding_completed ?? false;
  const totalDone = completed
    ? steps.length
    : Math.max(autoCompletedIds.size, Math.min(savedStep - 1, steps.length));
  const progressPct = Math.round((totalDone / steps.length) * 100);

  useEffect(() => {
    if (!settings || progressLoading || completed) return;
    const nextStep = Math.min(autoCompletedIds.size + 1, steps.length);
    if (nextStep > (settings.onboarding_step ?? 1)) {
      updateSettings({ onboarding_step: nextStep });
    }
    if (autoCompletedIds.size === steps.length && !completed) {
      updateSettings({ onboarding_completed: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCompletedIds.size, progressLoading, completed]);

  const enableIndependent = async () => {
    setActivatingIndependent(true);
    await updateSettings({ independent_workspace: true, onboarding_step: 1 });
    setActivatingIndependent(false);
  };

  const skipStep = async (stepId: number) => {
    const next = Math.min(stepId + 1, steps.length);
    await updateSettings({ onboarding_step: next });
  };

  const finishOnboarding = async () => {
    setDismissing(true);
    await updateSettings({ onboarding_completed: true });
    setDismissing(false);
    if (onFinish) onFinish();
    else navigate("/");
  };

  const handleNav = () => {
    if (onNavigate) onNavigate();
  };

  // Redirect non-tutors away (page-only behavior; modal callers should gate themselves)
  useEffect(() => {
    if (!loading && user && !roles.includes("tutor") && !onNavigate) {
      navigate("/", { replace: true });
    }
  }, [loading, user, roles, navigate, onNavigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isIndependent) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <CardTitle>Активуйте власний робочий простір</CardTitle>
            <CardDescription>
              Ведіть своїх власних учнів — окремо від хабу. Ставте ціни самі, отримуйте оплати напряму.
              До 5 учнів — безкоштовно, далі 145 ₴/міс.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              <li>• Окремий розділ «Мої учні» з контактами і ставками</li>
              <li>• Власний розклад, оплати та статистика</li>
              <li>• Чати, домашка та посилання на Zoom/Meet — як у хабі</li>
            </ul>
            <Button onClick={enableIndependent} disabled={activatingIndependent} className="w-full">
              {activatingIndependent ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Активувати робочий простір
            </Button>
            <Button variant="ghost" className="w-full" onClick={handleNav} asChild>
              <Link to="/">Я працюю лише з учнями хабу</Link>
            </Button>
            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              <p className="font-medium text-foreground">Що це означає?</p>
              <p className="mt-1 text-muted-foreground">
                Ви працюєте лише з учнями, яких призначає менеджер школи. У вас немає власних учнів — розклад,
                оплата та комунікація проходять через хаб. Підписка не потрібна.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const allDone = autoCompletedIds.size === steps.filter((s) => s.autoKey).length;
  const earnedXP = steps.filter((s) => s.autoKey && progress[s.autoKey]).reduce((sum, s) => sum + s.xp, 0);
  const totalXP = steps.reduce((sum, s) => sum + s.xp, 0);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 overflow-hidden rounded-3xl border-2 border-primary/20 bg-gradient-to-br from-primary/10 via-card to-success/10 p-5 shadow-[0_8px_30px_-8px_hsl(var(--primary)/0.2)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-bold text-foreground">
              Ласкаво просимо! <span className="inline-block animate-wiggle-slow">👋</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Виконайте квести — отримайте XP і налаштуйте простір.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="gamify-sticker">
              ⭐ {earnedXP} / {totalXP} XP
            </span>
            <span className="gamify-sticker success">🏆 Рівень {totalDone}</span>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-background/60 ring-1 ring-border">
            <div
              className="h-full gamify-progress-fill transition-all duration-700"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="font-display text-sm font-bold text-foreground">{progressPct}%</span>
        </div>
      </div>

      {demoNotice && (
        <div className="mb-4 rounded-2xl border-2 border-primary/30 bg-primary/5 p-4">
          <p className="text-sm text-foreground">
            Ми вже зберегли <span className="font-bold">{demoNotice}</span> — продовжуй з наступного кроку 🎉
          </p>
        </div>
      )}

      {(allDone || completed) && (
        <div className="mb-4 overflow-hidden rounded-2xl border-2 border-success/40 bg-gradient-to-r from-success/10 to-primary/10 p-4 animate-pop">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-success text-success-foreground shadow-lg animate-bounce-soft">
              <PartyPopper className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <p className="font-display text-base font-bold text-foreground">🎉 Квест завершено!</p>
              <p className="text-xs text-muted-foreground">
                Ваш робочий простір готовий. Можете повертатись сюди з розділу «Допомога».
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => {
                if (onFinish) onFinish();
                else navigate("/");
              }}
              className="rounded-full"
            >
              На дашборд
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {steps.map((step) => {
          const isAutoDone = step.autoKey ? progress[step.autoKey] : false;
          const isDone = isAutoDone || completed;
          const isCurrent = !isDone && savedStep === step.id;
          return (
            <div
              key={step.id}
              className={cn(
                "gamify-card overflow-hidden",
                isCurrent && "border-primary ring-2 ring-primary/20",
                isDone && "opacity-75"
              )}
            >
              <div className="flex items-start gap-4 p-4">
                <div
                  className={cn(
                    "relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-2xl shadow-md transition-transform",
                    isDone
                      ? "bg-gradient-to-br from-success to-success/70 text-success-foreground"
                      : isCurrent
                      ? "bg-gradient-to-br from-primary to-primary/70 text-primary-foreground animate-bounce-soft"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {isDone ? (
                    <CheckCircle2 className="h-7 w-7 animate-pop" />
                  ) : (
                    <span aria-hidden>{step.emoji}</span>
                  )}
                  <span className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-card text-[10px] font-black text-foreground shadow ring-1 ring-border">
                    {step.id}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display font-bold text-foreground">{step.title}</h3>
                    <span className="gamify-sticker warning text-[10px]">+{step.xp} XP</span>
                    {step.badge && (
                      <Badge variant="outline" className="text-[10px]">
                        {step.badge}
                      </Badge>
                    )}
                    {isAutoDone && step.autoHint && (
                      <span className="gamify-sticker success text-[10px] animate-pop">
                        {step.autoHint}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
                  {!isDone && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {step.action === "addStudent" ? (
                        <Button
                          size="sm"
                          variant={isCurrent ? "default" : "outline"}
                          className="rounded-full hover:scale-105 transition-transform"
                          onClick={() => setAddStudentOpen(true)}
                        >
                          {step.cta}
                          <ArrowRight className="ml-1 h-3 w-3" />
                        </Button>
                      ) : (
                        <Button
                          asChild
                          size="sm"
                          variant={isCurrent ? "default" : "outline"}
                          className="rounded-full hover:scale-105 transition-transform"
                          onClick={handleNav}
                        >
                          <Link to={step.to}>
                            {step.cta}
                            <ArrowRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                      )}
                      {isCurrent && step.autoKey && (
                        <Button size="sm" variant="ghost" className="rounded-full" onClick={() => skipStep(step.id)}>
                          Пропустити
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex justify-end">
        <Button variant="ghost" onClick={finishOnboarding} disabled={dismissing}>
          {dismissing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {completed ? "Закрити" : "Завершити онбординг"}
        </Button>
      </div>

      <QuickAddStudentDialog
        open={addStudentOpen}
        onOpenChange={setAddStudentOpen}
        onCreated={() => setProgressReloadKey((k) => k + 1)}
      />
    </div>
  );
}
