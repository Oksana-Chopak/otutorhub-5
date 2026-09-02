import { useEffect, useMemo, useState } from "react";
import { appOrigin } from "@/lib/webOrigin";
import { canSee } from "@/lib/roleCapabilities";
import { formatPrice } from "@/lib/currency";
import { Navigate } from "react-router-dom";
import { getLocale } from "@/lib/locale";
import { BackToProfile } from "@/components/BackToProfile";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { ErrorState } from "@/components/ErrorState";
import { supabase } from "@/integrations/supabase/client";
import { Link2, Copy, Check, Share2, Heart, Trophy } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { openExternal } from "@/lib/openExternal";

// ── Design tokens (oTutorHub DS — variant C "Запроси колегу") ─────────────────
const R = {
  bg: "var(--ds-bg,#F5F4F0)",
  surface: "var(--ds-surface,#fff)",
  surface2: "#f6f5f1",
  txt: "var(--ds-txt,#0f0f1a)",
  sub: "var(--sub,#666b82)",
  muted: "var(--ds-muted,#6f7489)",
  border: "var(--ds-border,#eceef3)",
  teal: "#2BBFAA",
  tealD: "#1f8e7e",
  tealRing: "rgba(43,191,170,.28)",
  gradTeal: "linear-gradient(135deg,#2BBFAA,#25a896)",
  shadowTeal: "0 8px 20px -8px rgba(43,191,170,.6)",
  shadowSm: "0 1px 4px rgba(15,15,26,.05)",
  successD: "#16a34a",
  display: "Inter, system-ui, sans-serif",
  body: "'Plus Jakarta Sans', system-ui, sans-serif",
};

const AVATAR_GRADS = [
  "linear-gradient(135deg,#2BBFAA,#25a896)",
  "linear-gradient(135deg,#5b6bf5,#4f46e5)",
  "linear-gradient(135deg,#FF7A59,#f43f5e)",
  "linear-gradient(135deg,#f59e0b,#d97706)",
  "linear-gradient(135deg,#8b5cf6,#7c3aed)",
];
function avatarGrad(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_GRADS[h % AVATAR_GRADS.length];
}
function initials(name: string) {
  return name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
}

interface ReferralRow {
  id: string;
  referred_id: string;
  signed_up_at: string;
  upgraded_to_pro_at: string | null;
}
interface LeaderRow {
  referrer_id: string;
  first_name: string | null;
  last_name: string | null;
  pro_upgrades: number;
  total_signups: number;
}

const STEPS = [
  { e: "🔗", n: "1", titleKey: "myReferrals.step1Title", descKey: "myReferrals.step1Desc" },
  { e: "🎓", n: "2", titleKey: "myReferrals.step2Title", descKey: "myReferrals.step2Desc" },
  { e: "🎁", n: "3", titleKey: "myReferrals.step3Title", descKey: "myReferrals.step3Desc" },
] as const;

const Card = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{ background: R.surface, border: `1px solid ${R.border}`, borderRadius: 18, boxShadow: R.shadowSm, ...style }}>
    {children}
  </div>
);

const Label = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontFamily: R.display, fontWeight: 700, fontSize: 14, letterSpacing: ".09em", textTransform: "uppercase", color: R.sub, margin: "2px 2px" }}>
    {children}
  </div>
);

