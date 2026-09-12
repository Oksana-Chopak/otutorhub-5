import "@/styles/landing-fonts.css";
import { priceLabel, totalLabel } from "@/lib/pricing";
import { formatPrice } from "@/lib/currency";
import { OfflineBanner } from "@/components/OfflineBanner";
import { isNativeApp } from "@/lib/platform";
import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { LandingHero } from "@/components/landing/LandingHero";
import { LandingDayStory } from "@/components/landing/LandingDayStory";
import { PaymentMethodsSection } from "@/components/PaymentMethodsSection";

/**
 * Лендінг — переродження 12.09 (рішення власниці після розносу: «одна дія,
 * один вау-флоу, чіткість з першого рядка, позиціонування»).
 *
 * Було: герой із персоною, що крутиться кожні 2,5 с («для репетитора /
 * консультанта / психолога / нутриціолога / тренера»), дві кнопки в герої,
 * окремий калькулятор нижче з трьома кнопками під ним, «Знайомо?», сітка
 * «як на долоні», «3 кроки», три тарифні картки з кнопками, смужка для
 * учнів, фінальний CTA, два плаваючі месенджери. Дев'ять секцій, сім
 * кнопок, жодного чіткого «що це і для кого».
 *
 * Стало: ОДНА персона (репетитор — v1 продукту), ОДНА обіцянка в заголовку,
 * ОДИН потік у герої (вставив → побачив свій завтрашній дайджест → одна
 * кнопка), далі лише «один день з помічником», ціна без кнопок і фінальна
 * кнопка. Решта персон — майбутні версії продукту, а не цей лендінг.
 *
 * Палітра `.landing-root` — власна (не index.css); текстові токени доведені
 * до 4,5:1 хвилею контрасту 11.09 і стережуться contrast-gate.test.ts.
 */

export type PersonaVars = {
  label: string;
  labelNom: string;
  labelAcc: string;
  client: string;
  clientNom: string;
  clientDative: string;
  ClientNom: string;
  clients: string;
  clientsNom: string;
  clientsAcc: string;
  clientsGen: string;
  session: string;
  sessions: string;
  sessionsGen: string;
};

function capFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const landingStyles = `
.landing-root, .landing-root *, .landing-root *::before, .landing-root *::after { box-sizing: border-box; margin: 0; padding: 0; }

.landing-root {
  --ink: #1a1a2e;
  --ink2: #2d2d4a;
  --l-muted: #5d5d78;
  --muted2: #6b6b8a;
  --bg: #f7f6f2;
  --bg2: #eeece6;
  --white: #ffffff;
  --l-accent: #0ABAB5;
  --l-accent2: #2dd4cf;
  --accent-light: #d6f5f3;
  /* Брендова бірюза — лише ЗАЛИВКА великих плям; усе, що читається, — нижче,
     доведене до норми 4,5:1 (хвиля контрасту 11.09). */
  --l-accent-btn: #0a7d79;
  --l-accent-text: #0b6b68;
  --l-success: #1a9e75;
  --l-success-text: #127354;
  --success-light: #e0f5ee;
  --l-warning: #c47a15;
  --l-warning-text: #965c10;
  --warning-light: #fdf0d8;
  --l-border: rgba(26,26,46,0.1);
  --border2: rgba(26,26,46,0.06);
  --l-radius: 24px;
  --shadow-card: 0 1px 2px rgba(26,26,46,0.05), 0 18px 48px -20px rgba(26,26,46,0.22);
  --dark: linear-gradient(135deg, #0f0f1a 0%, #1a1f3a 100%);
  font-family: 'Golos Text', system-ui, -apple-system, sans-serif;
  background: var(--bg);
  color: var(--ink);
  font-size: 18px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
}
.landing-root a { color: inherit; }

/* ── NAV ─────────────────────────────────────────────────────────────────── */
.landing-root nav { position: sticky; top: 0; z-index: 100; background: rgba(247,246,242,0.9); backdrop-filter: blur(14px); border-bottom: 1px solid var(--border2); padding: 0 20px; }
.landing-root .nav-inner { max-width: 1160px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; height: 68px; gap: 12px; }
.landing-root .logo { font-family: 'Unbounded', sans-serif; font-weight: 700; font-size: 19px; text-decoration: none; display: flex; align-items: center; gap: 9px; }
.landing-root .logo-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--l-accent); display: inline-block; }
.landing-root .nav-right { display: flex; align-items: center; gap: 8px; }
.landing-root .nav-login { font-size: 16px; font-weight: 600; text-decoration: none; padding: 10px 16px; border-radius: 999px; min-height: 44px; display: inline-flex; align-items: center; border: 1.5px solid var(--l-border); }
.landing-root .nav-login:hover { border-color: var(--ink); }

/* ── HERO ────────────────────────────────────────────────────────────────── */
.landing-root .hero { position: relative; overflow: hidden; padding: 48px 20px 56px; }
.landing-root .hero::before { content: ""; position: absolute; inset: -20% -10% auto auto; width: 560px; height: 560px; border-radius: 50%;
  background: radial-gradient(closest-side, rgba(10,186,181,0.22), rgba(10,186,181,0)); pointer-events: none; }
.landing-root .hero-grid { position: relative; max-width: 1160px; margin: 0 auto; display: grid; grid-template-columns: 1fr; gap: 28px; }
.landing-root .eyebrow { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--l-accent-text); margin-bottom: 18px; }
.landing-root .eyebrow::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--l-accent); }
.landing-root h1 { font-family: 'Unbounded', sans-serif; font-size: clamp(32px, 5vw, 56px); font-weight: 800; line-height: 1.04; letter-spacing: -0.025em; color: var(--ink); margin-bottom: 20px; }
.landing-root .hero-sub { font-size: clamp(18px, 2vw, 22px); line-height: 1.5; color: var(--ink2); max-width: 560px; margin-bottom: 28px; }

.landing-root .paste-card { background: var(--white); border-radius: var(--l-radius); box-shadow: var(--shadow-card); padding: 18px 18px 14px; border: 1px solid var(--border2); }
.landing-root .paste-label { display: block; font-size: 16px; font-weight: 700; margin-bottom: 10px; }
.landing-root .paste-field { display: block; width: 100%; min-height: 168px; border: 1.5px solid var(--l-border); border-radius: 16px; padding: 14px 16px; font: 500 17px/1.55 'Golos Text', system-ui, sans-serif; color: var(--ink); background: #fbfaf7; resize: vertical; outline: none; }
.landing-root .paste-field::placeholder { color: var(--muted2); }
.landing-root .paste-field:focus { border-color: var(--l-accent); box-shadow: 0 0 0 4px rgba(10,186,181,0.18); background: #fff; }
.landing-root .paste-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 10px; }
.landing-root .paste-privacy { font-size: 14px; color: var(--l-muted); line-height: 1.4; flex: 1 1 240px; }
.landing-root .paste-link { background: none; border: none; cursor: pointer; font: 700 15px 'Golos Text', system-ui, sans-serif; color: var(--l-accent-text); min-height: 44px; padding: 0 4px; text-decoration: underline; text-underline-offset: 3px; }

.landing-root .bubble-wrap { position: relative; }
.landing-root .bubble-tag { display: inline-block; font-size: 14px; font-weight: 700; padding: 8px 14px; border-radius: 999px; background: var(--accent-light); color: var(--l-accent-text); margin-bottom: 12px; }
.landing-root .bubble-tag.is-example { background: var(--bg2); color: var(--l-muted); }
.landing-root .bubble-head { display: flex; align-items: center; gap: 10px; font-size: 15px; color: var(--l-muted); margin: 0 0 8px 6px; }
.landing-root .bubble-avatar { width: 30px; height: 30px; border-radius: 50%; background: linear-gradient(135deg,#ffd166,#f4a261); display: inline-flex; align-items: center; justify-content: center; font-size: 16px; }
.landing-root .bubble-sender { font-weight: 700; color: var(--ink); }
.landing-root .bubble-time { margin-left: auto; }
.landing-root .bubble { border-radius: 26px 26px 26px 8px; padding: 22px 24px; color: #fff; background: var(--dark); box-shadow: 0 24px 50px -28px rgba(15,15,26,.8); font-size: 17px; line-height: 1.55; animation: bubble-in .35s ease-out; }
@keyframes bubble-in { from { opacity: 0; transform: translateY(10px) scale(.985); } to { opacity: 1; transform: none; } }
.landing-root .bubble-greet { font-weight: 700; font-size: 18px; }
.landing-root .bubble-lessons { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 4px; color: rgba(255,255,255,.9); }
.landing-root .bubble-lesson-time { display: inline-block; min-width: 60px; font-variant-numeric: tabular-nums; color: rgba(255,255,255,.62); }
.landing-root .bubble-muted { color: rgba(255,255,255,.72); margin-top: 8px; }
.landing-root .bubble-block { margin-top: 16px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,.14); }
.landing-root .bubble-owed-label { font-size: 14px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: rgba(255,255,255,.66); }
.landing-root .bubble-owed { font-family: 'Unbounded', sans-serif; font-size: clamp(34px, 5vw, 44px); font-weight: 800; line-height: 1.1; margin-top: 6px; letter-spacing: -0.02em; }
.landing-root .bubble-names { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 8px; }
.landing-root .bubble-name { display: inline-flex; align-items: center; white-space: nowrap; padding: 6px 12px; border-radius: 999px; background: rgba(255,255,255,.1); color: rgba(255,255,255,.92); font-size: 16px; font-weight: 600; }
.landing-root .bubble-name.is-more { background: transparent; color: rgba(255,255,255,.6); padding-left: 2px; }
.landing-root .bubble-promise { margin-top: 14px; padding: 12px 14px; border-radius: 14px; background: rgba(43,191,170,.16); color: #fff; font-weight: 600; font-size: 16px; line-height: 1.45; }
.landing-root .bubble-zero { font-weight: 600; }
.landing-root .bubble-month { margin: 14px 0 0; padding-top: 12px; border-top: 1px solid rgba(255,255,255,.14); color: rgba(255,255,255,.85); font-size: 16px; }
.landing-root .bubble-hint { font-size: 15px; color: var(--l-muted); margin: 12px 6px 0; line-height: 1.45; }

.landing-root .hero-cta { margin-top: 22px; }
.landing-root .btn-primary { background: var(--l-accent-btn); color: #fff; font-family: 'Golos Text', system-ui, sans-serif; font-weight: 700; font-size: 17px; padding: 16px 28px; border-radius: 999px; text-decoration: none; border: none; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; min-height: 56px; box-shadow: 0 10px 28px -8px rgba(10,125,121,.55); transition: transform .15s, box-shadow .2s; }
.landing-root .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 16px 34px -10px rgba(10,125,121,.6); }
.landing-root .btn-big { width: 100%; font-size: 18px; min-height: 60px; text-align: center; }
.landing-root .cta-note { font-size: 14px; color: var(--l-muted); margin-top: 10px; line-height: 1.45; }
.landing-root .cta-error { font-size: 15px; color: #b42318; margin-top: 8px; }
.landing-root .tg-row { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border2); }
.landing-root .tg-link { background: none; border: none; cursor: pointer; padding: 0; min-height: 44px; display: inline-flex; align-items: center; font: 700 16px 'Golos Text', system-ui, sans-serif; color: var(--l-accent-text); text-decoration: underline; text-underline-offset: 4px; }
.landing-root .tg-link[disabled] { opacity: .6; cursor: default; }

/* ── SECTIONS ────────────────────────────────────────────────────────────── */
.landing-root .l-section { padding: 64px 20px; }
.landing-root .section-inner { max-width: 1160px; margin: 0 auto; }
.landing-root .section-label { font-size: 14px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--l-accent-text); margin-bottom: 14px; }
.landing-root h2 { font-family: 'Unbounded', sans-serif; font-size: clamp(26px, 3.4vw, 42px); font-weight: 800; line-height: 1.12; letter-spacing: -0.02em; margin-bottom: 14px; }
.landing-root .section-sub { font-size: 18px; color: var(--l-muted); max-width: 640px; line-height: 1.55; }
.landing-root .features-bg { background: var(--white); }

/* ── PRICING ─────────────────────────────────────────────────────────────── */
.landing-root .price-grid { display: grid; grid-template-columns: 1fr; gap: 16px; margin-top: 28px; }
.landing-root .price-card { background: var(--white); border-radius: var(--l-radius); border: 1px solid var(--border2); box-shadow: var(--shadow-card); padding: 26px 24px; text-align: left; }
.landing-root .price-card.featured { border: 2px solid var(--l-accent); }
.landing-root .price-plan { font-size: 15px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--l-muted); }
.landing-root .price-badge { display: inline-block; margin-top: 8px; font-size: 14px; font-weight: 700; color: var(--l-accent-text); background: var(--accent-light); padding: 6px 12px; border-radius: 999px; }
.landing-root .price-amount { font-family: 'Unbounded', sans-serif; font-size: 44px; font-weight: 800; letter-spacing: -0.02em; margin-top: 14px; line-height: 1; }
.landing-root .price-period { font-size: 16px; color: var(--l-muted); margin-top: 6px; }
.landing-root .price-annual { font-size: 15px; color: var(--l-muted); margin-top: 4px; }
.landing-root .price-features { list-style: none; margin-top: 18px; display: grid; gap: 8px; font-size: 16px; }
.landing-root .price-note { font-size: 14px; color: var(--l-muted); margin-top: 16px; }
.landing-root .price-schools { margin-top: 20px; font-size: 16px; color: var(--l-muted); }
.landing-root .price-schools a { color: var(--l-accent-text); font-weight: 600; }

/* ── STUDENTS LINE + FINAL CTA + FOOTER ──────────────────────────────────── */
.landing-root .students-strip { padding: 0 20px 56px; }
.landing-root .students-strip-inner { max-width: 1160px; margin: 0 auto; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px 18px; font-size: 16px; color: var(--l-muted); text-align: center; }
.landing-root .students-strip-link { color: var(--l-accent-text); font-weight: 700; text-decoration: none; min-height: 44px; display: inline-flex; align-items: center; }

.landing-root .cta-section { background: var(--dark); color: #fff; padding: 72px 20px; text-align: center; }
.landing-root .cta-inner { max-width: 720px; margin: 0 auto; }
.landing-root .cta-section h2 { color: #fff; }
.landing-root .cta-section p { color: rgba(255,255,255,.8); font-size: 18px; }
.landing-root .cta-buttons { margin-top: 26px; display: flex; justify-content: center; }
.landing-root .btn-white { background: #fff; color: var(--ink); font-weight: 700; font-size: 18px; padding: 16px 32px; border-radius: 999px; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; min-height: 60px; }
.landing-root .cta-footnote { margin-top: 16px; font-size: 14px; color: rgba(255,255,255,.65) !important; }

.landing-root footer { padding: 40px 20px 56px; }
.landing-root .footer-inner { max-width: 1160px; margin: 0 auto; display: grid; gap: 18px; font-size: 15px; color: var(--l-muted); }
.landing-root .footer-logo { font-family: 'Unbounded', sans-serif; font-weight: 700; font-size: 18px; color: var(--ink); }
.landing-root .footer-links { display: flex; gap: 8px 22px; flex-wrap: wrap; }
.landing-root .footer-links a { color: var(--l-muted); text-decoration: none; min-height: 44px; display: inline-flex; align-items: center; }
.landing-root .footer-links a:hover { color: var(--ink); }

/* ── DESKTOP ─────────────────────────────────────────────────────────────── */
@media (min-width: 960px) {
  .landing-root .hero { padding: 72px 32px 88px; }
  .landing-root .hero-grid { grid-template-columns: 1.12fr 0.88fr; gap: 56px; align-items: start; }
  .landing-root .hero-result { position: sticky; top: 92px; }
  .landing-root .l-section { padding: 96px 32px; }
  .landing-root .price-grid { grid-template-columns: 1fr 1fr; gap: 20px; max-width: 820px; margin-left: auto; margin-right: auto; }
  .landing-root .cta-section { padding: 96px 32px; }
}
`;

