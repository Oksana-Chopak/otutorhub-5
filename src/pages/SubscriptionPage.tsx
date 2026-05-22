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

import { format } from "date-fns";
import { uk } from "date-fns/locale";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

const PRO_PRICE_MONTHLY = 129;
const PRO_PRICE_YEARLY_PER_MONTH = 99;
const PRO_PRICE_YEARLY_TOTAL = PRO_PRICE_YEARLY_PER_MONTH * 12;

const proPerks: { icon: typeof BellRing; title: string; desc: string }[] = [
  {
    icon: BellRing,
    title: t("subscriptionPage.autoReminder"),
    desc: "Учень отримує нагадування у Telegram. Ви обираєте: передоплата, за день до уроку чи за N днів після.",
  },
  {
    icon: CalendarX2,
    title: t("subscriptionPage.cancelPolicy"),
    desc: t("subscriptionPage.cancelPolicyDesc"),
  },
  {
    icon: BarChart3,
    title: t("subscriptionPage.premiumAnalytics"),
    desc: t("subscriptionPage.premiumAnalyticsDesc"),
  },
  {
    icon: FileDown,
    title: t("subscriptionPageExtra.detailedReports"),
    desc: t("subscriptionPageExtra.detailedReportsDesc"),
  },
  {
    icon: UserPlus,
    title: t("subscriptionPageExtra.moreStudents"),
    desc: t("subscriptionPageExtra.moreStudentsDesc"),
  },
  {
    icon: Headset,
    title: t("subscriptionPageExtra.personalManager"),
    desc: t("subscriptionPageExtra.personalManagerDesc"),
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
    label: t("subscriptionPageExtra.pendingManager"),
    icon: Clock,
    tone: "default",
    description: t("subscriptionPageExtra.pendingManagerDesc"),
  },
  in_progress: {
    label: t("subscriptionPageExtra.inProgress"),
    icon: Loader2,
    tone: "secondary",
    description: t("subscriptionPageExtra.inProgressDesc"),
  },
  completed: {
    label: t("subscriptionPageExtra.completed"),
    icon: CheckCircle2,
    tone: "outline",
    description: t("subscriptionPageExtra.completedDesc"),
  },
  rejected: {
    label: t("subscriptionPageExtra.rejected"),
    icon: XCircle,
    tone: "destructive",
    description: t("subscriptionPageExtra.rejectedDesc"),
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
  const subscriptionUntil = settings?.subscription_until ? new Date(settings.subscription_until) : null;
  const [requestOpen, setRequestOpen] = useState(false);
  const [latestRequest, setLatestRequest] = useState<RequestRow | null>(null);
  const [requestLoading, setRequestLoading] = useState(true);
  const [billing, setBilling] = useState<"monthly" | "yearly">("yearly");
  const [earlyBirdCount, setEarlyBirdCount] = useState<number | null>(null);
  const EARLY_BIRD_LIMIT = 20;
  const REGULAR_PRICE_MONTHLY = 129;
  // Дедлайн акції — 14 днів від моменту першого відкриття. Зберігаємо в localStorage,
  // щоб у одного користувача таймер не «скакав» між заходами.
  const EARLY_BIRD_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
  const [now, setNow] = useState(() => Date.now());
  const [earlyBirdDeadline] = useState<number>(() => {
    if (typeof window === "undefined") return Date.now() + EARLY_BIRD_DURATION_MS;
    const key = "early_bird_deadline_v1";
    const stored = window.localStorage.getItem(key);
    if (stored) {
      const n = Number(stored);
      if (Number.isFinite(n) && n > Date.now()) return n;
    }
    const next = Date.now() + EARLY_BIRD_DURATION_MS;
    window.localStorage.setItem(key, String(next));
    return next;
  });
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

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
        toast.success(t("subscriptionPageExtra.paymentSuccess"));
      });
    }
  }, [searchParams]);

  // Лічильник перших 20 Pro-репетиторів (active + trial)
  useEffect(() => {
    let cancelled = false;
    const loadCount = async () => {
      const { count } = await supabase
        .from("tutor_workspace_settings")
        .select("tutor_id", { count: "exact", head: true })
        .eq("independent_workspace", true)
        .in("subscription_status", ["active", "trial"]);
      if (!cancelled) setEarlyBirdCount(count ?? 0);
    };
    loadCount();
    const channel = supabase
      .channel("early_bird_count")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tutor_workspace_settings" },
        () => loadCount()
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

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
  // Тріальні/early-bird банери показуємо лише новим репетиторам, які ще не починали тріал
  const eligibleForTrial = !settings?.trial_until && status === "free" && !isActive;

  const handleUpgrade = () => {
    setRequestOpen(true);
  };

  const proPrice = billing === "yearly" ? PRO_PRICE_YEARLY_PER_MONTH : PRO_PRICE_MONTHLY;

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold text-foreground">{t("subscriptionPage.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            30 днів безкоштовного тріалу — без картки. Після — {PRO_PRICE_MONTHLY} ₴/місяць.
            <br />
            Перші {EARLY_BIRD_LIMIT} репетиторів отримують Pro безкоштовно на пів року.
          </p>
        </div>

        {/* Early-bird спотлайт-банер */}
        {eligibleForTrial && earlyBirdCount !== null && earlyBirdCount < EARLY_BIRD_LIMIT && (
          <Card className="mb-4 border-primary/50 bg-gradient-to-r from-primary/[0.10] to-primary/[0.04]">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="text-sm font-semibold text-foreground">
                🔥 Залишилось {EARLY_BIRD_LIMIT - earlyBirdCount} безкоштовних місць з {EARLY_BIRD_LIMIT} — займи своє!
              </p>
              <Badge variant="default" className="gap-1">
                <Sparkles className="h-3 w-3" /> Early bird
              </Badge>
            </CardContent>
          </Card>
        )}

        {/* Early-bird акція */}
        {eligibleForTrial && (() => {
          const taken = earlyBirdCount ?? 0;
          const left = Math.max(0, EARLY_BIRD_LIMIT - taken);
          const progress = Math.min(100, (taken / EARLY_BIRD_LIMIT) * 100);
          const soldOut = left === 0;
          return (
            <Card className="mb-4 overflow-hidden border-primary/40 bg-gradient-to-br from-primary/[0.08] via-primary/[0.04] to-transparent">
              <CardContent className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary text-xl">
                      🎁
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-display text-base font-bold text-foreground">
                          30 днів безкоштовно — спробуй без картки
                        </p>
                        {!soldOut && (
                          <Badge variant="default" className="gap-1">
                            <Sparkles className="h-3 w-3" /> Early bird
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Після тріалу —{" "}
                        <span className="font-semibold text-foreground">
                          {PRO_PRICE_YEARLY_PER_MONTH} ₴/міс
                        </span>{" "}
                        для перших {EARLY_BIRD_LIMIT} репетиторів{" "}
                        <span className="text-muted-foreground">
                          (потім {REGULAR_PRICE_MONTHLY} ₴/міс)
                        </span>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Live countdown — створює реальне відчуття терміновості */}
                {(() => {
                  const msLeft = Math.max(0, earlyBirdDeadline - now);
                  const totalSec = Math.floor(msLeft / 1000);
                  const days = Math.floor(totalSec / 86400);
                  const hours = Math.floor((totalSec % 86400) / 3600);
                  const minutes = Math.floor((totalSec % 3600) / 60);
                  const seconds = totalSec % 60;
                  const Cell = ({ n, label }: { n: number; label: string }) => (
                    <div className="flex flex-col items-center rounded-lg bg-background/80 px-2.5 py-1.5 ring-1 ring-border min-w-[44px]">
                      <span className="font-display text-base font-bold tabular-nums text-foreground leading-none">
                        {String(n).padStart(2, "0")}
                      </span>
                      <span className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                        {label}
                      </span>
                    </div>
                  );
                  return (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
                        <Clock className="h-3.5 w-3.5 text-primary" />
                        До кінця акції:
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Cell n={days} label={t("subscriptionPageExtra.daysLabel")} />
                        <Cell n={hours} label={t("subscriptionPageExtra.hoursLabel")} />
                        <Cell n={minutes} label="хв" />
                        <Cell n={seconds} label={t("subscriptionPageExtra.secondsLabel")} />
                      </div>
                    </div>
                  );
                })()}

                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {soldOut
                        ? t("subscriptionPageExtra.spotsLeft")
                        : t("subscriptionPageExtra.spotsTaken", { taken, limit: EARLY_BIRD_LIMIT })}
                    </span>
                    {!soldOut && (
                      <span className="font-semibold text-primary">
                        ще {left}{" "}
                        {left === 1
                          ? t("subscriptionPageExtra.oneSpot")
                          : left >= 2 && left <= 4
                          ? t("subscriptionPageExtra.fewSpots")
                          : t("subscriptionPageExtra.manySpots")}
                      </span>
                    )}
                  </div>
                  <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70 transition-all duration-700"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })()}
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
                      ? t("subscriptionPageExtra.daysLabel")
                      : trialDaysLeft >= 2 && trialDaysLeft <= 4
                      ? t("subscriptionPageExtra.daysLabel")
                      : t("subscriptionPageExtra.daysLabel")}{" "}
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
                  <p className="text-sm text-muted-foreground">{t("subscriptionPageExtra.currentPlan")}</p>
                  {(() => {
                    const recurring = (settings as any)?.liqpay_recurring_active === true;
                    const isEarlyBird = isActive && !recurring && !!subscriptionUntil;
                    let title = "Pro";
                    let badgeLabel = t("subscriptionPageExtra.activeLabel");
                    let badgeVariant: "default" | "secondary" | "destructive" = "default";
                    if (isTrial && trialUntil) {
                      title = `Pro тріал · залишилось ${trialDaysLeft} ${
                        trialDaysLeft === 1
                          ? t("subscriptionPageExtra.daysLabel")
                          : trialDaysLeft >= 2 && trialDaysLeft <= 4
                          ? t("subscriptionPageExtra.daysLabel")
                          : t("subscriptionPageExtra.daysLabel")
                      }`;
                      badgeLabel = t("subscriptionPageExtra.trialLabel");
                      badgeVariant = "secondary";
                    } else if (isEarlyBird) {
                      title = `Pro · ${t("subscriptionPageExtra.trialLabel")} ${format(subscriptionUntil!, "d MMMM yyyy", { locale: uk })}`;
                      badgeLabel = "Early bird";
                    } else if (isActive) {
                      title = t("subscriptionPage.title") + " · " + t("subscriptionPageExtra.activeLabel");
                      badgeLabel = t("subscriptionPageExtra.activeLabel");
                    } else if (status === "past_due") {
                      title = t("subscriptionPageExtra.expiredLabel");
                      badgeLabel = t("subscriptionPageExtra.expiredLabel");
                      badgeVariant = "destructive";
                    } else {
                      title = t("subscriptionPageExtra.trialDone");
                      badgeLabel = t("subscriptionPageExtra.trialDone");
                      badgeVariant = "secondary";
                    }
                    return (
                      <>
                        <p className="font-display text-lg font-semibold text-foreground">
                          {title}
                        </p>
                        <div className="mt-1">
                          <Badge variant={badgeVariant}>{badgeLabel}</Badge>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Учнів зараз: <span className="font-semibold text-foreground">{studentCount}</span>{" "}
              <span className="inline-flex items-center gap-1 align-middle">
                / <InfinityIcon className="inline h-3.5 w-3.5" />
              </span>
            </p>
          </CardContent>
        </Card>

        {/* Latest subscription request status — moved below pricing */}

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

        {/* Plan */}
        <div className="mx-auto max-w-2xl">
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
                {isActive && <Badge>{t("subscriptionPageExtra.currentBadge")}</Badge>}
                {isTrial && !isActive && <Badge variant="secondary">{t("subscriptionPageExtra.trialBadge")}</Badge>}
              </div>
              <CardDescription>
                30 днів повного Pro безкоштовно — без картки.
              </CardDescription>
              <div className="mt-2 flex items-baseline gap-2">
                <p className="font-display text-3xl font-bold text-foreground">
                  {proPrice} ₴
                </p>
                <span className="text-sm text-muted-foreground">{t("subscriptionPageExtra.perMonth")}</span>
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
                  <LiqPayPayButton
                    plan={billing}
                    recurring
                    className="w-full"
                    label={t("subscriptionPageExtra.payBtn")}
                  />
                );
              })()}
              <p className="text-center text-xs text-muted-foreground">
                Оплата карткою через LiqPay — доступ активується автоматично за кілька секунд.{" "}
                {billing === "yearly"
                  ? t("subscriptionPageExtra.autoRenewYearly")
                  : t("subscriptionPageExtra.autoRenewMonthly")}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="mt-6">
          <ProRulesCard />
        </div>

        {/* Alternative payment via manager — placed below pricing as a fallback */}
        {!isActive && (() => {
          const hasPending =
            latestRequest &&
            (latestRequest.status === "new" || latestRequest.status === "in_progress");
          const meta = latestRequest ? statusMeta[latestRequest.status] : null;
          const StatusIcon = meta?.icon;
          return (
            <Card className="mt-6 border-dashed">
              <CardHeader>
                <CardTitle className="text-base">{t("subscriptionPageExtra.liqpayAlternative")}</CardTitle>
                <CardDescription>
                  Залиште запит — менеджер зв'яжеться і допоможе оплатити іншим зручним способом
                  (банк, переказ, рахунок-фактура тощо).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  onClick={handleUpgrade}
                  variant="outline"
                  className="w-full"
                  disabled={!!hasPending}
                >
                  {hasPending ? t("subscriptionPageExtra.requestPending") : t("subscriptionPageExtra.contactManager")}
                </Button>

                {!requestLoading && latestRequest && meta && StatusIcon && (
                  <div className="rounded-lg border border-primary/30 bg-primary/[0.03] p-4 space-y-3">
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
                          <p className="text-sm font-medium text-foreground">{t("subscriptionPageExtra.yourRequest")}</p>
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
                      <Button size="sm" variant="outline" onClick={() => setRequestOpen(true)}>
                        Надіслати новий запит
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })()}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Тріал не вимагає картки. Після завершення — {PRO_PRICE_MONTHLY} ₴/міс.
          <br />
          Скасування в один клік. Перші {EARLY_BIRD_LIMIT} репетиторів — безкоштовно на пів року.
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
