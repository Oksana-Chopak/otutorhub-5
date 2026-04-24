import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
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
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Step {
  id: number;
  title: string;
  description: string;
  cta: string;
  to: string;
  icon: typeof UserPlus;
  badge?: string;
}

const steps: Step[] = [
  {
    id: 1,
    title: "Додайте першого учня",
    description:
      "Введіть ім'я, телефон, email, телеграм/інстаграм. Учень отримає запрошення приєднатися до вашого кабінету.",
    cta: "Додати учня",
    to: "/my-students",
    icon: UserPlus,
  },
  {
    id: 2,
    title: "Складіть розклад",
    description:
      "Створіть перші уроки. Можна повторити щотижня, додати ціну, статус оплати — все в одному місці.",
    cta: "Перейти до розкладу",
    to: "/schedule",
    icon: CalendarClock,
  },
  {
    id: 3,
    title: "Підключіть Zoom або Google Meet",
    description:
      "Для кожного учня збережіть постійне посилання на зустріч — учні зможуть приєднуватися одним кліком.",
    cta: "Налаштувати зустрічі",
    to: "/schedule",
    icon: Video,
  },
  {
    id: 4,
    title: "AI-конспекти лекцій",
    description:
      "Хочете, щоб після уроку Gemini сам зробив структурований конспект із запису Fireflies? Напишіть менеджеру — підключимо для вас.",
    cta: "Написати менеджеру",
    to: "/chats",
    icon: Sparkles,
  },
  {
    id: 5,
    title: "Спілкуйтеся в чаті",
    description:
      "З кожним учнем — окремий чат. Надсилайте файли, домашку, нагадування. Все зберігається.",
    cta: "Відкрити чати",
    to: "/chats",
    icon: MessageCircle,
  },
  {
    id: 6,
    title: "Відмічайте оплати",
    description:
      "Позначайте оплачені уроки. На дашборді бачите статистику — скільки заробили, хто винен.",
    cta: "Перейти на дашборд",
    to: "/",
    icon: CreditCard,
  },
];

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { user, roles } = useAuth();
  const { settings, loading, updateSettings, isIndependent } = useWorkspaceSettings();
  const [activatingIndependent, setActivatingIndependent] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  // Redirect non-tutors away
  useEffect(() => {
    if (!loading && user && !roles.includes("tutor")) {
      navigate("/", { replace: true });
    }
  }, [loading, user, roles, navigate]);

  const currentStep = settings?.onboarding_step ?? 1;
  const completed = settings?.onboarding_completed ?? false;
  const progressPct = completed ? 100 : Math.round(((currentStep - 1) / steps.length) * 100);

  const enableIndependent = async () => {
    setActivatingIndependent(true);
    await updateSettings({ independent_workspace: true, onboarding_step: 1 });
    setActivatingIndependent(false);
  };

  const markStepDone = async (stepId: number) => {
    const next = Math.min(stepId + 1, steps.length + 1);
    const isComplete = next > steps.length;
    await updateSettings({
      onboarding_step: Math.min(next, steps.length),
      onboarding_completed: isComplete ? true : settings?.onboarding_completed ?? false,
    });
  };

  const finishOnboarding = async () => {
    setDismissing(true);
    await updateSettings({ onboarding_completed: true });
    setDismissing(false);
    navigate("/");
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  // If tutor isn't independent yet, offer activation
  if (!isIndependent) {
    return (
      <AppLayout>
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
            <CardContent>
              <Button onClick={enableIndependent} disabled={activatingIndependent} className="w-full">
                {activatingIndependent ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Активувати робочий простір
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold text-foreground">
            Ласкаво просимо у ваш робочий простір 👋
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            6 кроків — і ви готові працювати з власними учнями.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <Progress value={progressPct} className="h-2 flex-1" />
            <span className="text-xs font-medium text-muted-foreground">
              {progressPct}%
            </span>
          </div>
        </div>

        <div className="space-y-3">
          {steps.map((step) => {
            const isDone = completed || currentStep > step.id;
            const isCurrent = !completed && currentStep === step.id;
            const Icon = step.icon;
            return (
              <Card
                key={step.id}
                className={cn(
                  "transition-colors",
                  isCurrent && "border-primary",
                  isDone && "opacity-70"
                )}
              >
                <CardContent className="flex items-start gap-4 p-4">
                  <div
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                      isDone
                        ? "bg-success/15 text-success"
                        : isCurrent
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {isDone ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-foreground">
                        Крок {step.id}: {step.title}
                      </h3>
                      {step.badge && (
                        <Badge variant="outline" className="text-[10px]">
                          {step.badge}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
                    {!isDone && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          asChild
                          size="sm"
                          variant={isCurrent ? "default" : "outline"}
                          onClick={() => markStepDone(step.id)}
                        >
                          <Link to={step.to}>
                            {step.cta}
                            <ArrowRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                        {isCurrent && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => markStepDone(step.id)}
                          >
                            Пропустити
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mt-6 flex justify-end">
          <Button variant="ghost" onClick={finishOnboarding} disabled={dismissing}>
            {dismissing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {completed ? "На дашборд" : "Завершити онбординг"}
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
