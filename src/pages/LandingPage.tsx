import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { LandingTryDemo } from "@/components/LandingTryDemo";
import { LandingFindTutorQuizDialog } from "@/components/LandingFindTutorQuizDialog";
import { cn } from "@/lib/utils";

const SPOTS_LEFT = 17; // soft scarcity counter

const PERSONA_IDS = ["tutor", "consultant", "psychologist", "nutritionist", "trainer"] as const;
const PERSONA_EMOJI: Record<string, string> = {
  tutor: "📚",
  consultant: "💼",
  psychologist: "🧠",
  nutritionist: "🥗",
  trainer: "💪",
};

export type PersonaId = typeof PERSONA_IDS[number];
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
.landing-root, .landing-root *, .landing-root *::before, .landing-root *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.landing-root {
  --ink: #1a1a2e;
  --ink2: #2d2d4a;
  --l-muted: #6b6b8a;
  --muted2: #9494aa;
  --bg: #f7f6f2;
  --bg2: #eeece6;
  --white: #ffffff;
  --l-accent: #0ABAB5;
  --l-accent2: #2dd4cf;
  --accent-light: #d6f5f3;
  --l-success: #1a9e75;
  --success-light: #e0f5ee;
  --l-warning: #c47a15;
  --warning-light: #fdf0d8;
  --l-border: rgba(26,26,46,0.1);
  --border2: rgba(26,26,46,0.06);
  --l-radius: 16px;
  --radius-sm: 10px;
  --shadow: 0 2px 24px rgba(10,186,181,0.08);
  --shadow-card: 0 1px 3px rgba(0,0,0,0.06), 0 8px 32px rgba(0,0,0,0.06);
  font-family: 'Golos Text', sans-serif;
  background: var(--bg);
  color: var(--ink);
  font-size: 16px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  scroll-behavior: smooth;
  min-height: 100vh;
}

.landing-root nav {
  position: sticky; top: 0; z-index: 100;
  background: rgba(247,246,242,0.92);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border2);
  padding: 0 2rem;
}
.landing-root .nav-inner {
  max-width: 1100px; margin: 0 auto;
  display: flex; align-items: center; justify-content: space-between;
  height: 64px;
}
.landing-root .logo {
  font-family: 'Unbounded', sans-serif;
  font-weight: 700; font-size: 18px;
  color: var(--ink); text-decoration: none;
  display: flex; align-items: center; gap: 8px;
}
.landing-root .logo-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--l-accent); display: inline-block;
}
.landing-root .nav-links { display: flex; align-items: center; gap: 2rem; list-style: none; }
.landing-root .nav-links a {
  font-size: 14px; font-weight: 500;
  color: var(--l-muted); text-decoration: none;
  transition: color 0.2s;
}
.landing-root .nav-links a:hover { color: var(--ink); }
.landing-root .btn-nav {
  background: var(--l-accent); color: #fff;
  font-family: 'Golos Text', sans-serif;
  font-weight: 600; font-size: 14px;
  padding: 10px 22px; border-radius: 100px;
  text-decoration: none; border: none; cursor: pointer;
  transition: background 0.2s, transform 0.15s;
  display: inline-block;
}
.landing-root .btn-nav:hover { background: var(--l-accent2); transform: translateY(-1px); }

