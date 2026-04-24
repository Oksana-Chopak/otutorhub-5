import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings, FREE_STUDENT_LIMIT } from "@/hooks/useWorkspaceSettings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Check, Crown, Loader2, Sparkles, Users, Infinity as InfinityIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SubscriptionRequestDialog } from "@/components/SubscriptionRequestDialog";

const PRO_PRICE = 145;

const freePerks = [
  `До ${FREE_STUDENT_LIMIT} учнів`,
  "Розклад, чат з учнями, домашка",
  "Облік оплат і прибутку",
  "Постійні Zoom/Meet-посилання",
];

const proPerks = [
  "Необмежена кількість учнів",
  "Усе з безкоштовного плану",
  "AI-конспекти лекцій",
  "Пріоритетна підтримка",
];

export default function SubscriptionPage() {
  const navigate = useNavigate();
  const { user, roles } = useAuth();
  const { settings, loading, isIndependent, studentCount } = useWorkspaceSettings();
  const [requestOpen, setRequestOpen] = useState(false);

  useEffect(() => {
    if (!loading && user && (!roles.includes("tutor") || !isIndependent)) {
      navigate("/", { replace: true });
    }
  }, [loading, user, roles, isIndependent, navigate]);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  const status = settings?.subscription_status ?? "free";
  const isPro = status === "active";
  const usagePct = Math.min(100, Math.round((studentCount / FREE_STUDENT_LIMIT) * 100));
  const remaining = Math.max(0, FREE_STUDENT_LIMIT - studentCount);

  const handleUpgrade = () => {
    setRequestOpen(true);
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold text-foreground">Підписка</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Керуйте своїм планом і слідкуйте за використанням.
          </p>
        </div>

        {/* Current usage */}
        <Card className="mb-6">
          <CardContent className="p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full",
                    isPro ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                  )}
                >
                  {isPro ? <Crown className="h-5 w-5" /> : <Users className="h-5 w-5" />}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Поточний план</p>
                  <p className="font-display text-lg font-semibold text-foreground">
                    {isPro ? "Pro — 145 ₴/міс" : "Безкоштовний"}
                  </p>
                </div>
              </div>
              <Badge variant={isPro ? "default" : "secondary"}>
                {isPro ? "Активна" : status === "past_due" ? "Прострочена" : "Free"}
              </Badge>
            </div>

            {!isPro && (
              <>
                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Використано {studentCount} з {FREE_STUDENT_LIMIT} учнів
                  </span>
                  <span>{remaining > 0 ? `Залишилось ${remaining}` : "Ліміт досягнуто"}</span>
                </div>
                <Progress value={usagePct} className="h-2" />
              </>
            )}
            {isPro && (
              <p className="text-sm text-muted-foreground">
                Учнів зараз: <span className="font-semibold text-foreground">{studentCount}</span>{" "}
                <span className="inline-flex items-center gap-1 align-middle">
                  / <InfinityIcon className="inline h-3.5 w-3.5" />
                </span>
              </p>
            )}
          </CardContent>
        </Card>

        {/* Plans */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Free */}
          <Card className={cn(!isPro && "border-primary/40")}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Безкоштовний</CardTitle>
                {!isPro && <Badge variant="secondary">Поточний</Badge>}
              </div>
              <CardDescription>Для старту з невеликою кількістю учнів</CardDescription>
              <p className="mt-2 font-display text-3xl font-bold text-foreground">
                0 ₴ <span className="text-sm font-normal text-muted-foreground">/міс</span>
              </p>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {freePerks.map((perk) => (
                  <li key={perk} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    <span className="text-foreground">{perk}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Pro */}
          <Card className={cn("relative", isPro ? "border-primary" : "border-primary/40")}>
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <Badge className="gap-1">
                <Sparkles className="h-3 w-3" /> Рекомендовано
              </Badge>
            </div>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Pro</CardTitle>
                {isPro && <Badge>Поточний</Badge>}
              </div>
              <CardDescription>Для активних репетиторів без обмежень</CardDescription>
              <p className="mt-2 font-display text-3xl font-bold text-foreground">
                {PRO_PRICE} ₴ <span className="text-sm font-normal text-muted-foreground">/міс</span>
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-2 text-sm">
                {proPerks.map((perk) => (
                  <li key={perk} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    <span className="text-foreground">{perk}</span>
                  </li>
                ))}
              </ul>
              <Button onClick={handleUpgrade} className="w-full" disabled={isPro}>
                {isPro ? "Підписка активна" : "Оформити підписку"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Онлайн-оплата готується. Поки що — оплата вручну через менеджера.
              </p>
            </CardContent>
          </Card>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Скасувати або змінити план можна в будь-який момент. Залишок дня не пропадає.
        </p>
      </div>
    </AppLayout>
  );
}
