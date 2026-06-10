import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { BackToProfile } from "@/components/BackToProfile";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { usePaywallTracking } from "@/hooks/usePaywallTracking";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Crown,
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  BellRing,
  CalendarX2,
  BarChart3,
  FileDown,
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

const PRO_PRICE_MONTHLY = 249;
const PRO_PRICE_YEARLY_PER_MONTH = 199;
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
    isTrial,
    trialUntil,
    trialDaysLeft,
  } = useWorkspaceSettings();
  const [requestOpen, setRequestOpen] = useState(false);
  const [latestRequest, setLatestRequest] = useState<RequestRow | null>(null);
  const [requestLoading, setRequestLoading] = useState(true);
  const [billing, setBilling] = useState<"monthly" | "yearly">("yearly");
  const [earlyBirdCount, setEarlyBirdCount] = useState<number | null>(null);
  const EARLY_BIRD_LIMIT = 20;

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

  const earlyBirdLeft =
    eligibleForTrial && earlyBirdCount !== null && earlyBirdCount < EARLY_BIRD_LIMIT
      ? EARLY_BIRD_LIMIT - earlyBirdCount
      : null;

  const S = {
    txt: "#0f0f1a", sub: "#9398b0", muted: "#b0b4c8", border: "#eceef3",
    teal: "#2BBFAA", tealD: "#1f8e7e", successD: "#16a34a",
    gradTeal: "linear-gradient(135deg,#2BBFAA,#25a896)",
    gradIncome: "linear-gradient(160deg,#23232f 0%,#0f0f1a 100%)",
    shadowTeal: "0 8px 20px -8px rgba(43,191,170,.6)",
    shadowSm: "0 1px 4px rgba(15,15,26,.05)",
    display: "Inter, system-ui, sans-serif",
    body: "'Plus Jakarta Sans', system-ui, sans-serif",
  };

  const pendingRequest =
    latestRequest && (latestRequest.status === "new" || latestRequest.status === "in_progress");

  return (
    <AppLayout>
      <div style={{ maxWidth: 480, margin: "0 auto", fontFamily: S.body, color: S.txt }}>
        {/* Desktop-only title; mobile title comes from AppLayout */}
        <div className="mb-4 hidden lg:block">
          <div style={{ fontFamily: S.display, fontWeight: 700, fontSize: 10.5, letterSpacing: ".09em", textTransform: "uppercase", color: S.sub }}>
            {t("subscriptionPage.kicker") || "Підписка"}
          </div>
          <h1 style={{ fontFamily: S.display, fontWeight: 800, fontSize: 24, letterSpacing: "-.02em", marginTop: 2 }}>oTutorHub Pro</h1>
        </div>

        {/* ── Hero ──────────────────────────────────────────────────────────── */}
        <div style={{ position: "relative", overflow: "hidden", borderRadius: 22, padding: 22, background: S.gradIncome, color: "#fff", boxShadow: "0 18px 44px -22px rgba(15,15,26,.7)" }}>
          {earlyBirdLeft !== null && (
            <div style={{ position: "absolute", top: 14, right: 14, display: "inline-flex", alignItems: "center", gap: 5, borderRadius: 999, padding: "5px 11px", fontFamily: S.display, fontWeight: 700, fontSize: 12, background: "rgba(245,181,68,.18)", color: "#F5B400" }}>
              🔥 ще {earlyBirdLeft} {earlyBirdLeft === 1 ? "місце" : earlyBirdLeft < 5 ? "місця" : "місць"}
            </div>
          )}

          <div style={{ width: 52, height: 52, borderRadius: 16, background: S.gradTeal, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: S.shadowTeal }}>
            <Crown size={26} color="#fff" />
          </div>

          <div style={{ fontFamily: S.display, fontWeight: 800, fontSize: 25, letterSpacing: "-.02em", marginTop: 14 }}>
            {isActive ? "Pro активний" : isTrial ? "Ти на Pro-тріалі" : "Усе, щоб рости"}
          </div>
          <div style={{ fontSize: 13.5, color: "rgba(255,255,255,.65)", marginTop: 4, lineHeight: 1.45 }}>
            {isActive
              ? "Дякуємо, що з нами 💚 Усі Pro-функції відкриті."
              : isTrial && trialUntil
                ? `Залишилось ${trialDaysLeft} дн · до ${format(trialUntil, "d MMMM, HH:mm", { locale: uk })}`
                : "30 днів повного Pro безкоштовно — без картки."}
          </div>

          {!isActive && (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 16 }}>
                <span style={{ fontFamily: S.display, fontWeight: 800, fontSize: 42, letterSpacing: "-.02em", color: S.teal, lineHeight: 1 }}>{proPrice}</span>
                <span style={{ fontFamily: S.display, fontWeight: 700, fontSize: 18 }}>₴</span>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,.6)" }}>/ міс</span>
                {billing === "yearly" && (
                  <span style={{ fontSize: 11.5, color: "rgba(255,255,255,.45)", marginLeft: 2 }}>· {PRO_PRICE_YEARLY_TOTAL} ₴ на рік</span>
                )}
              </div>

              {/* Billing toggle */}
              <div style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: 12, background: "rgba(255,255,255,.1)", margin: "16px 0" }}>
                {([
                  { v: "monthly" as const, l: "Щомісяця" },
                  { v: "yearly" as const, l: "Щороку −23%" },
                ]).map((o) => {
                  const on = billing === o.v;
                  return (
                    <button key={o.v} onClick={() => setBilling(o.v)}
                      style={{ border: "none", cursor: "pointer", padding: "8px 14px", borderRadius: 9, fontFamily: S.display, fontWeight: 700, fontSize: 13, whiteSpace: "nowrap",
                        background: on ? "#fff" : "transparent", color: on ? S.txt : "rgba(255,255,255,.7)", boxShadow: on ? S.shadowSm : "none" }}>
                      {o.l}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* CTA */}
          <div style={{ marginTop: isActive ? 16 : 0 }}>
            {isActive ? (
              <Button className="w-full" disabled>Підписка активна</Button>
            ) : (
              <LiqPayPayButton plan={billing} recurring className="w-full" label={t("subscriptionPageExtra.payBtn")} />
            )}
          </div>
          {!isActive && (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,.5)", textAlign: "center", marginTop: 8 }}>
              Без картки · скасування в один клік
            </div>
          )}
        </div>

        {/* ── Що входить ────────────────────────────────────────────────────── */}
        <div style={{ fontFamily: S.display, fontWeight: 700, fontSize: 11, letterSpacing: ".09em", textTransform: "uppercase", color: S.sub, margin: "18px 2px 8px" }}>
          {t("subscriptionPage.whatsIncluded") || "Що входить"}
        </div>
        <div style={{ background: "#fff", border: `1px solid ${S.border}`, borderRadius: 18, boxShadow: S.shadowSm, padding: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            {proPerks.map(({ icon: PerkIcon, title, desc }) => (
              <div key={title} style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
                <div style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, background: "rgba(43,191,170,.1)", color: S.tealD, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <PerkIcon size={17} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: S.display, fontWeight: 700, fontSize: 14 }}>{title}</div>
                  <div style={{ fontSize: 12.5, color: S.sub, lineHeight: 1.45, marginTop: 1 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Manager fallback ──────────────────────────────────────────────── */}
        {!isActive && (
          <div style={{ textAlign: "center", fontSize: 12.5, color: S.sub, marginTop: 16 }}>
            Потрібен інший спосіб оплати?{" "}
            <button onClick={handleUpgrade} disabled={!!pendingRequest}
              style={{ border: "none", background: "transparent", cursor: pendingRequest ? "default" : "pointer", color: S.tealD, fontWeight: 700, fontFamily: S.display, opacity: pendingRequest ? 0.6 : 1 }}>
              {pendingRequest ? t("subscriptionPageExtra.requestPending") : "Написати менеджеру →"}
            </button>
          </div>
        )}

        {/* Latest request status (compact) */}
        {!requestLoading && latestRequest && !isActive && (() => {
          const meta = statusMeta[latestRequest.status];
          if (!meta) return null;
          const StatusIcon = meta.icon;
          return (
            <div style={{ marginTop: 14, borderRadius: 16, border: `1px solid ${S.border}`, background: "#fff", padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: meta.description ? 8 : 0 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <StatusIcon className={cn("h-4 w-4", latestRequest.status === "in_progress" && "animate-spin")} style={{ color: S.tealD }} />
                  <span style={{ fontFamily: S.display, fontWeight: 700, fontSize: 13.5 }}>{t("subscriptionPageExtra.yourRequest")}</span>
                </span>
                <Badge variant={meta.tone}>{meta.label}</Badge>
              </div>
              {meta.description && <p style={{ fontSize: 13, color: S.sub, lineHeight: 1.45 }}>{meta.description}</p>}
              {latestRequest.manager_response && (
                <div style={{ marginTop: 10, borderRadius: 10, border: `1px solid ${S.border}`, padding: 10 }}>
                  <div style={{ fontSize: 11.5, color: S.sub, marginBottom: 2 }}>Відповідь менеджера</div>
                  <p style={{ fontSize: 13, color: S.txt }}>{latestRequest.manager_response}</p>
                </div>
              )}
              {(latestRequest.status === "completed" || latestRequest.status === "rejected") && (
                <Button size="sm" variant="outline" className="mt-3" onClick={() => setRequestOpen(true)}>
                  Надіслати новий запит
                </Button>
              )}
            </div>
          );
        })()}

        <p style={{ marginTop: 18, textAlign: "center", fontSize: 11.5, color: S.muted, lineHeight: 1.5 }}>
          Тріал без картки. Після — {PRO_PRICE_MONTHLY} ₴/міс. Скасування в один клік.
        </p>
      </div>

      <SubscriptionRequestDialog open={requestOpen} onOpenChange={setRequestOpen} defaultBilling={billing} />
      <BackToProfile />
    </AppLayout>
  );
}
