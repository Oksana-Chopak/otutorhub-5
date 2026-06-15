import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { isIosApp } from "@/lib/platform";
import { configureIap, getIapOffer, purchaseIap, restoreIap, type IapOffer } from "@/lib/iap";
import { useToast } from "@/hooks/use-toast";
import { AppLayout } from "@/components/AppLayout";
import { BackToProfile } from "@/components/BackToProfile";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { usePaywallTracking } from "@/hooks/usePaywallTracking";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  Headset,
  Heart,
  Share2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SubscriptionRequestDialog } from "@/components/SubscriptionRequestDialog";
import { LiqPayPayButton } from "@/components/LiqPayPayButton";

import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

const PRO_PRICE_MONTHLY = 249;
const PRO_PRICE_YEARLY_PER_MONTH = 199;
const PRO_PRICE_YEARLY_TOTAL = PRO_PRICE_YEARLY_PER_MONTH * 12;

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
  // App Store 3.1.1: в iOS-збірці не показуємо ціни та зовнішні оплати
  const iosApp = isIosApp();
  const [searchParams] = useSearchParams();
  const { user, roles } = useAuth();
  const { trackPaywallClick } = usePaywallTracking();
  const {
    settings,
    loading,
    isIndependent,
    isTrial,
    trialDaysLeft,
    refresh,
  } = useWorkspaceSettings();
  const { toast } = useToast();
  const [requestOpen, setRequestOpen] = useState(false);
  const [latestRequest, setLatestRequest] = useState<RequestRow | null>(null);
  const [requestLoading, setRequestLoading] = useState(true);
  const [billing, setBilling] = useState<"monthly" | "yearly">("yearly");
  const [earlyBirdCount, setEarlyBirdCount] = useState<number | null>(null);
  const EARLY_BIRD_LIMIT = 20;

  // ── IAP (iOS StoreKit через RevenueCat) ────────────────────────────────────
  const [iapOffer, setIapOffer] = useState<IapOffer>({});
  const [iapBusy, setIapBusy] = useState<null | "buy" | "restore">(null);
  useEffect(() => {
    if (!iosApp || !user) return;
    let alive = true;
    (async () => {
      await configureIap(user.id);
      const offer = await getIapOffer();
      if (alive) setIapOffer(offer);
    })();
    return () => { alive = false; };
  }, [iosApp, user]);

  const handleIapPurchase = async () => {
    setIapBusy("buy");
    try {
      const ok = await purchaseIap(billing);
      if (ok) {
        toast({ title: t("iap.purchaseDone"), description: t("iap.purchaseDoneDesc") });
        await refresh?.();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Скасування покупки користувачем — не помилка.
      if (!/cancel/i.test(msg)) toast({ title: t("iap.purchaseFailed"), description: msg, variant: "destructive" });
    } finally {
      setIapBusy(null);
    }
  };

  const handleIapRestore = async () => {
    setIapBusy("restore");
    try {
      const ok = await restoreIap();
      toast({ title: ok ? t("iap.restoreDone") : t("iap.restoreNone") });
      if (ok) await refresh?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: t("iap.restoreFailed"), description: msg, variant: "destructive" });
    } finally {
      setIapBusy(null);
    }
  };

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

  const trialTotal = 30;
  const trialPct = Math.max(0, Math.min(100, ((trialTotal - (trialDaysLeft ?? 0)) / trialTotal) * 100));

  const BENEFITS: { e: string; t: string; d: string }[] = [
    { e: "🌅", t: t("subscriptionPageExtra.benefitMorningTitle"), d: t("subscriptionPageExtra.benefitMorningDesc") },
    { e: "💸", t: t("subscriptionPageExtra.benefitMoneyTitle"), d: t("subscriptionPageExtra.benefitMoneyDesc") },
    { e: "📎", t: t("subscriptionPageExtra.benefitOrganizedTitle"), d: t("subscriptionPageExtra.benefitOrganizedDesc") },
    { e: "📊", t: t("subscriptionPageExtra.benefitControlTitle"), d: t("subscriptionPageExtra.benefitControlDesc") },
    { e: "✨", t: t("subscriptionPageExtra.benefitProudTitle"), d: t("subscriptionPageExtra.benefitProudDesc") },
    { e: "🗓️", t: t("subscriptionPageExtra.benefitRoutineTitle"), d: t("subscriptionPageExtra.benefitRoutineDesc") },
    { e: "⏰", t: t("subscriptionPageExtra.benefitFewerCancelsTitle"), d: t("subscriptionPageExtra.benefitFewerCancelsDesc") },
    { e: "📈", t: t("subscriptionPageExtra.benefitGrowthTitle"), d: t("subscriptionPageExtra.benefitGrowthDesc") },
    { e: "🎮", t: t("subscriptionPageExtra.benefitRetentionTitle"), d: t("subscriptionPageExtra.benefitRetentionDesc") },
    { e: "🌴", t: t("subscriptionPageExtra.benefitVacationTitle"), d: t("subscriptionPageExtra.benefitVacationDesc") },
  ];

  const tealRing = "rgba(43,191,170,.28)";
  const Label = ({ children }: { children: React.ReactNode }) => (
    <div style={{ fontFamily: S.display, fontWeight: 700, fontSize: 13, letterSpacing: ".09em", textTransform: "uppercase", color: S.sub, margin: "4px 2px 8px" }}>{children}</div>
  );

  return (
    <AppLayout>
      <div style={{ maxWidth: 480, margin: "0 auto", fontFamily: S.body, color: S.txt }}>
        {/* Desktop-only header; mobile title from AppLayout */}
        <div className="mb-4 hidden lg:block">
          <div style={{ fontFamily: S.display, fontWeight: 700, fontSize: 13, letterSpacing: ".09em", textTransform: "uppercase", color: S.sub }}>{t("subscriptionPage.kicker") || "Підписка"}</div>
          <h1 style={{ fontFamily: S.display, fontWeight: 800, fontSize: 24, letterSpacing: "-.02em", marginTop: 2 }}>{t("subscriptionPageExtra.pageTitle")}</h1>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* ── Trial hero (dark) ─────────────────────────────────────────── */}
          <div style={{ position: "relative", overflow: "hidden", borderRadius: 22, padding: 22, background: S.gradIncome, color: "#fff", boxShadow: "0 18px 44px -22px rgba(15,15,26,.7)" }}>
            {earlyBirdLeft !== null && (
              <div style={{ position: "absolute", top: 14, right: 14, display: "inline-flex", alignItems: "center", gap: 5, borderRadius: 999, padding: "5px 11px", fontFamily: S.display, fontWeight: 700, fontSize: 13, background: "rgba(245,181,68,.18)", color: "#F5B400" }}>
                {t("subscriptionPageExtra.earlyBirdLeft", { count: earlyBirdLeft })}
              </div>
            )}
            {isActive ? (
              <>
                <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: ".09em", color: "rgba(255,255,255,.55)", fontFamily: S.display, fontWeight: 700 }}>{t("subscriptionPageExtra.heroEyebrow")}</div>
                <div style={{ fontFamily: S.display, fontWeight: 800, fontSize: 26, marginTop: 8, color: S.teal }}>{t("subscriptionPageExtra.heroActiveTitle")}</div>
                <div style={{ fontSize: 13.5, color: "rgba(255,255,255,.7)", lineHeight: 1.45, marginTop: 6 }}>{t("subscriptionPageExtra.heroActiveDesc")}</div>
              </>
            ) : isTrial ? (
              <>
                <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: ".09em", color: "rgba(255,255,255,.55)", fontFamily: S.display, fontWeight: 700 }}>{t("subscriptionPageExtra.heroTrialEyebrow")}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
                  <span style={{ fontFamily: S.display, fontWeight: 800, fontSize: 40, letterSpacing: "-.02em", color: S.teal }}>{Math.max(0, trialDaysLeft ?? 0)}</span>
                  <span style={{ fontFamily: S.display, fontWeight: 700, fontSize: 17, color: "#fff" }}>{t("subscriptionPageExtra.daysOfSubscription")}</span>
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,.6)" }}>{t("subscriptionPageExtra.remaining")}</span>
                </div>
                <div style={{ margin: "12px 0 14px", height: 8, borderRadius: 999, background: "rgba(255,255,255,.14)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${trialPct}%`, borderRadius: 999, background: S.gradTeal, transition: "width .6s cubic-bezier(.34,1.56,.64,1)" }} />
                </div>
                <div style={{ fontSize: 13.5, color: "rgba(255,255,255,.7)", lineHeight: 1.45 }}>{iosApp ? t("subscriptionPageExtra.heroTrialDescIos") : t("subscriptionPageExtra.heroTrialDesc", { price: PRO_PRICE_MONTHLY })}</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: ".09em", color: "rgba(255,255,255,.55)", fontFamily: S.display, fontWeight: 700 }}>{t("subscriptionPageExtra.heroEyebrow")}</div>
                <div style={{ fontFamily: S.display, fontWeight: 800, fontSize: 26, marginTop: 8 }}>{t("subscriptionPageExtra.heroFreeTitle")}</div>
                <div style={{ fontSize: 13.5, color: "rgba(255,255,255,.7)", lineHeight: 1.45, marginTop: 6 }}>{iosApp ? t("subscriptionPageExtra.heroFreeDescIos") : t("subscriptionPageExtra.heroFreeDesc", { price: PRO_PRICE_MONTHLY })}</div>
              </>
            )}
          </div>

          {/* ── iOS StoreKit (App Store IAP через RevenueCat) ───────────── */}
          {!isActive && iosApp && (
            <div style={{ borderRadius: 20, padding: 18, background: "#fff", border: `1.5px solid ${S.teal}`, boxShadow: "0 10px 30px -16px rgba(43,191,170,.5)" }}>
              <div style={{ fontFamily: S.display, fontWeight: 800, fontSize: 16 }}>{t("subscriptionPageExtra.subscribeTitle")}</div>
              <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 12, background: "rgba(15,15,26,.05)", margin: "12px 0" }}>
                {([{ v: "monthly" as const, l: t("subscriptionPageExtra.billingMonthly") }, { v: "yearly" as const, l: t("subscriptionPageExtra.billingYearly") }]).map((o) => {
                  const on = billing === o.v;
                  const price = o.v === "yearly" ? iapOffer.yearlyPrice : iapOffer.monthlyPrice;
                  return (
                    <button key={o.v} onClick={() => setBilling(o.v)} style={{ flex: 1, border: "none", cursor: "pointer", padding: "9px 10px", borderRadius: 9, fontFamily: S.display, fontWeight: 700, fontSize: 13, lineHeight: 1.25, background: on ? "#fff" : "transparent", color: on ? S.txt : S.sub, boxShadow: on ? S.shadowSm : "none" }}>
                      <div>{o.l}</div>
                      {price && <div style={{ fontSize: 13, color: on ? S.tealD : S.muted, marginTop: 1 }}>{price}</div>}
                    </button>
                  );
                })}
              </div>
              <button onClick={handleIapPurchase} disabled={iapBusy !== null}
                style={{ width: "100%", height: 50, borderRadius: 14, border: "none", cursor: iapBusy ? "default" : "pointer", background: S.gradTeal, color: "#fff", fontFamily: S.display, fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 8px 20px -8px rgba(43,191,170,.6)" }}>
                {iapBusy === "buy" && <Loader2 size={18} className="animate-spin" />}
                {t("subscriptionPageExtra.subscribeBtn")}
              </button>
              <button onClick={handleIapRestore} disabled={iapBusy !== null}
                style={{ width: "100%", height: 40, marginTop: 8, borderRadius: 11, border: "none", background: "transparent", color: S.sub, cursor: iapBusy ? "default" : "pointer", fontFamily: S.display, fontWeight: 700, fontSize: 13.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                {iapBusy === "restore" && <Loader2 size={15} className="animate-spin" />}
                {t("subscriptionPageExtra.restorePurchases")}
              </button>
              <div style={{ fontSize: 13, color: S.muted, textAlign: "center", marginTop: 8, lineHeight: 1.45 }}>
                {t("subscriptionPageExtra.appStoreNote")}
              </div>
            </div>
          )}

          {/* ── Path 1 — pay (прихована в iOS-збірці: App Store 3.1.1) ──── */}
          {!isActive && !iosApp && (
            <div style={{ borderRadius: 20, padding: 18, background: "#fff", border: `1.5px solid ${S.teal}`, boxShadow: "0 10px 30px -16px rgba(43,191,170,.5)" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ fontFamily: S.display, fontWeight: 800, fontSize: 16 }}>{t("subscriptionPageExtra.subscribeTitle")}</span>
                <span>
                  <span style={{ fontFamily: S.display, fontWeight: 800, fontSize: 28, color: S.tealD }}>{proPrice}</span>
                  <span style={{ fontSize: 13, color: S.sub }}> {t("subscriptionPageExtra.perMonthUnit")}</span>
                </span>
              </div>
              {billing === "yearly" && (
                <div style={{ fontSize: 13, color: S.sub, marginTop: 2 }}>{t("subscriptionPageExtra.yearlyTotalNote", { total: PRO_PRICE_YEARLY_TOTAL })}</div>
              )}
              <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 12, background: "rgba(15,15,26,.05)", margin: "12px 0" }}>
                {([{ v: "monthly" as const, l: t("subscriptionPageExtra.billingMonthly") }, { v: "yearly" as const, l: t("subscriptionPageExtra.billingYearlyDiscount") }]).map((o) => {
                  const on = billing === o.v;
                  return (
                    <button key={o.v} onClick={() => setBilling(o.v)} style={{ flex: 1, border: "none", cursor: "pointer", padding: "9px 12px", borderRadius: 9, fontFamily: S.display, fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", background: on ? "#fff" : "transparent", color: on ? S.txt : S.sub, boxShadow: on ? S.shadowSm : "none" }}>{o.l}</button>
                  );
                })}
              </div>
              <LiqPayPayButton plan={billing} recurring className="w-full" label={t("subscriptionPageExtra.payBtn")} />
              <div style={{ fontSize: 13, color: S.muted, textAlign: "center", marginTop: 8 }}>{t("subscriptionPageExtra.liqPayNote")}</div>
            </div>
          )}

          {/* ── або не плати ─────────────────────────────────────────────── */}
          {!isActive && !iosApp && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 4px" }}>
              <div style={{ flex: 1, height: 1, background: S.border }} />
              <span style={{ fontFamily: S.display, fontWeight: 700, fontSize: 13, color: S.muted }}>{t("subscriptionPageExtra.orDontPay")}</span>
              <div style={{ flex: 1, height: 1, background: S.border }} />
            </div>
          )}

          {/* ── Path 2 — invite ──────────────────────────────────────────── */}
          <div style={{ borderRadius: 18, padding: 16, background: "linear-gradient(135deg, rgba(43,191,170,.12), transparent)", border: `1px solid ${tealRing}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <div style={{ width: 42, height: 42, borderRadius: 13, background: S.gradTeal, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: S.shadowTeal, flexShrink: 0 }}>
                <Heart size={21} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: S.display, fontWeight: 800, fontSize: 15.5 }}>{t("subscriptionPageExtra.inviteTitle")}</div>
                <div style={{ fontSize: 13, color: S.sub, lineHeight: 1.4, marginTop: 1 }}>{t("subscriptionPageExtra.inviteDesc")}{iosApp ? "." : <>. {t("subscriptionPageExtra.inviteSavingsPrefix")} <b style={{ color: S.tealD }}>{t("subscriptionPageExtra.inviteSavingsValue", { price: PRO_PRICE_MONTHLY })}</b>.</>}</div>
              </div>
            </div>
            <button onClick={() => navigate("/my-referrals")} style={{ marginTop: 12, width: "100%", height: 46, borderRadius: 13, border: `1.5px solid ${S.teal}`, background: "#fff", color: S.tealD, cursor: "pointer", fontFamily: S.display, fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Share2 size={18} /> {t("subscriptionPageExtra.inviteBtn")}
            </button>
          </div>

          {/* ── Benefits ─────────────────────────────────────────────────── */}
          <div>
            <Label>{t("subscriptionPageExtra.benefitsLabel")}</Label>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {BENEFITS.map((b, i) => (
                <div key={i} style={{ background: "#fff", border: `1px solid ${S.border}`, borderRadius: 16, boxShadow: S.shadowSm, padding: 14 }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <div style={{ width: 42, height: 42, borderRadius: 13, flexShrink: 0, background: "linear-gradient(135deg, rgba(43,191,170,.14), rgba(43,191,170,.04))", boxShadow: `inset 0 0 0 1px ${tealRing}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 21 }}>{b.e}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: S.display, fontWeight: 700, fontSize: 14.5 }}>{b.t}</div>
                      <div style={{ fontSize: 13, color: S.sub, lineHeight: 1.5, marginTop: 2 }}>{b.d}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Manager fallback (зовнішні способи оплати → не для iOS) ──── */}
          {!isActive && !iosApp && (
            <div style={{ borderRadius: 18, border: `1px dashed ${S.border}`, background: "#fff", padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(147,152,176,.16)", color: S.sub, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Headset size={18} />
                </div>
                <div style={{ flex: 1 }}><div style={{ fontFamily: S.display, fontWeight: 800, fontSize: 15 }}>{t("subscriptionPageExtra.cardNotWorkingTitle")}</div></div>
              </div>
              <div style={{ fontSize: 13, color: S.sub, margin: "8px 0 12px", lineHeight: 1.45 }}>{t("subscriptionPageExtra.cardNotWorkingDesc")}</div>
              <button onClick={handleUpgrade} disabled={!!pendingRequest} style={{ width: "100%", height: 46, borderRadius: 13, border: "none", cursor: pendingRequest ? "default" : "pointer", background: "rgba(15,15,26,.05)", color: S.txt, fontFamily: S.display, fontWeight: 700, fontSize: 15, opacity: pendingRequest ? 0.6 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <Headset size={18} /> {pendingRequest ? t("subscriptionPageExtra.requestPending") : t("subscriptionPageExtra.contactManager")}
              </button>

              {!requestLoading && latestRequest && (() => {
                const meta = statusMeta[latestRequest.status];
                if (!meta) return null;
                const StatusIcon = meta.icon;
                return (
                  <div style={{ marginTop: 12, borderRadius: 12, border: `1px solid ${S.border}`, padding: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <StatusIcon className={cn("h-4 w-4", latestRequest.status === "in_progress" && "animate-spin")} style={{ color: S.tealD }} />
                        <span style={{ fontFamily: S.display, fontWeight: 700, fontSize: 13 }}>{t("subscriptionPageExtra.yourRequest")}</span>
                      </span>
                      <Badge variant={meta.tone}>{meta.label}</Badge>
                    </div>
                    {meta.description && <p style={{ fontSize: 13, color: S.sub, marginTop: 6, lineHeight: 1.4 }}>{meta.description}</p>}
                    {latestRequest.manager_response && (
                      <div style={{ marginTop: 8, borderRadius: 10, border: `1px solid ${S.border}`, padding: 10 }}>
                        <div style={{ fontSize: 13, color: S.sub, marginBottom: 2 }}>{t("subscriptionPageExtra.managerResponse")}</div>
                        <p style={{ fontSize: 13, color: S.txt }}>{latestRequest.manager_response}</p>
                      </div>
                    )}
                    {(latestRequest.status === "completed" || latestRequest.status === "rejected") && (
                      <Button size="sm" variant="outline" className="mt-3" onClick={() => setRequestOpen(true)}>{t("subscriptionPageExtra.sendNewRequest")}</Button>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        <SubscriptionRequestDialog open={requestOpen} onOpenChange={setRequestOpen} defaultBilling={billing} />
        <BackToProfile />
      </div>
    </AppLayout>
  );
}
