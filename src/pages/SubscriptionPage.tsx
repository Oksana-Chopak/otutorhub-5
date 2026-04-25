import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { usePaywallTracking } from "@/hooks/usePaywallTracking";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Check,
  Crown,
  Loader2,
  Sparkles,
  Users,
  Infinity as InfinityIcon,
  Clock,
  CheckCircle2,
  XCircle,
  MessageCircle,
  BellRing,
  CalendarX2,
  BarChart3,
  FileDown,
  Gift,
  UserPlus,
  Headset,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SubscriptionRequestDialog } from "@/components/SubscriptionRequestDialog";
import { LiqPayPayButton } from "@/components/LiqPayPayButton";
import { ProRulesCard } from "@/components/ProRulesCard";
import { format } from "date-fns";
import { uk } from "date-fns/locale";

const PRO_PRICE_MONTHLY = 129;
const PRO_PRICE_YEARLY_PER_MONTH = 99;
const PRO_PRICE_YEARLY_TOTAL = PRO_PRICE_YEARLY_PER_MONTH * 12;

const freePerks = [
  "Необмежена кількість учнів",
  "Розклад, чат з учнями, домашка",
  "Облік оплат і прибутку",
  "Постійні Zoom/Meet-посилання",
  "Базова статистика по доходах",
];

const proPerks: { icon: typeof BellRing; title: string; desc: string }[] = [
  {
    icon: BellRing,
    title: "Авто-нагадування про оплату",
    desc: "Учень отримує нагадування у Telegram. Ви обираєте: передоплата, за день до уроку чи за N днів після.",
  },
  {
    icon: CalendarX2,
    title: "Скасування і перенесення учнем",
    desc: "Ви задаєте, за скільки годин до уроку дозволено безкоштовно. Запізно — повна або часткова оплата.",
  },
  {
    icon: BarChart3,
    title: "Преміум-аналітика з порадами",
    desc: "Красиві графіки доходів, динаміка по учнях, аналіз і поради, що покращити.",
  },
  {
    icon: FileDown,
    title: "Детальні звіти та експорт",
    desc: "Формуйте звіт за будь-який період і вивантажуйте у CSV/PDF.",
  },
  {
    icon: UserPlus,
    title: "Більше учнів з нашого Хабу",
    desc: "Пріоритетні рекомендації нових учнів зі спільноти oTutorHub.",
  },
  {
    icon: Headset,
    title: "Персональна підтримка менеджера",
    desc: "Особистий менеджер швидко допоможе з будь-яким питанням і налаштуваннями.",
  },
];

interface RequestRow {
  id: string;
  status: "new" | "in_progress" | "completed" | "rejected";
  message: string | null;
  manager_response: string | null;
  created_at: string;
  handled_at: string | null;
}

const statusMeta: Record<
  RequestRow["status"],
  {
    label: string;
    icon: typeof Clock;
    tone: "default" | "secondary" | "outline" | "destructive";
    description: string;
  }
> = {
  new: {
    label: "Очікує менеджера",
    icon: Clock,
    tone: "default",
    description: "Менеджер уже бачить ваш запит і скоро з вами зв'яжеться.",
  },
  in_progress: {
    label: "В обробці",
    icon: Loader2,
    tone: "secondary",
    description: "Менеджер опрацьовує ваш запит — очікуйте контакту.",
  },
  completed: {
    label: "Завершено",
    icon: CheckCircle2,
    tone: "outline",
    description: "Запит виконано. Якщо підписка ще не активна — напишіть менеджеру.",
  },
  rejected: {
    label: "Відхилено",
    icon: XCircle,
    tone: "destructive",
    description: "Менеджер відхилив запит. Деталі — у відповіді нижче.",
  },
};