export default function MyReferralsPage() {
  const { t } = useTranslation();
  const { user, roles } = useAuth();
  const { isIndependent, loading: wsLoading, workspaceUnknown } = useWorkspaceSettings();
  // The referral / Pro-invite program is INDEPENDENT-tutor only (MON-7). A hub tutor /
  // manager reaching this by URL must not see the independent monetization surface.
  // (Applied at the render return below, after all hooks, to respect the rules of hooks.)
  const blockedNonIndependent = !wsLoading && !canSee("referrals", {
    isManager: roles.includes("manager"), isTutor: roles.includes("tutor"),
    isIndependent, isStudent: roles.includes("student"),
  }); // P8-системно
  /* Аудит 02.09: `workspaceUnknown` (читання завершилось, рядка налаштувань
     немає) читалось як «не самостійний» — і САМОСТІЙНОГО репетитора викидало
     редіректом із його ж сторінки рефералів. «Ще не знаю» ≠ «не самостійний».
     Зразок правильної обробки поруч: MyStudentsPage.tsx. */
  const personaUnknown = workspaceUnknown;

  const [code, setCode] = useState<string | null>(null);
  /* Аудит 02.09: жодне читання не перевіряло error — сторінка впевнено
     показувала «0 запрошень · 0 ₴ заощаджено», а кнопка «Копіювати» вічно
     писала «посилання завантажується». */
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [savedUah, setSavedUah] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  useEffect(() => {
    // MON-2: don't run the referral reads/RPCs for hub tutors/managers — the render
    // redirect fires only after this effect, so data was fetched before the bounce.
    if (!user || wsLoading || blockedNonIndependent) return;
    (async () => {
      setLoading(true);

      let codeVal: string | null = null;
      const { data: codeRow, error: codeErr } = await supabase
        .from("referral_codes").select("code").eq("tutor_id", user.id).maybeSingle();
      if (codeErr) { setLoadError(true); setLoading(false); return; }
      if (codeRow?.code) {
        codeVal = codeRow.code as string;
      } else {
        const { data: newCode } = await supabase.rpc("generate_referral_code", { _tutor_id: user.id });
        codeVal = (newCode as string) ?? null;
      }
      setCode(codeVal);

      const [{ data: refs, error: refsErr }, { data: saved }, { data: board }] = await Promise.all([
        supabase
          .from("referrals")
          .select("id, referred_id, signed_up_at, upgraded_to_pro_at")
          .eq("referrer_id", user.id)
          .order("signed_up_at", { ascending: false }),
        supabase.rpc("get_referral_savings_uah", { _tutor_id: user.id }),
        supabase.rpc("get_referral_leaderboard", { _year: year, _month: month }),
      ]);

      if (refsErr) { setLoadError(true); setLoading(false); return; }
      setLoadError(false);
      const refRows = (refs ?? []) as ReferralRow[];
      setReferrals(refRows);
      setSavedUah(Number(saved ?? 0));
      setLeaderboard((board as LeaderRow[]) ?? []);

      const ids = Array.from(new Set(refRows.map((r) => r.referred_id)));
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles").select("id, first_name, last_name").in("id", ids);
        const map: Record<string, string> = {};
        (profs ?? []).forEach((p: { id: string; first_name: string | null; last_name: string | null }) => {
          map[p.id] = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || t("myReferrals.you");
        });
        setNames(map);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, year, month, wsLoading, blockedNonIndependent, reloadKey]);

  const link = code ? `${appOrigin()}/join/${code}` : "";
  const linkLabel = code ? `${window.location.host}/join/${code}` : "";
  const proUpgrades = referrals.filter((r) => r.upgraded_to_pro_at).length;
  const monthly = useMemo(
    () => referrals.filter((r) => {
      if (!r.upgraded_to_pro_at) return false;
      const d = new Date(r.upgraded_to_pro_at);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length,
    [referrals, now]
  );
  const toBigBonus = Math.max(0, 3 - monthly);
  const progress = Math.min(100, (monthly / 3) * 100);

  const handleCopy = async () => {
    if (!link) { toast.error(t("referralWidget.linkLoading") || "Посилання ще завантажується"); return; }
    await navigator.clipboard.writeText(link);
    setCopied(true);
    toast.success(t("referralWidget.linkCopied"));
    setTimeout(() => setCopied(false), 1600);
  };

  const inviteText = t("referralWidget.inviteText") ||
    "Приєднуйся до oTutorHub — застосунку, що веде всю репетиторську практику в одному місці. 21 день безкоштовно за моїм посиланням 👇";

  // P0.1: локальна обгортка ЗАТІНЯЛА імпорт і викликала САМА СЕБЕ —
  // RangeError на головному CTA рефералки. Інше ім'я = інше життя.
  const openShare = (href: string) => {
    void openExternal(href);
    setShareOpen(false);
  };

  const nativeShare = async () => {
    if (!link) return;
    try {
      await navigator.share({ title: "oTutorHub", text: inviteText, url: link });
    } catch { /* user cancelled — ignore */ }
    setShareOpen(false);
  };

  const shareTargets = () => {
    const u = encodeURIComponent(link);
    const txt = encodeURIComponent(inviteText);
    const txtWithLink = encodeURIComponent(`${inviteText} ${link}`);
    return [
      { key: "telegram", label: "Telegram", color: "#229ED9", glyph: "✈", href: `https://t.me/share/url?url=${u}&text=${txt}` },
      { key: "whatsapp", label: "WhatsApp", color: "#25D366", glyph: "✆", href: `https://api.whatsapp.com/send?text=${txtWithLink}` },
      { key: "viber", label: "Viber", color: "#7360F2", glyph: "◷", href: `viber://forward?text=${txtWithLink}` },
      { key: "facebook", label: "Facebook", color: "#1877F2", glyph: "f", href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
      { key: "x", label: "X", color: "#0f0f1a", glyph: "𝕏", href: `https://twitter.com/intent/tweet?text=${txt}&url=${u}` },
    ];
  };

  // ── UI helpers ──────────────────────────────────────────────────────────────

  if (personaUnknown) {
    return (
      <>
        <ErrorState onRetry={() => setReloadKey((k) => k + 1)} retrying={loading} />
      </>
    );
  }
  if (blockedNonIndependent) return <Navigate to="/" replace />;
  if (loadError) {
    return (
      <>
        <ErrorState onRetry={() => setReloadKey((k) => k + 1)} retrying={loading} />
      </>
    );
  }

  return (
    <>
      <div style={{ maxWidth: 480, margin: "0 auto", fontFamily: R.body, color: R.txt }}>
        {/* Header — desktop only. On mobile AppLayout already renders the title + bell + menu;
            on desktop the bell lives in the sidebar. So this page must NOT add its own bell. */}
        <div className="mb-4 hidden lg:block">
          <div style={{ fontFamily: R.display, fontWeight: 700, fontSize: 14, letterSpacing: ".09em", textTransform: "uppercase", color: R.sub }}>
            {t("myReferrals.kicker") || "Реферальна програма"}
          </div>
          <h1 style={{ fontFamily: R.display, fontWeight: 800, fontSize: 24, letterSpacing: "-.02em", marginTop: 2 }}>
            {t("myReferrals.heroTitle") || "Запроси колегу"}
          </h1>
        </div>

        {loading ? (
          <div className="animate-pulse" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ height: 150, borderRadius: 18, background: "rgba(15,15,26,.05)" }} />
            <div style={{ height: 110, borderRadius: 18, background: "rgba(15,15,26,.05)" }} />
            <div style={{ height: 70, borderRadius: 18, background: "rgba(15,15,26,.05)" }} />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Як це працює */}
            <Card style={{ padding: 6 }}>
              {STEPS.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 13, padding: "13px 10px", borderBottom: i < STEPS.length - 1 ? `1px solid ${R.border}` : "none" }}>
                  <div style={{ position: "relative", flexShrink: 0 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 14, background: "rgba(43,191,170,.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 21 }}>{s.e}</div>
                    <div style={{ position: "absolute", top: -4, left: -4, width: 20, height: 20, borderRadius: 999, background: R.gradTeal, color: "#0f0f1a", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: R.display, fontWeight: 800, fontSize: 14, boxShadow: R.shadowTeal }}>{s.n}</div>
                  </div>
                  <div style={{ flex: 1, paddingTop: 2 }}>
                    <div style={{ fontFamily: R.display, fontWeight: 700, fontSize: 15 }}>{t(s.titleKey)}</div>
                    <div style={{ fontSize: 14, color: R.sub, lineHeight: 1.45, marginTop: 2 }}>{t(s.descKey)}</div>
                  </div>
                </div>
              ))}
            </Card>

            {/* Твоє посилання */}
            <Card style={{ padding: 18, background: "linear-gradient(135deg, rgba(43,191,170,.12), transparent)", border: `1px solid ${R.tealRing}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 14 }}>
                <div style={{ width: 42, height: 42, borderRadius: 13, background: R.gradTeal, color: "#0f0f1a", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: R.shadowTeal }}>
                  <Heart size={21} />
                </div>
                <div>
                  <div style={{ fontFamily: R.display, fontWeight: 800, fontSize: 16 }}>{t("myReferrals.yourLinkTitle") || "Твоє посилання"}</div>
                  <div style={{ fontSize: 14, color: R.sub }}>{t("myReferrals.yourLinkSub") || "Поділись — і отримуй місяці підписки"}</div>
                </div>
              </div>

              {/* Invite box */}
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, height: 46, padding: "0 14px", borderRadius: 12, background: R.surface2, border: `1px solid ${R.border}`, minWidth: 0 }}>
                  <Link2 size={16} style={{ color: R.muted, flexShrink: 0 }} />
                  <span style={{ fontFamily: R.display, fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {linkLabel || "…"}
                  </span>
                </div>
                <button onClick={handleCopy} aria-label={t("referralWidget.copy") || "Копіювати"}
                  style={{ width: 46, height: 46, borderRadius: 12, border: "none", cursor: "pointer",
                    background: copied ? "rgba(34,197,94,.16)" : R.surface, color: copied ? R.successD : R.txt,
                    boxShadow: `inset 0 0 0 1px ${R.border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {copied ? <Check size={18} /> : <Copy size={18} />}
                </button>
                <Popover open={shareOpen} onOpenChange={setShareOpen}>
                  <PopoverTrigger asChild>
                    <button disabled={!link} aria-label={t("referralWidget.share") || "Поділитися"}
                      style={{ width: 46, height: 46, borderRadius: 12, border: "none", cursor: link ? "pointer" : "default",
                        background: R.gradTeal, color: "#0f0f1a", boxShadow: R.shadowTeal, opacity: link ? 1 : 0.6,
                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Share2 size={18} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-60 p-2" style={{ borderRadius: 16 }}>
                    <div style={{ fontFamily: R.display, fontWeight: 700, fontSize: 14, color: R.sub, padding: "4px 8px 8px", letterSpacing: ".04em", textTransform: "uppercase" }}>
                      {t("referralWidget.shareVia") || "Поділитися через"}
                    </div>
                    {shareTargets().map((s) => (
                      <button key={s.key} onClick={() => openShare(s.href)}
                        className="hover:bg-black/[0.04]"
                        style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", padding: "9px 8px", borderRadius: 10, border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}>
                        <span style={{ width: 32, height: 32, borderRadius: 999, background: s.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: R.display, fontWeight: 800, fontSize: 16, flexShrink: 0 }}>{s.glyph}</span>
                        <span style={{ fontFamily: R.display, fontWeight: 600, fontSize: 14, color: R.txt }}>{s.label}</span>
                      </button>
                    ))}
                    <div style={{ height: 1, background: R.border, margin: "6px 4px" }} />
                    <button onClick={() => { handleCopy(); setShareOpen(false); }}
                      className="hover:bg-black/[0.04]"
                      style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", padding: "9px 8px", borderRadius: 10, border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}>
                      <span style={{ width: 32, height: 32, borderRadius: 999, background: "rgba(43,191,170,.12)", color: R.tealD, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Copy size={16} /></span>
                      <span style={{ fontFamily: R.display, fontWeight: 600, fontSize: 14, color: R.txt }}>{t("referralWidget.copyLink") || "Скопіювати посилання"}</span>
                    </button>
                    {typeof navigator !== "undefined" && "share" in navigator && (
                      <button onClick={nativeShare}
                        className="hover:bg-black/[0.04]"
                        style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", padding: "9px 8px", borderRadius: 10, border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}>
                        <span style={{ width: 32, height: 32, borderRadius: 999, background: "rgba(15,15,26,.06)", color: R.txt, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Share2 size={16} /></span>
                        <span style={{ fontFamily: R.display, fontWeight: 600, fontSize: 14, color: R.txt }}>{t("referralWidget.moreApps") || "Інше…"}</span>
                      </button>
                    )}
                  </PopoverContent>
                </Popover>
              </div>

              {/* Reward line */}
              <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", padding: "11px 13px", borderRadius: 12, background: "rgba(43,191,170,.08)", border: `1px solid ${R.tealRing}` }}>
                <span style={{ fontSize: 20 }}>🎁</span>
                <div style={{ fontSize: 14, lineHeight: 1.45 }}>
                  {t("myReferrals.rewardLinePart1")} <b>{t("myReferrals.rewardLineBold1")}</b>{t("myReferrals.rewardLinePart2")} <b>{t("myReferrals.rewardLineBold2")}</b> {t("myReferrals.rewardLinePart3")}
                </div>
              </div>
            </Card>

            {/* Цього місяця */}
            <div>
              <Label>{t("myReferrals.thisMonth") || "Цього місяця"}</Label>
              <Card style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 6 }}>
                  <span style={{ color: R.sub }}>
                    {t("myReferrals.monthlyProgressPrefix")} <b style={{ color: R.txt }}>{t("myReferrals.monthlyProgressCount", { monthly })}</b> {t("myReferrals.monthlyProgressSuffix")}
                  </span>
                  <span style={{ fontFamily: R.display, fontWeight: 700, color: R.tealD }}>{Math.round(progress)}%</span>
                </div>
                <div style={{ height: 8, borderRadius: 999, background: "rgba(15,15,26,.07)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${progress}%`, borderRadius: 999, background: R.gradTeal, transition: "width .6s cubic-bezier(.34,1.56,.64,1)" }} />
                </div>
                <div style={{ fontSize: 14, color: R.muted, marginTop: 5 }}>
                  {toBigBonus > 0 ? t("myReferrals.bonusRemaining", { count: toBigBonus }) : t("myReferrals.bonusUnlocked")}
                </div>
              </Card>
            </div>

            {/* Bubbles */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Card style={{ padding: 14 }}>
                <div style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: ".08em", color: R.sub, fontFamily: R.display, fontWeight: 700 }}>
                  {t("myReferrals.invitedLabel") || "Запрошено"}
                </div>
                <div style={{ fontFamily: R.display, fontWeight: 800, fontSize: 28, marginTop: 4 }}>{referrals.length}</div>
              </Card>
              <Card style={{ padding: 14, background: "rgba(34,197,94,.07)", border: "1px solid rgba(34,197,94,.25)" }}>
                <div style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: ".08em", color: R.successD, fontFamily: R.display, fontWeight: 700 }}>
                  {t("myReferrals.savedLabel") || "Заощаджено"}
                </div>
                <div style={{ fontFamily: R.display, fontWeight: 800, fontSize: 24, marginTop: 4, color: R.successD }}>
                  {formatPrice(savedUah, "UAH")}
                </div>
              </Card>
            </div>

            {/* Твої запрошені */}
            <div>
              <Label>{t("myReferrals.yourInvitees") || "Твої запрошені"}</Label>
              <Card style={{ padding: referrals.length ? 6 : 18 }}>
                {referrals.length === 0 ? (
                  <p style={{ fontSize: 15, color: R.sub, textAlign: "center", lineHeight: 1.5 }}>
                    {t("myReferrals.inviteesEmpty") || "Ще нікого — поділись посиланням, і запрошені з'являться тут 🌱"}
                  </p>
                ) : (
                  referrals.map((r, i) => {
                    const name = names[r.referred_id] ?? t("myReferrals.you");
                    const isPro = !!r.upgraded_to_pro_at;
                    const pill = isPro
                      ? { bg: "rgba(34,197,94,.14)", fg: "#16a34a", ring: "rgba(34,197,94,.3)", label: t("myReferrals.pillSubscription") }
                      : { bg: "rgba(43,191,170,.12)", fg: "#1f8e7e", ring: "rgba(43,191,170,.28)", label: t("myReferrals.pillTrial") };
                    const note = isPro
                      ? (t("myReferrals.noteJoinedPro") || "Приєднав(ла)ся · оформив(ла) підписку")
                      : (t("myReferrals.noteJoinedTrial") || "Приєднав(ла)ся · на тріалі");
                    return (
                      <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 8px", borderBottom: i < referrals.length - 1 ? `1px solid ${R.border}` : "none" }}>
                        <div style={{ width: 38, height: 38, borderRadius: 999, background: avatarGrad(name), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: R.display, fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
                          {initials(name)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: R.display, fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
                          <div style={{ fontSize: 14, color: R.sub }}>{note}</div>
                        </div>
                        <span style={{ display: "inline-flex", alignItems: "center", borderRadius: 999, padding: "4px 10px", fontFamily: R.display, fontWeight: 700, fontSize: 14, background: pill.bg, color: pill.fg, boxShadow: `inset 0 0 0 1px ${pill.ring}`, whiteSpace: "nowrap" }}>
                          {pill.label}
                        </span>
                      </div>
                    );
                  })
                )}
              </Card>
              {referrals.length > 0 && (
                <div style={{ fontSize: 14, color: R.muted, marginTop: 8, paddingLeft: 2 }}>
                  {t("myReferrals.summaryLine", { total: referrals.length, pro: proUpgrades }) ||
                    `Усього запрошень: ${referrals.length} · з підпискою: ${proUpgrades}`}
                </div>
              )}
            </div>

            {/* Leaderboard */}
            {leaderboard.length > 0 && (
              <div>
                <Label>{t("myReferrals.leaderboardTitle") || "Рейтинг місяця"}</Label>
                <Card style={{ padding: 6 }}>
                  {leaderboard.slice(0, 10).map((row, idx) => {
                    const isMe = row.referrer_id === user?.id;
                    const name = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "—";
                    const medal = idx === 0 ? "#F5B400" : idx === 1 ? "#9ca3af" : idx === 2 ? "#cd7f32" : null;
                    return (
                      <div key={row.referrer_id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 8px", borderRadius: 12, background: isMe ? "rgba(43,191,170,.07)" : "transparent", borderBottom: idx < Math.min(10, leaderboard.length) - 1 ? `1px solid ${R.border}` : "none" }}>
                        <div style={{ width: 26, height: 26, borderRadius: 999, background: medal ? medal : "rgba(15,15,26,.06)", color: medal ? "#fff" : R.sub, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: R.display, fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
                          {idx + 1}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: R.display, fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {isMe ? `${name} ${t("myReferrals.you")}` : name}
                          </div>
                          <div style={{ fontSize: 14, color: R.sub }}>
                            {t("myReferrals.signupsProLabel", { signups: row.total_signups, pro: row.pro_upgrades })}
                          </div>
                        </div>
                        {idx < 3 && <Trophy size={16} style={{ color: medal ?? R.muted, flexShrink: 0 }} />}
                      </div>
                    );
                  })}
                </Card>
              </div>
            )}
          </div>
        )}
      </div>
      <BackToProfile />
    </>
  );
}