.landing-root .hero {
  max-width: 1100px; margin: 0 auto;
  padding: 80px 2rem 60px;
  text-align: center;
}
.landing-root .spots-badge {
  display: inline-flex; align-items: center; gap: 8px;
  background: #fff5e6; color: #c47a15;
  font-size: 13px; font-weight: 700;
  padding: 8px 16px; border-radius: 100px;
  margin-bottom: 28px;
  border: 1px solid rgba(196,122,21,0.2);
}
.landing-root h1 {
  font-family: 'Unbounded', sans-serif;
  font-size: clamp(34px, 5vw, 60px);
  font-weight: 900; line-height: 1.05;
  color: var(--ink); margin-bottom: 24px;
  letter-spacing: -0.02em;
  max-width: 880px; margin-left: auto; margin-right: auto;
}
.landing-root h1 .accent { color: var(--l-accent); }
.landing-root .hero-sub {
  font-size: clamp(18px, 2vw, 22px);
  color: var(--ink2);
  line-height: 1.5; margin-bottom: 18px;
  font-weight: 500;
  max-width: 720px; margin-left: auto; margin-right: auto;
}
.landing-root .hero-desc {
  font-size: 16px; color: var(--l-muted);
  line-height: 1.7; margin-bottom: 36px;
  max-width: 640px; margin-left: auto; margin-right: auto;
}
.landing-root .hero-cta {
  display: flex; gap: 12px; flex-wrap: wrap; align-items: center; justify-content: center;
}
.landing-root .btn-primary {
  background: var(--l-accent); color: #fff;
  font-family: 'Golos Text', sans-serif;
  font-weight: 600; font-size: 16px;
  padding: 16px 32px; border-radius: 100px;
  text-decoration: none; border: none; cursor: pointer;
  transition: all 0.2s; display: inline-block;
  box-shadow: 0 4px 20px rgba(10,186,181,0.35);
}
.landing-root .btn-primary:hover {
  background: var(--l-accent2);
  transform: translateY(-2px);
  box-shadow: 0 8px 28px rgba(10,186,181,0.4);
}
.landing-root .btn-ghost {
  background: transparent; color: var(--ink);
  font-family: 'Golos Text', sans-serif;
  font-weight: 500; font-size: 16px;
  padding: 16px 28px; border-radius: 100px;
  text-decoration: none; border: 1.5px solid var(--l-border);
  cursor: pointer; transition: all 0.2s; display: inline-block;
}
.landing-root .btn-ghost:hover {
  border-color: var(--l-accent); color: var(--l-accent);
  background: var(--accent-light);
}

.landing-root .l-section { padding: 80px 2rem; }
.landing-root .section-inner { max-width: 1100px; margin: 0 auto; }
.landing-root .section-label {
  font-size: 12px; font-weight: 700;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--l-accent); margin-bottom: 16px;
}
.landing-root h2 {
  font-family: 'Unbounded', sans-serif;
  font-size: clamp(26px, 3vw, 40px);
  font-weight: 800; line-height: 1.15;
  color: var(--ink); margin-bottom: 16px;
  letter-spacing: -0.02em;
}
.landing-root .section-sub {
  font-size: 17px; color: var(--l-muted);
  max-width: 640px; line-height: 1.6;
}
.landing-root .section-alt { background: var(--bg); }
.landing-root .features-bg { background: var(--white); }

/* Assistant grid */
.landing-root .assistant-grid {
  display: grid; grid-template-columns: repeat(2, 1fr);
  gap: 16px; margin-top: 40px;
}
.landing-root .assistant-card {
  background: var(--white);
  border-radius: var(--l-radius);
  padding: 22px;
  border: 1px solid var(--border2);
  display: flex; gap: 14px; align-items: flex-start;
  transition: transform 0.2s, box-shadow 0.2s;
}
.landing-root .assistant-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow);
}
.landing-root .assistant-emoji {
  font-size: 26px; line-height: 1;
  flex-shrink: 0;
  width: 44px; height: 44px;
  border-radius: 12px;
  background: var(--accent-light);
  display: flex; align-items: center; justify-content: center;
}
.landing-root .assistant-title {
  font-size: 15px; font-weight: 700;
  color: var(--ink); margin-bottom: 4px;
  line-height: 1.3;
}
.landing-root .assistant-text {
  font-size: 14px; color: var(--l-muted);
  line-height: 1.55;
}

/* Glance section */
.landing-root .glance-grid {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 16px; margin-top: 40px;
}
.landing-root .glance-card {
  background: var(--white);
  border-radius: var(--l-radius);
  padding: 24px 20px;
  border: 1px solid var(--border2);
  text-align: left;
}
.landing-root .glance-num {
  font-family: 'Unbounded', sans-serif;
  font-size: 36px; font-weight: 900;
  color: var(--l-accent); line-height: 1;
  margin-bottom: 12px;
}
.landing-root .glance-text {
  font-size: 15px; font-weight: 600;
  color: var(--ink); line-height: 1.4;
}