export default function SubscriptionPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, roles } = useAuth();
  const { trackPaywallClick } = usePaywallTracking();
  const {
    settings,
    loading,
    isIndependent,
    studentCount,
    isPro,
    isTrial,
    trialUntil,
    trialDaysLeft,
  } = useWorkspaceSettings();
  const [requestOpen, setRequestOpen] = useState(false);
  const [latestRequest, setLatestRequest] = useState<RequestRow | null>(null);
  const [requestLoading, setRequestLoading] = useState(true);
  const [billing, setBilling] = useState<"monthly" | "yearly">("yearly");

  useEffect(() => {
    if (!loading && user && (!roles.includes("tutor") || !isIndependent)) {
      navigate("/", { replace: true });
    }
  }, [loading, user, roles, isIndependent, navigate]);

  // Track визиту сторінки підписки + звідки прийшли (для воронки)
  useEffect(() => {
    if (!user) return;
    trackPaywallClick("subscription_page_visit", "subscription_page", {
      from: searchParams.get("from") ?? "direct",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Показуємо тост після повернення з LiqPay
  useEffect(() => {
    if (searchParams.get("paid") === "1") {
      import("sonner").then(({ toast }) => {
        toast.success("Дякуємо за оплату! Підписка активується протягом хвилини.");
      });
    }
  }, [searchParams]);

  const loadRequest = async () => {
    if (!user) return;
    setRequestLoading(true);
    const { data } = await supabase
      .from("subscription_requests")
      .select("id, status, message, manager_response, created_at, handled_at")
      .eq("tutor_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setLatestRequest((data as RequestRow | null) ?? null);
    setRequestLoading(false);
  };

  useEffect(() => {
    loadRequest();
    if (!user) return;
    const channel = supabase
      .channel(`my_subscription_requests_${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "subscription_requests",
          filter: `tutor_id=eq.${user.id}`,
        },
        () => loadRequest()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

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
  const isActive = status === "active";

  const handleUpgrade = () => {
    setRequestOpen(true);
  };

  const proPrice = billing === "yearly" ? PRO_PRICE_YEARLY_PER_MONTH : PRO_PRICE_MONTHLY;

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold text-foreground">Підписка</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Безкоштовний план — без обмежень. Pro-план додає автонагадування учням про оплати, керування скасуванням або перенесенням уроків, преміум-аналітику і можливість набирати додаткових учнів з хабу.
          </p>
        </div>

        {/* Trial banner */}
        {isTrial && trialUntil && (
          <Card className="mb-4 border-primary/40 bg-primary/[0.04]">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Gift className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium text-foreground">
                    Ви на безкоштовному Pro-тріалі
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Залишилось {trialDaysLeft}{" "}
                    {trialDaysLeft === 1
                      ? "день"
                      : trialDaysLeft >= 2 && trialDaysLeft <= 4
                      ? "дні"
                      : "днів"}{" "}
                    · до{" "}
                    {format(trialUntil, "d MMMM, HH:mm", { locale: uk })}
                  </p>
                </div>
              </div>
              <Badge variant="default" className="gap-1">
                <Sparkles className="h-3 w-3" /> Pro доступний
              </Badge>
            </CardContent>
          </Card>
        )}

        {/* Current plan card */}
        <Card className="mb-6">
          <CardContent className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
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
                    {isActive
                      ? "Pro"
                      : isTrial
                      ? "Pro (тріал)"
                      : "Безкоштовний"}
                  </p>
                </div>
              </div>
              <Badge variant={isPro ? "default" : "secondary"}>
                {isActive
                  ? "Активна"
                  : isTrial
                  ? "Тріал"
                  : status === "past_due"
                  ? "Прострочена"
                  : "Free"}
              </Badge>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Учнів зараз: <span className="font-semibold text-foreground">{studentCount}</span>{" "}
              <span className="inline-flex items-center gap-1 align-middle">
                / <InfinityIcon className="inline h-3.5 w-3.5" />
              </span>
            </p>
          </CardContent>
        </Card>

        {/* Latest subscription request status */}
        {!requestLoading && latestRequest && !isActive && (() => {
          const meta = statusMeta[latestRequest.status];
          const StatusIcon = meta.icon;
          return (
            <Card className="mb-6 border-primary/30 bg-primary/[0.03]">
              <CardContent className="space-y-3 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <StatusIcon
                        className={cn(
                          "h-4 w-4",
                          latestRequest.status === "in_progress" && "animate-spin"
                        )}
                      />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Ваш запит на Pro
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Надіслано{" "}
                        {format(new Date(latestRequest.created_at), "d MMM, HH:mm", {
                          locale: uk,
                        })}
                      </p>
                    </div>
                  </div>
                  <Badge variant={meta.tone}>{meta.label}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{meta.description}</p>
                {latestRequest.message && (
                  <div className="rounded-lg bg-muted/40 p-3 text-sm">
                    <div className="mb-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MessageCircle className="h-3.5 w-3.5" /> Ваше повідомлення
                    </div>
                    <p className="text-foreground">{latestRequest.message}</p>
                  </div>
                )}
                {latestRequest.manager_response && (
                  <div className="rounded-lg border border-border p-3 text-sm">
                    <div className="mb-1 text-xs text-muted-foreground">
                      Відповідь менеджера
                    </div>
                    <p className="text-foreground">{latestRequest.manager_response}</p>
                  </div>
                )}
                {(latestRequest.status === "completed" ||
                  latestRequest.status === "rejected") && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRequestOpen(true)}
                  >
                    Надіслати новий запит
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {/* Billing toggle */}
        <div className="mb-4 flex justify-center">
          <div className="inline-flex rounded-full border border-border bg-muted/40 p-1">
            <button
              type="button"
              onClick={() => setBilling("monthly")}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium transition",
                billing === "monthly"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Щомісяця
            </button>
            <button
              type="button"
              onClick={() => setBilling("yearly")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition",
                billing === "yearly"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Щороку
              <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold text-success">
                −23%
              </span>
            </button>
          </div>
        </div>

        {/* Plans */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Free */}
          <Card className={cn(!isPro && "border-primary/40")}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Безкоштовний</CardTitle>
                {!isPro && <Badge variant="secondary">Поточний</Badge>}
              </div>
              <CardDescription>Назавжди. Без картки. Без обмежень за учнями.</CardDescription>
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
                {isActive && <Badge>Поточний</Badge>}
                {isTrial && !isActive && <Badge variant="secondary">Тріал</Badge>}
              </div>
              <CardDescription>
                14 днів повного Pro безкоштовно — без картки.
              </CardDescription>
              <div className="mt-2 flex items-baseline gap-2">
                <p className="font-display text-3xl font-bold text-foreground">
                  {proPrice} ₴
                </p>
                <span className="text-sm text-muted-foreground">/міс</span>
                {billing === "yearly" && (
                  <span className="text-xs text-muted-foreground">
                    · {PRO_PRICE_YEARLY_TOTAL} ₴ на рік
                  </span>
                )}
              </div>
              {billing === "monthly" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Або {PRO_PRICE_YEARLY_PER_MONTH} ₴/міс при оплаті за рік
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-3 text-sm">
                {proPerks.map(({ icon: Icon, title, desc }) => (
                  <li key={title} className="flex items-start gap-2.5">
                    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{title}</p>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                  </li>
                ))}
              </ul>
              {(() => {
                const hasPending =
                  latestRequest &&
                  (latestRequest.status === "new" || latestRequest.status === "in_progress");
                if (isActive) {
                  return (
                    <Button className="w-full" disabled>
                      Підписка активна
                    </Button>
                  );
                }
                return (
                  <div className="space-y-2">
                    <LiqPayPayButton
                      plan={billing}
                      recurring
                      className="w-full"
                      label={
                        billing === "yearly"
                          ? `Сплатити ${PRO_PRICE_YEARLY_TOTAL} ₴ карткою`
                          : `Сплатити ${PRO_PRICE_MONTHLY} ₴ карткою`
                      }
                    />
                    <Button
                      onClick={handleUpgrade}
                      variant="outline"
                      className="w-full"
                      disabled={!!hasPending}
                    >
                      {hasPending ? "Запит уже надіслано" : "Через менеджера"}
                    </Button>
                  </div>
                );
              })()}
              <p className="text-center text-xs text-muted-foreground">
                Оплата карткою через LiqPay — доступ активується автоматично за кілька секунд.{" "}
                {billing === "yearly"
                  ? "Підписка автоматично продовжуватиметься щороку. Скасувати можна будь-коли."
                  : "Підписка автоматично продовжуватиметься щомісяця. Скасувати можна будь-коли."}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="mt-6">
          <ProRulesCard />
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Тріал не вимагає картки. Після його завершення ви автоматично переходите на безкоштовний план — нічого не списується.
        </p>
      </div>
      <SubscriptionRequestDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        defaultBilling={billing}
      />
    </AppLayout>
  );
}