export default function LandingPage() {
  const { t } = useTranslation();
  const native = isNativeApp(); // Play забороняє чужі прайси цифрових підписок
  const FOUNDING_PER_MONTH = 199;
  const FOUNDING_YEAR_TOTAL = 1990;
  const PRICES = {
    founding: formatPrice(FOUNDING_PER_MONTH, "UAH"),
    foundingY: formatPrice(FOUNDING_YEAR_TOTAL, "UAH"),
    regular: priceLabel("monthly"),
    regularY: totalLabel("yearly"),
  };

  // Одна персона — репетитор (v1). Змінні лишились для «одного дня», щоб
  // майбутні версії (психологи, коучі) отримали свій лендінг без переписування.
  const personaVars: PersonaVars = useMemo(() => {
    const base = t("landing.personas.tutor", { returnObjects: true }) as Omit<PersonaVars, "ClientNom">;
    return { ...base, ClientNom: capFirst(base.clientNom) };
  }, [t]);

  useEffect(() => {
    document.title = `oTutorHub — ${t("landingHero.docTitle")}`;
  }, [t]);

  const signupHref = "/auth?signup=1&role=tutor";
  const telegramUrl = "https://t.me/oksana_chopak";
  const whatsappUrl = "https://api.whatsapp.com/send?phone=46700266274";

  return (
    <>
      <OfflineBanner />
      <div className="landing-root">
        <style>{landingStyles}</style>

        <nav>
          <div className="nav-inner">
            <a href="#top" className="logo"><span className="logo-dot" />oTutorHub</a>
            <div className="nav-right">
              <LanguageSwitcher variant="ghost" size="sm" />
              <Link to="/auth" className="nav-login">{t("landing.nav.login")}</Link>
            </div>
          </div>
        </nav>

        {/* ОДИН потік: обіцянка → список → дайджест → одна кнопка. */}
        <LandingHero signupHref={signupHref} />

        {/* Що робить помічник щодня — історія одного дня, не прайс-лист функцій. */}
        <LandingDayStory personaVars={personaVars} personaId="tutor" />

        {!native && (
          <section className="l-section" id="pricing">
            <div className="section-inner" style={{ textAlign: "center" }}>
              <div className="section-label">{t("landing.pricing.label")}</div>
              <h2>{t("landing.pricing.leadTitle")}</h2>
              <p className="section-sub" style={{ margin: "0 auto" }}>{t("landing.pricing.leadSub")}</p>
              <div className="price-grid">
                <div className="price-card featured">
                  <div className="price-plan">{t("landing.pricing.proPlan")}</div>
                  <div className="price-badge">{t("landing.pricing.proBadge")}</div>
                  <div className="price-amount">{PRICES.regular}</div>
                  <div className="price-period">{t("landing.pricing.perMonth")}</div>
                  <div className="price-annual">{t("landing.pricing.annualLine", { y: PRICES.regularY })}</div>
                  <ul className="price-features">
                    <li>✓ {t("landing.pricing.pro1")}</li>
                    <li>✓ {t("landing.pricing.pro2")}</li>
                    <li>✓ {t("landing.pricing.pro3")}</li>
                    <li>✓ {t("landing.pricing.pro4")}</li>
                    <li>✓ {t("landing.pricing.pro7")}</li>
                  </ul>
                  <div className="price-note">{t("landing.pricing.proNote")}</div>
                </div>
                <div className="price-card">
                  <div className="price-plan">{t("landing.pricing.foundingPlan")}</div>
                  <div className="price-badge">🎓 {t("landing.pricing.foundingBadge")}</div>
                  <div className="price-amount">{PRICES.founding}</div>
                  <div className="price-period">{t("landing.pricing.perMonth")}</div>
                  <div className="price-annual">{t("landing.pricing.annualLine", { y: PRICES.foundingY })}</div>
                  <ul className="price-features">
                    <li>✓ {t("landing.pricing.includesRegular")}</li>
                  </ul>
                  <div className="price-note">{t("landing.pricing.foundingNote")}</div>
                </div>
              </div>
              <p className="price-schools">
                {t("landing.pricing.schoolsLine")}{" "}
                <a href="mailto:hello@otutorhub.com?subject=Online%20school%20oTutorHub">hello@otutorhub.com</a>
              </p>
            </div>
          </section>
        )}

        {/* Учні й батьки — один рядок: запити на підбір живуть на /for-students. */}
        <section className="students-strip" aria-label={t("landing.studentsStrip.cta")}>
          <div className="students-strip-inner">
            <span>{t("landing.studentsStrip.text")}</span>
            <Link to="/for-students" className="students-strip-link">{t("landing.studentsStrip.cta")}</Link>
          </div>
        </section>

        <section className="cta-section">
          <div className="cta-inner">
            <h2>{t("landing.finalCta.title2")}</h2>
            <p>{t("landing.finalCta.sub2")}</p>
            <div className="cta-buttons">
              <Link to={signupHref} className="btn-white">{t("landing.finalCta.cta2")}</Link>
            </div>
            <p className="cta-footnote">{t("landing.finalCta.footnote")}</p>
          </div>
        </section>

        <footer>
          <div className="footer-inner">
            <div className="footer-logo">oTutorHub</div>
            <div className="footer-links">
              <Link to="/auth">{t("landing.nav.login")}</Link>
              <Link to="/for-students">{t("landing.footer.forStudents")}</Link>
              <Link to="/terms">{t("landing.footer.terms")}</Link>
              <Link to="/privacy">{t("landing.footer.privacy")}</Link>
              <a href={telegramUrl} target="_blank" rel="noopener noreferrer">{t("landing.footer.askTelegram")}</a>
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">WhatsApp</a>
              <a href="mailto:hello@otutorhub.com">hello@otutorhub.com</a>
            </div>
            <PaymentMethodsSection />
            <div>{t("landing.footer.copyright")}</div>
          </div>
        </footer>
      </div>
    </>
  );
}