/* Steps */
.landing-root .steps-grid {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 24px; margin-top: 48px;
}
.landing-root .step-card {
  background: var(--white);
  border-radius: var(--l-radius);
  padding: 32px 24px;
  border: 1px solid var(--border2);
  position: relative;
}
.landing-root .step-num {
  position: absolute; top: -18px; left: 24px;
  width: 44px; height: 44px;
  border-radius: 50%;
  background: var(--l-accent); color: #fff;
  font-family: 'Unbounded', sans-serif;
  font-size: 18px; font-weight: 900;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 14px rgba(10,186,181,0.35);
}
.landing-root .step-title {
  font-size: 17px; font-weight: 700;
  color: var(--ink); margin: 12px 0 8px;
  line-height: 1.3;
}
.landing-root .step-text {
  font-size: 14px; color: var(--l-muted);
  line-height: 1.6;
}

/* Final CTA */
.landing-root .cta-section {
  background: var(--ink);
  padding: 80px 2rem;
  text-align: center;
  position: relative; overflow: hidden;
}
.landing-root .cta-section::before {
  content: '';
  position: absolute; inset: 0;
  background: radial-gradient(circle at 30% 50%, rgba(10,186,181,0.3) 0%, transparent 60%),
              radial-gradient(circle at 70% 50%, rgba(45,212,207,0.2) 0%, transparent 60%);
  pointer-events: none;
}
.landing-root .cta-inner { max-width: 720px; margin: 0 auto; position: relative; }
.landing-root .cta-section .spots-badge {
  background: rgba(255,255,255,0.1); color: #fff;
  border-color: rgba(255,255,255,0.15);
}
.landing-root .cta-section h2 { color: white; font-size: clamp(28px, 3.5vw, 44px); }
.landing-root .cta-section p { color: rgba(255,255,255,0.7); font-size: 17px; margin: 16px 0 36px; }
.landing-root .btn-white {
  background: white; color: var(--l-accent);
  font-family: 'Golos Text', sans-serif;
  font-weight: 700; font-size: 16px;
  padding: 16px 32px; border-radius: 100px;
  text-decoration: none; border: none; cursor: pointer;
  transition: all 0.2s; display: inline-block;
  box-shadow: 0 4px 20px rgba(0,0,0,0.2);
}
.landing-root .btn-white:hover { transform: translateY(-2px); box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
.landing-root .btn-outline-white {
  background: transparent; color: #fff;
  font-family: 'Golos Text', sans-serif;
  font-weight: 600; font-size: 16px;
  padding: 16px 28px; border-radius: 100px;
  text-decoration: none; border: 1.5px solid rgba(255,255,255,0.3);
  cursor: pointer; transition: all 0.2s; display: inline-block;
}
.landing-root .btn-outline-white:hover { border-color: #fff; background: rgba(255,255,255,0.05); }
.landing-root .cta-buttons { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
.landing-root .cta-footnote { color: rgba(255,255,255,0.4); font-size: 13px; margin-top: 20px; }

.landing-root footer {
  background: var(--ink2);
  padding: 40px 2rem;
  color: rgba(255,255,255,0.4);
  font-size: 13px;
}
.landing-root .footer-inner {
  max-width: 1100px; margin: 0 auto;
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 16px;
}
.landing-root .footer-logo {
  font-family: 'Unbounded', sans-serif;
  font-size: 16px; font-weight: 700;
  color: white;
}
.landing-root footer a { color: rgba(255,255,255,0.5); text-decoration: none; }
.landing-root footer a:hover { color: white; }

.landing-root .fade-up { opacity: 0; transform: translateY(24px); transition: opacity 0.6s ease, transform 0.6s ease; }
.landing-root .fade-up.visible { opacity: 1; transform: translateY(0); }

@media (max-width: 900px) {
  .landing-root .assistant-grid { grid-template-columns: 1fr; }
  .landing-root .glance-grid { grid-template-columns: repeat(2, 1fr); }
  .landing-root .steps-grid { grid-template-columns: 1fr; gap: 32px; }
  .landing-root .nav-links { display: none; }
}
@media (max-width: 600px) {
  .landing-root nav { padding: 0 1rem; }
  .landing-root .nav-inner { height: 56px; gap: 8px; }
  .landing-root .logo { font-size: 15px; gap: 6px; }
  .landing-root .btn-nav { padding: 8px 14px; font-size: 13px; }
  .landing-root .glance-grid { grid-template-columns: 1fr; }
  .landing-root .hero { padding: 32px 1rem 40px; }
  .landing-root .hero-cta, .landing-root .cta-buttons { flex-direction: column; align-items: stretch; gap: 10px; }
  .landing-root .hero-cta .btn-primary,
  .landing-root .hero-cta .btn-ghost,
  .landing-root .cta-buttons .btn-white,
  .landing-root .cta-buttons .btn-outline-white { width: 100%; text-align: center; }
}

.landing-root .persona-word {
  color: var(--l-accent) !important;
  cursor: pointer;
  border-bottom: 2px dotted var(--l-accent);
  transition: opacity 0.3s ease, transform 0.3s ease;
  display: inline-block;
}
.landing-root h1 .persona-word { color: var(--l-accent) !important; }
.landing-root .persona-accent { color: var(--l-accent) !important; }
.landing-root .persona-word.swap { opacity: 0; transform: translateY(-6px); }
.landing-root .persona-pills {
  display: flex; flex-wrap: wrap; gap: 8px;
  justify-content: center; margin: 18px 0 28px;
}
.landing-root .persona-pill {
  background: var(--white);
  color: var(--l-text);
  border: 1px solid var(--l-border);
  font-family: 'Golos Text', sans-serif;
  font-weight: 600; font-size: 13px;
  padding: 8px 16px; border-radius: 100px;
  cursor: pointer; transition: all 0.2s;
}
.landing-root .persona-pill:hover { border-color: var(--l-accent); }
.landing-root .persona-pill.active {
  background: var(--l-accent); color: #fff;
  border-color: var(--l-accent);
  box-shadow: 0 4px 14px rgba(10,186,181,0.3);
}
.landing-root .pain-section {
  background: var(--bg2); padding: 56px 2rem;
}
.landing-root .pain-inner {
  max-width: 720px; margin: 0 auto; text-align: center;
}
.landing-root .pain-label {
  font-size: 12px; font-weight: 700; letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--l-warning); margin-bottom: 12px;
}
.landing-root .pain-title {
  font-family: 'Unbounded', sans-serif;
  font-size: clamp(22px, 2.6vw, 32px); font-weight: 800;
  color: var(--ink); line-height: 1.3;
  transition: opacity 0.3s ease;
}
.landing-root .pain-question { min-height: calc(1.3em * 3); display: flex; align-items: center; justify-content: center; }
.landing-root .pain-answer { min-height: calc(1.5em * 3); display: flex; align-items: center; justify-content: center; }
.landing-root .persona-fade { transition: opacity 0.35s ease, transform 0.35s ease, filter 0.35s ease; }
.landing-root .persona-fade.swap { opacity: 0; transform: translateY(8px) scale(0.98); filter: blur(4px); }
.landing-root .chat-bubble {
  position: fixed; right: 1.5rem; z-index: 50;
  display: flex; align-items: center; gap: 0.5rem;
  color: #fff; padding: 0.75rem 1rem; border-radius: 999px;
  box-shadow: 0 10px 28px rgba(26,26,46,0.18);
  transition: transform 0.2s ease, filter 0.2s ease;
  text-decoration: none; font-weight: 700;
}
.landing-root .chat-bubble:hover { transform: scale(1.05); filter: brightness(0.94); }
.landing-root .chat-bubble svg { width: 1.25rem; height: 1.25rem; fill: currentColor; flex-shrink: 0; }
.landing-root .chat-bubble-whatsapp { bottom: 5rem; background: hsl(142 70% 49%); }
.landing-root .chat-bubble-telegram { bottom: 1.5rem; background: hsl(200 73% 49%); }
@media (max-width: 639px) { .landing-root .chat-bubble span { display: none; } }
`;

export default function LandingPage() {
  const { t } = useTranslation();
  const [quizOpen, setQuizOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const animationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const personaId = PERSONA_IDS[activeIndex];

  const personaVars: PersonaVars = useMemo(() => {
    const base = t(`landing.personas.${personaId}`, { returnObjects: true }) as {
      label: string; labelNom: string; labelAcc: string;
      client: string; clientNom: string; clientDative: string;
      clients: string; clientsNom: string; clientsAcc: string; clientsGen: string;
      session: string; sessions: string; sessionsGen: string;
    };
    return {
      ...base,
      ClientNom: capFirst(base.clientNom),
    };
  }, [personaId, t]);

  const painShort = t(`landing.personas.${personaId}.painShort`);
  const painFull = t(`landing.personas.${personaId}.painFull`);
  const tp = (key: string) => t(key, personaVars);

  const stopPersonaRotation = useCallback(() => {
    setIsPaused(true);
    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current);
      animationTimeoutRef.current = null;
    }
  }, []);

  const withPersonaAccent = (text: string) => {
    const label = personaVars.label;
    const normalizedLabel = label.trim();
    const start = text.toLocaleLowerCase().indexOf(normalizedLabel.toLocaleLowerCase());
    if (start === -1) return text;

    return (
      <>
        {text.slice(0, start)}
        <span className="persona-accent">{text.slice(start, start + normalizedLabel.length)}</span>
        {text.slice(start + normalizedLabel.length)}
      </>
    );
  };

  useEffect(() => {
    document.title = `oTutorHub — ${tp("landing.hero.titlePrefix")} ${personaVars.label}`;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("visible");
            obs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 },
    );
    document.querySelectorAll(".landing-root .fade-up").forEach((el) => obs.observe(el));
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personaId]);

  // Auto-rotate persona every 2.5s until user pauses
  useEffect(() => {
    if (isPaused) return;
    const timer = setInterval(() => {
      setIsAnimating(true);
      animationTimeoutRef.current = setTimeout(() => {
        setActiveIndex((i) => (i + 1) % PERSONA_IDS.length);
        setIsAnimating(false);
        animationTimeoutRef.current = null;
      }, 300);
    }, 2500);
    return () => {
      clearInterval(timer);
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
        animationTimeoutRef.current = null;
      }
    };
  }, [isPaused]);

  // Safety net: never let the swap animation linger as a blank screen.
  useEffect(() => {
    if (!isAnimating) return;
    const t = setTimeout(() => setIsAnimating(false), 800);
    return () => clearTimeout(t);
  }, [isAnimating]);

  useEffect(() => () => {
    if (pickTimeoutRef.current) clearTimeout(pickTimeoutRef.current);
  }, []);

  const pickPersona = (i: number) => {
    stopPersonaRotation();
    if (pickTimeoutRef.current) clearTimeout(pickTimeoutRef.current);
    setIsAnimating(true);
    pickTimeoutRef.current = setTimeout(() => {
      setActiveIndex(i);
      setIsAnimating(false);
      pickTimeoutRef.current = null;
    }, 200);
  };

  const handlePersonaPick = (i: number) => (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    pickPersona(i);
  };

  const signupHref = "/auth?signup=1&role=tutor";
  const whatsappUrl = "https://api.whatsapp.com/send?phone=46700266274";
  const telegramUrl = "https://t.me/oksana_chopak";

  const openChatLink = (url: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();

    try {
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (opened) return;
    } catch {
      // Fallback below handles iframe/browser restrictions.
    }

    window.location.assign(url);
  };

  const assistantItems = useMemo(() => ([
    { emoji: "☀️", title: tp("landing.assistant.i1Title"), text: tp("landing.assistant.i1Text") },
    { emoji: "🔔", title: tp("landing.assistant.i2Title"), text: tp("landing.assistant.i2Text") },
    { emoji: "⏰", title: tp("landing.assistant.i3Title"), text: tp("landing.assistant.i3Text") },
    { emoji: "📝", title: tp("landing.assistant.i4Title"), text: tp("landing.assistant.i4Text") },
    { emoji: "📅", title: tp("landing.assistant.i5Title"), text: tp("landing.assistant.i5Text") },
    { emoji: "💸", title: tp("landing.assistant.i6Title"), text: tp("landing.assistant.i6Text") },
    { emoji: "💬", title: tp("landing.assistant.i7Title"), text: tp("landing.assistant.i7Text") },
    { emoji: "👥", title: tp("landing.assistant.i8Title"), text: tp("landing.assistant.i8Text") },
    { emoji: "🗓️", title: tp("landing.assistant.i9Title"), text: tp("landing.assistant.i9Text") },
    { emoji: "♾️", title: tp("landing.assistant.i10Title"), text: tp("landing.assistant.i10Text") },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [personaId, t]);

  return (
    <div className="landing-root" onClickCapture={stopPersonaRotation}>
      <style>{landingStyles}</style>

      {/* NAV */}
      <nav>
        <div className="nav-inner">
          <a href="#top" className="logo">
            <span className="logo-dot"></span>
            oTutorHub
          </a>
          <ul className="nav-links">
            <li><a href="#features">{t("landing.nav.features")}</a></li>
            <li><a href="#how">{t("landing.nav.howItWorks")}</a></li>
            <li><a href="#glance">{t("landing.nav.dashboard")}</a></li>
          </ul>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <LanguageSwitcher variant="ghost" size="sm" />
            <Link to={signupHref} className="btn-nav">{t("landing.nav.tryFree")}</Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section id="top" style={{ background: "var(--bg)", overflow: "hidden" }}>
        <div className="hero">
          <div className="spots-badge">
            {t("landing.hero.spotsBadge", { count: SPOTS_LEFT })}
          </div>
          <h1>
            {t("landing.hero.titlePrefix")}{" "}
            <span
              className={cn("persona-word", isAnimating && "swap")}
              onClick={stopPersonaRotation}
              title={t("landing.hero.fixHint")}
            >
              {personaVars.label}
            </span>
          </h1>
          <div className="persona-pills">
            {PERSONA_IDS.map((pid, i) => (
              <button
                key={pid}
                type="button"
                onClick={handlePersonaPick(i)}
                className={cn("persona-pill", activeIndex === i && "active")}
              >
                {PERSONA_EMOJI[pid]} {t(`landing.personas.${pid}.label`)}
              </button>
            ))}
          </div>
          <p className={cn("hero-sub persona-fade", isAnimating && "swap")}>{tp("landing.hero.sub")}</p>
          <p className={cn("hero-desc persona-fade", isAnimating && "swap")}>{tp("landing.hero.description")}</p>
          <div className="hero-cta">
            <Link to={signupHref} className="btn-primary">{t("landing.hero.ctaPrimary")}</Link>
            <button type="button" className="btn-ghost" onClick={() => setQuizOpen(true)}>
              {tp("landing.hero.ctaSecondaryDyn")}
            </button>
          </div>
        </div>
      </section>

      {/* PAIN — "Знайомо?" */}
      <section className="pain-section">
        <div className="pain-inner">
          <div className="pain-label">{t("landing.pain.label")}</div>
          <h2 className="pain-title pain-question">
            {painFull}
          </h2>
          <p className="pain-title pain-answer"
             style={{ fontSize: 16, fontFamily: "'Golos Text', sans-serif", fontWeight: 500, color: "var(--l-muted)", marginTop: 16 }}>
            {painShort}
          </p>
        </div>
      </section>

      {/* ASSISTANT — what it does */}
      <section className="l-section features-bg" id="features">
        <div className="section-inner">
          <div className="section-label">{t("landing.assistant.label")}</div>
          <h2>{withPersonaAccent(tp("landing.assistant.title"))}</h2>
          <p className="section-sub">{tp("landing.assistant.sub")}</p>
          <div className="assistant-grid fade-up">
            {assistantItems.map((it, i) => (
              <div key={`${personaId}-${i}`} className="assistant-card">
                <div className="assistant-emoji">{it.emoji}</div>
                <div>
                  <div className="assistant-title">{it.title}</div>
                  <p className="assistant-text">{it.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* GLANCE */}
      <section className="l-section section-alt" id="glance">
        <div className="section-inner">
          <div className="section-label">{t("landing.glance.label")}</div>
          <h2>{withPersonaAccent(tp("landing.glance.title"))}</h2>
          <p className="section-sub">{tp("landing.glance.sub")}</p>
          <div className={cn("glance-grid fade-up persona-fade", isAnimating && "swap")}>
            <div className="glance-card"><div className="glance-num">💰</div><div className="glance-text">{tp("landing.glance.i1")}</div></div>
            <div className="glance-card"><div className="glance-num">✓</div><div className="glance-text">{tp("landing.glance.i2")}</div></div>
            <div className="glance-card"><div className="glance-num">📅</div><div className="glance-text">{tp("landing.glance.i3")}</div></div>
            <div className="glance-card"><div className="glance-num">📝</div><div className="glance-text">{tp("landing.glance.i4")}</div></div>
          </div>
        </div>
      </section>

      {/* STEPS */}
      <section className="l-section features-bg" id="how">
        <div className="section-inner">
          <div className="section-label">{t("landing.steps.label")}</div>
          <h2>{withPersonaAccent(tp("landing.steps.title"))}</h2>
          <div className={cn("steps-grid fade-up persona-fade", isAnimating && "swap")}>
            <div className="step-card">
              <div className="step-num">{t("landing.steps.s1Num")}</div>
              <div className="step-title">{tp("landing.steps.s1Title")}</div>
              <p className="step-text">{tp("landing.steps.s1Text")}</p>
            </div>
            <div className="step-card">
              <div className="step-num">{t("landing.steps.s2Num")}</div>
              <div className="step-title">{tp("landing.steps.s2Title")}</div>
              <p className="step-text">{tp("landing.steps.s2Text")}</p>
            </div>
            <div className="step-card">
              <div className="step-num">{t("landing.steps.s3Num")}</div>
              <div className="step-title">{tp("landing.steps.s3Title")}</div>
              <p className="step-text">{tp("landing.steps.s3Text")}</p>
            </div>
          </div>
        </div>
      </section>

      {/* TRY DEMO */}
      <LandingTryDemo personaVars={personaVars} personaId={personaId} isAnimating={isAnimating} />

      {/* FINAL CTA */}
      <section className="cta-section">
        <div className="cta-inner">
          <div className="spots-badge">
            {t("landing.finalCta.spots", { count: SPOTS_LEFT })}
          </div>
          <h2 style={{ marginTop: 16 }}>{tp("landing.finalCta.title")}</h2>
          <p>{tp("landing.finalCta.sub")}</p>
          <div className="cta-buttons">
            <Link to={signupHref} className="btn-white">{t("landing.finalCta.ctaPrimary")}</Link>
            <button type="button" className="btn-outline-white" onClick={() => setQuizOpen(true)}>
              {tp("landing.finalCta.ctaSecondaryDyn")}
            </button>
          </div>
          <p className="cta-footnote">{tp("landing.finalCta.footnote")}</p>
        </div>
      </section>

      {/* FOOTER */}
      <footer>
        <div className="footer-inner">
          <div className="footer-logo">oTutorHub</div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <Link to="/auth">{t("landing.footer.app")}</Link>
            <Link to="/terms">{t("landing.footer.terms")}</Link>
            <Link to="/privacy">{t("landing.footer.privacy")}</Link>
            <a href="mailto:hello@otutorhub.com">{t("landing.footer.contact")}</a>
          </div>
          <div>{t("landing.footer.copyright")}</div>
        </div>
      </footer>

      <LandingFindTutorQuizDialog open={quizOpen} onOpenChange={setQuizOpen} />

      {/* WhatsApp floating bubble */}
      <a
        href={whatsappUrl}
        onClick={openChatLink(whatsappUrl)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="WhatsApp"
        className="chat-bubble chat-bubble-whatsapp"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
          <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.118 1.528 5.855L0 24l6.335-1.507A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.006-1.371l-.36-.214-3.727.977.995-3.636-.235-.374A9.818 9.818 0 1112 21.818z" />
        </svg>
        <span className="hidden sm:inline">WhatsApp</span>
      </a>

      {/* Telegram floating bubble */}
      <a
        href={telegramUrl}
        onClick={openChatLink(telegramUrl)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Telegram"
        className="chat-bubble chat-bubble-telegram"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-1.97 9.289c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.48 14.013l-2.95-.924c-.64-.203-.652-.64.136-.953l11.57-4.461c.537-.194 1.006.131.326.573z" />
        </svg>
        <span className="hidden sm:inline">Telegram</span>
      </a>
    </div>
  );
}
