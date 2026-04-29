import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

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
.landing-root .nav-links {
  display: flex; align-items: center; gap: 2rem;
  list-style: none;
}
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
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 64px; align-items: center;
}
.landing-root .hero-badge {
  display: inline-flex; align-items: center; gap: 8px;
  background: var(--accent-light); color: var(--l-accent);
  font-size: 13px; font-weight: 600;
  padding: 6px 14px; border-radius: 100px;
  margin-bottom: 24px;
  border: 1px solid rgba(10,186,181,0.2);
}
.landing-root .hero-badge-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--l-accent); animation: l-pulse 2s infinite;
}
@keyframes l-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.8); }
}
.landing-root h1 {
  font-family: 'Unbounded', sans-serif;
  font-size: clamp(32px, 4vw, 52px);
  font-weight: 900; line-height: 1.1;
  color: var(--ink); margin-bottom: 24px;
  letter-spacing: -0.02em;
}
.landing-root h1 .accent { color: var(--l-accent); }
.landing-root .hero-sub {
  font-size: 18px; color: var(--l-muted);
  line-height: 1.7; margin-bottom: 36px;
  font-weight: 400;
}
.landing-root .hero-cta {
  display: flex; gap: 12px; flex-wrap: wrap; align-items: center;
}
.landing-root .btn-primary {
  background: var(--l-accent); color: #fff;
  font-family: 'Golos Text', sans-serif;
  font-weight: 600; font-size: 16px;
  padding: 14px 32px; border-radius: 100px;
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
  padding: 14px 24px; border-radius: 100px;
  text-decoration: none; border: 1.5px solid var(--l-border);
  cursor: pointer; transition: all 0.2s; display: inline-block;
}
.landing-root .btn-ghost:hover {
  border-color: var(--l-accent); color: var(--l-accent);
  background: var(--accent-light);
}
.landing-root .hero-note {
  margin-top: 20px; font-size: 13px; color: var(--muted2);
  display: flex; align-items: center; gap: 6px;
}
.landing-root .hero-note::before {
  content: ''; display: inline-block;
  width: 14px; height: 14px;
  background: var(--l-success);
  border-radius: 50%;
  flex-shrink: 0;
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='white' d='M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z'/%3E%3C/svg%3E");
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='white' d='M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z'/%3E%3C/svg%3E");
}

.landing-root .hero-visual { position: relative; }
.landing-root .app-frame {
  background: var(--white);
  border-radius: 20px;
  border: 1px solid var(--l-border);
  box-shadow: var(--shadow-card), 0 24px 80px rgba(0,0,0,0.1);
  overflow: hidden;
}
.landing-root .app-topbar {
  background: var(--white);
  border-bottom: 1px solid var(--border2);
  padding: 14px 20px;
  display: flex; align-items: center; gap: 8px;
}
.landing-root .dot { width: 10px; height: 10px; border-radius: 50%; }
.landing-root .dot-r { background: #ff6059; }
.landing-root .dot-y { background: #ffbd2e; }
.landing-root .dot-g { background: #28c840; }
.landing-root .app-content { padding: 20px; }
.landing-root .app-title {
  font-family: 'Unbounded', sans-serif;
  font-size: 13px; font-weight: 600;
  color: var(--ink); margin-bottom: 16px;
}
.landing-root .stat-row {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 10px; margin-bottom: 16px;
}
.landing-root .stat-card-l {
  background: var(--bg); border-radius: var(--radius-sm);
  padding: 12px 14px;
  border: 1px solid var(--border2);
}
.landing-root .stat-label-l { font-size: 11px; color: var(--l-muted); font-weight: 500; margin-bottom: 4px; }
.landing-root .stat-val { font-size: 22px; font-weight: 700; color: var(--ink); font-family: 'Unbounded', sans-serif; }
.landing-root .stat-val.green { color: var(--l-success); }
.landing-root .stat-val.purple { color: var(--l-accent); }
.landing-root .lesson-item {
  background: var(--bg);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  margin-bottom: 8px;
  display: flex; justify-content: space-between; align-items: center;
  border: 1px solid var(--border2);
}
.landing-root .lesson-name { font-size: 13px; font-weight: 600; color: var(--ink); }
.landing-root .lesson-sub { font-size: 11px; color: var(--l-muted); margin-top: 2px; }
.landing-root .pill {
  font-size: 11px; font-weight: 600; padding: 4px 10px;
  border-radius: 100px;
}
.landing-root .pill-green { background: var(--success-light); color: var(--l-success); }
.landing-root .pill-warning { background: var(--warning-light); color: var(--l-warning); }
.landing-root .pill-purple { background: var(--accent-light); color: var(--l-accent); }
.landing-root .float-badge {
  position: absolute; right: -20px; top: 40px;
  background: var(--white);
  border-radius: 14px; padding: 12px 16px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.12);
  border: 1px solid var(--l-border);
  font-size: 12px; font-weight: 500; color: var(--ink);
  white-space: nowrap;
  animation: l-float 3s ease-in-out infinite;
}
.landing-root .float-badge2 {
  position: absolute; left: -20px; bottom: 60px;
  background: var(--white);
  border-radius: 14px; padding: 12px 16px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.12);
  border: 1px solid var(--l-border);
  font-size: 12px; font-weight: 500; color: var(--ink);
  white-space: nowrap;
  animation: l-float 3s ease-in-out infinite 1.5s;
}
@keyframes l-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}
.landing-root .badge-icon { margin-right: 6px; }

.landing-root .social-strip {
  background: var(--ink);
  padding: 20px 2rem;
  overflow: hidden;
}
.landing-root .social-inner {
  max-width: 1100px; margin: 0 auto;
  display: flex; align-items: center; gap: 48px;
  justify-content: center; flex-wrap: wrap;
}
.landing-root .social-stat { text-align: center; color: white; }
.landing-root .social-stat-num {
  font-family: 'Unbounded', sans-serif;
  font-size: 28px; font-weight: 700;
  display: block;
}
.landing-root .social-stat-label { font-size: 13px; color: rgba(255,255,255,0.5); }
.landing-root .social-divider { width: 1px; height: 40px; background: rgba(255,255,255,0.1); }

.landing-root .l-section { padding: 80px 2rem; }
.landing-root .section-inner { max-width: 1100px; margin: 0 auto; }
.landing-root .section-label {
  font-size: 12px; font-weight: 700;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--l-accent); margin-bottom: 16px;
}
.landing-root h2 {
  font-family: 'Unbounded', sans-serif;
  font-size: clamp(24px, 3vw, 38px);
  font-weight: 800; line-height: 1.15;
  color: var(--ink); margin-bottom: 16px;
  letter-spacing: -0.02em;
}
.landing-root .section-sub {
  font-size: 17px; color: var(--l-muted);
  max-width: 560px; line-height: 1.7;
}
.landing-root .pain-grid {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 20px; margin-top: 48px;
}
.landing-root .pain-card {
  background: var(--white);
  border-radius: var(--l-radius);
  padding: 28px 24px;
  border: 1px solid var(--border2);
  transition: box-shadow 0.2s, transform 0.2s;
}
.landing-root .pain-card:hover {
  box-shadow: var(--shadow);
  transform: translateY(-3px);
}
.landing-root .pain-icon {
  width: 48px; height: 48px;
  border-radius: 14px;
  background: var(--accent-light);
  display: flex; align-items: center; justify-content: center;
  font-size: 26px; margin-bottom: 16px;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.landing-root .pain-card:hover .pain-icon {
  transform: rotate(-8deg) scale(1.1);
}
.landing-root .pain-title { font-size: 16px; font-weight: 600; color: var(--ink); margin-bottom: 8px; }
.landing-root .pain-text { font-size: 14px; color: var(--l-muted); line-height: 1.6; }

.landing-root .features-bg { background: var(--white); }
.landing-root .features-grid {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 80px; align-items: center;
  margin-top: 48px;
}
.landing-root .feature-list { display: flex; flex-direction: column; gap: 28px; }
.landing-root .feature-item { display: flex; gap: 16px; align-items: flex-start; }
.landing-root .feature-ico {
  width: 40px; height: 40px; flex-shrink: 0;
  border-radius: 10px;
  background: var(--accent-light);
  display: flex; align-items: center; justify-content: center;
  font-size: 18px;
}
.landing-root .feature-title { font-size: 16px; font-weight: 600; color: var(--ink); margin-bottom: 4px; }
.landing-root .feature-text { font-size: 14px; color: var(--l-muted); line-height: 1.6; }
.landing-root .feature-tag {
  display: inline-block;
  font-size: 11px; font-weight: 700;
  padding: 3px 8px; border-radius: 6px;
  background: var(--accent-light); color: var(--l-accent);
  margin-left: 8px; vertical-align: middle;
}
.landing-root .phone-wrap { position: relative; display: flex; justify-content: center; }
.landing-root .phone-frame {
  width: 260px;
  background: var(--white);
  border-radius: 32px;
  border: 1px solid var(--l-border);
  box-shadow: var(--shadow-card), 0 32px 80px rgba(0,0,0,0.1);
  overflow: hidden;
  position: relative;
}
.landing-root .phone-notch {
  height: 28px;
  background: var(--ink);
  display: flex; align-items: flex-end; justify-content: center;
  padding-bottom: 6px;
}
.landing-root .phone-notch-bar {
  width: 60px; height: 4px;
  background: rgba(255,255,255,0.3);
  border-radius: 100px;
}
.landing-root .phone-screen { padding: 16px; }
.landing-root .phone-header {
  font-family: 'Unbounded', sans-serif;
  font-size: 12px; font-weight: 700;
  color: var(--ink); margin-bottom: 12px;
}
.landing-root .chat-bubble {
  border-radius: 14px 14px 14px 4px;
  padding: 10px 14px;
  font-size: 12px; line-height: 1.5;
  margin-bottom: 8px;
  max-width: 90%;
}
.landing-root .chat-in {
  background: var(--bg);
  border: 1px solid var(--border2);
  color: var(--ink);
}
.landing-root .chat-out {
  background: var(--l-accent);
  color: white;
  border-radius: 14px 14px 4px 14px;
  margin-left: auto;
}
.landing-root .chat-label { font-size: 10px; color: var(--muted2); margin-bottom: 3px; }

.landing-root .pricing-grid {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 24px; margin-top: 48px; max-width: 780px; margin-left: auto; margin-right: auto;
}
.landing-root .price-card {
  background: var(--white);
  border-radius: var(--l-radius);
  padding: 32px 28px;
  border: 1px solid var(--l-border);
  position: relative;
  text-align: left;
}
.landing-root .price-card.featured {
  border: 2px solid var(--l-accent);
  box-shadow: 0 0 0 6px rgba(10,186,181,0.06);
}
.landing-root .price-badge {
  position: absolute; top: -14px; left: 50%; transform: translateX(-50%);
  background: var(--l-accent); color: white;
  font-size: 12px; font-weight: 700;
  padding: 4px 16px; border-radius: 100px;
  white-space: nowrap;
}
.landing-root .price-plan { font-size: 13px; font-weight: 600; color: var(--l-muted); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.08em; }
.landing-root .price-amount {
  font-family: 'Unbounded', sans-serif;
  font-size: 42px; font-weight: 900;
  color: var(--ink); line-height: 1;
  margin-bottom: 4px;
}
.landing-root .price-period { font-size: 14px; color: var(--l-muted); margin-bottom: 24px; }
.landing-root .price-list { list-style: none; display: flex; flex-direction: column; gap: 12px; margin-bottom: 28px; }
.landing-root .price-list li {
  font-size: 14px; color: var(--ink);
  display: flex; align-items: flex-start; gap: 10px; line-height: 1.4;
}
.landing-root .check { color: var(--l-success); font-weight: 700; flex-shrink: 0; }
.landing-root .cross { color: var(--muted2); flex-shrink: 0; }
.landing-root .price-note { font-size: 12px; color: var(--muted2); text-align: center; margin-top: 12px; }

.landing-root .compare-wrap { margin-top: 48px; overflow-x: auto; }
.landing-root .compare-table {
  width: 100%; max-width: 700px; margin: 0 auto;
  border-collapse: collapse;
}
.landing-root .compare-table th {
  font-family: 'Unbounded', sans-serif;
  font-size: 13px; font-weight: 700;
  padding: 16px 20px;
  text-align: left; color: var(--l-muted);
}
.landing-root .compare-table th.ours { color: var(--l-accent); }
.landing-root .compare-table td {
  padding: 14px 20px; font-size: 14px; color: var(--ink);
  border-top: 1px solid var(--border2);
}
.landing-root .compare-table tr:hover td { background: var(--bg); }
.landing-root .yes { color: var(--l-success); font-weight: 600; }
.landing-root .no { color: var(--muted2); }

.landing-root .testi-grid {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 20px; margin-top: 48px;
}
.landing-root .testi-card {
  background: var(--white);
  border-radius: var(--l-radius);
  padding: 24px;
  border: 1px solid var(--border2);
}
.landing-root .testi-stars { color: #f59e0b; margin-bottom: 12px; font-size: 14px; }
.landing-root .testi-text { font-size: 14px; color: var(--ink); line-height: 1.7; margin-bottom: 16px; font-style: italic; }
.landing-root .testi-author { display: flex; align-items: center; gap: 10px; }
.landing-root .testi-avatar {
  width: 36px; height: 36px; border-radius: 50%;
  font-size: 14px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  background: var(--accent-light); color: var(--l-accent);
}
.landing-root .testi-name { font-size: 13px; font-weight: 600; color: var(--ink); }
.landing-root .testi-role { font-size: 12px; color: var(--l-muted); }

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
.landing-root .cta-inner { max-width: 680px; margin: 0 auto; position: relative; }
.landing-root .cta-section h2 { color: white; font-size: clamp(28px, 3.5vw, 44px); }
.landing-root .cta-section p { color: rgba(255,255,255,0.6); font-size: 17px; margin: 16px 0 36px; }
.landing-root .btn-white {
  background: white; color: var(--l-accent);
  font-family: 'Golos Text', sans-serif;
  font-weight: 700; font-size: 16px;
  padding: 16px 36px; border-radius: 100px;
  text-decoration: none; border: none; cursor: pointer;
  transition: all 0.2s; display: inline-block;
  box-shadow: 0 4px 20px rgba(0,0,0,0.2);
}
.landing-root .btn-white:hover { transform: translateY(-2px); box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
.landing-root .cta-footnote { color: rgba(255,255,255,0.35); font-size: 13px; margin-top: 16px; }

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

.landing-root .section-alt { background: var(--bg); }

.landing-root .fade-up {
  opacity: 0; transform: translateY(24px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}
.landing-root .fade-up.visible { opacity: 1; transform: translateY(0); }

@media (max-width: 900px) {
  .landing-root .hero { grid-template-columns: 1fr; gap: 40px; padding-top: 48px; }
  .landing-root .float-badge, .landing-root .float-badge2 { display: none; }
  .landing-root .pain-grid { grid-template-columns: 1fr 1fr; }
  .landing-root .features-grid { grid-template-columns: 1fr; }
  .landing-root .pricing-grid { grid-template-columns: 1fr; max-width: 400px; }
  .landing-root .testi-grid { grid-template-columns: 1fr; }
  .landing-root .nav-links { display: none; }
  .landing-root .compare-wrap { font-size: 13px; }
}
@media (max-width: 600px) {
  .landing-root nav { padding: 0 1rem; }
  .landing-root .nav-inner { height: 56px; gap: 8px; }
  .landing-root .logo { font-size: 15px; gap: 6px; }
  .landing-root .btn-nav { padding: 8px 14px; font-size: 13px; }
  .landing-root .pain-grid { grid-template-columns: 1fr; }
  .landing-root .stat-row { grid-template-columns: 1fr 1fr; }
  .landing-root .hero { padding: 32px 1rem 40px; }
  .landing-root .hero-cta { flex-direction: column; align-items: stretch; gap: 10px; }
  .landing-root .hero-cta .btn-primary,
  .landing-root .hero-cta .btn-ghost { width: 100%; justify-content: center; text-align: center; }
}
`;

export default function LandingPage() {
  const { t } = useTranslation();
  useEffect(() => {
    document.title = "oTutorHub — Порядок у репетиторстві";
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
  }, []);

  // CTAs lead to /auth with role pre-selected for tutor signup
  const signupHref = "/auth?signup=1&role=tutor";

  return (
    <div className="landing-root">
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
            <li><a href="#pricing">{t("landing.nav.pricing")}</a></li>
            <li><a href="#compare">{t("landing.nav.compare")}</a></li>
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
          <div>
            <div className="hero-badge">
              <span className="hero-badge-dot"></span>
              {t("landing.hero.badge")}
            </div>
            <h1>{t("landing.hero.titleLine1")}<br /><span className="accent">{t("landing.hero.titleLine2")}</span><br />{t("landing.hero.titleLine3")}</h1>
            <p className="hero-sub">{t("landing.hero.sub")}</p>
            <div className="hero-cta">
              <Link to={signupHref} className="btn-primary">{t("landing.hero.ctaPrimary")}</Link>
              <a href="#features" className="btn-ghost">{t("landing.hero.ctaSecondary")}</a>
            </div>
            <p className="hero-note">{t("landing.hero.note")}</p>
          </div>

          <div className="hero-visual">
            <div className="float-badge">
              <span className="badge-icon">🔔</span>{t("landing.hero.reminderBadge")}
            </div>
            <div className="app-frame">
              <div className="app-topbar">
                <div className="dot dot-r"></div>
                <div className="dot dot-y"></div>
                <div className="dot dot-g"></div>
              </div>
              <div className="app-content">
                <div className="app-title">{t("landing.hero.dashboard")}</div>
                <div className="stat-row">
                  <div className="stat-card-l">
                    <div className="stat-label-l">{t("landing.hero.students")}</div>
                    <div className="stat-val purple">12</div>
                  </div>
                  <div className="stat-card-l">
                    <div className="stat-label-l">{t("landing.hero.revenuePerMonth")}</div>
                    <div className="stat-val green">18 400 ₴</div>
                  </div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--l-muted)", marginBottom: 10 }}>
                  {t("landing.hero.upcomingLessons")}
                </div>
                <div className="lesson-item">
                  <div>
                    <div className="lesson-name">{t("landing.hero.lesson1")}</div>
                    <div className="lesson-sub">{t("landing.hero.lesson1Time")}</div>
                  </div>
                  <span className="pill pill-purple">{t("landing.hero.lesson1Status")}</span>
                </div>
                <div className="lesson-item">
                  <div>
                    <div className="lesson-name">{t("landing.hero.lesson2")}</div>
                    <div className="lesson-sub">{t("landing.hero.lesson2Time")}</div>
                  </div>
                  <span className="pill pill-warning">{t("landing.hero.lesson2Status")}</span>
                </div>
                <div className="lesson-item">
                  <div>
                    <div className="lesson-name">{t("landing.hero.lesson3")}</div>
                    <div className="lesson-sub">{t("landing.hero.lesson3Time")}</div>
                  </div>
                  <span className="pill pill-green">{t("landing.hero.lesson3Status")}</span>
                </div>
              </div>
            </div>
            <div className="float-badge2">
              <span className="badge-icon">✅</span>{t("landing.hero.paidBadge")}
            </div>
          </div>
        </div>
      </section>

      {/* SOCIAL STRIP */}
      <div className="social-strip">
        <div className="social-inner">
          <div className="social-stat">
            <span className="social-stat-num">∞</span>
            <span className="social-stat-label">{t("landing.social.students")}</span>
          </div>
          <div className="social-divider"></div>
          <div className="social-stat">
            <span className="social-stat-num">2 хв</span>
            <span className="social-stat-label">{t("landing.social.toStart")}</span>
          </div>
          <div className="social-divider"></div>
          <div className="social-stat">
            <span className="social-stat-num">14</span>
            <span className="social-stat-label">{t("landing.social.proFree")}</span>
          </div>
          <div className="social-divider"></div>
          <div className="social-stat">
            <span className="social-stat-num">Telegram</span>
            <span className="social-stat-label">{t("landing.social.telegramReminders")}</span>
          </div>
        </div>
        <div style={{ maxWidth: 1100, margin: "16px auto 0", textAlign: "center", color: "rgba(255,255,255,0.55)", fontSize: 13 }}>
          {t("landing.social.trustedBy")}
        </div>
      </div>

      {/* PAIN */}
      <section className="l-section section-alt" id="features">
        <div className="section-inner">
          <div className="section-label">{t("landing.pain.label")}</div>
          <h2>{t("landing.pain.title1")}<br />{t("landing.pain.title2")}</h2>
          <p className="section-sub">{t("landing.pain.sub")}</p>

          <div className="pain-grid fade-up">
            <div className="pain-card">
              <div className="pain-icon">📱</div>
              <div className="pain-title">{t("landing.pain.card1Title")}</div>
              <p className="pain-text">{t("landing.pain.card1Text")}</p>
            </div>
            <div className="pain-card">
              <div className="pain-icon">📅</div>
              <div className="pain-title">{t("landing.pain.card2Title")}</div>
              <p className="pain-text">{t("landing.pain.card2Text")}</p>
            </div>
            <div className="pain-card">
              <div className="pain-icon">💸</div>
              <div className="pain-title">{t("landing.pain.card3Title")}</div>
              <p className="pain-text">{t("landing.pain.card3Text")}</p>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="l-section features-bg">
        <div className="section-inner">
          <div className="section-label">{t("landing.features.label")}</div>
          <h2>{t("landing.features.title1")}<br />{t("landing.features.title2")}</h2>

          <div className="features-grid">
            <div className="feature-list fade-up">
              <div className="feature-item">
                <div className="feature-ico">📋</div>
                <div>
                  <div className="feature-title">{t("landing.features.f1Title")}</div>
                  <p className="feature-text">{t("landing.features.f1Text")}</p>
                </div>
              </div>
              <div className="feature-item">
                <div className="feature-ico">💰</div>
                <div>
                  <div className="feature-title">{t("landing.features.f2Title")}</div>
                  <p className="feature-text">{t("landing.features.f2Text")}</p>
                </div>
              </div>
              <div className="feature-item">
                <div className="feature-ico">💬</div>
                <div>
                  <div className="feature-title">{t("landing.features.f3Title")}</div>
                  <p className="feature-text">{t("landing.features.f3Text")}</p>
                </div>
              </div>
              <div className="feature-item">
                <div className="feature-ico">🔔</div>
                <div>
                  <div className="feature-title">
                    {t("landing.features.f4Title")}
                    <span className="feature-tag">{t("landing.features.proTag")}</span>
                  </div>
                  <p className="feature-text">{t("landing.features.f4Text")}</p>
                </div>
              </div>
              <div className="feature-item">
                <div className="feature-ico">📊</div>
                <div>
                  <div className="feature-title">
                    {t("landing.features.f5Title")}
                    <span className="feature-tag">{t("landing.features.proTag")}</span>
                  </div>
                  <p className="feature-text">{t("landing.features.f5Text")}</p>
                </div>
              </div>
            </div>

            <div className="phone-wrap fade-up">
              <div className="phone-frame">
                <div className="phone-notch"><div className="phone-notch-bar"></div></div>
                <div className="phone-screen">
                  <div className="phone-header">{t("landing.features.phoneHeader")}</div>

                  <div style={{ marginBottom: 6 }}>
                    <div className="chat-label">{t("landing.features.botName")}</div>
                    <div className="chat-bubble chat-in">
                      <strong>{t("landing.features.botMsgTitle")}</strong><br />
                      {t("landing.features.botMsg")}
                    </div>
                  </div>

                  <div style={{ margin: "12px 0 6px", borderTop: "1px solid var(--border2)", paddingTop: 12 }}>
                    <div className="chat-label">{t("landing.features.chatStudent")}</div>
                    <div className="chat-bubble chat-in">{t("landing.features.chatIn")}</div>
                    <div className="chat-bubble chat-out">{t("landing.features.chatOut")}</div>
                  </div>

                  <div style={{ margin: "12px 0 6px", borderTop: "1px solid var(--border2)", paddingTop: 12 }}>
                    <div className="chat-label" style={{ color: "var(--l-success)" }}>{t("landing.features.chatPaidLabel")}</div>
                    <div
                      className="chat-bubble"
                      style={{
                        background: "var(--success-light)",
                        border: "1px solid rgba(26,158,117,0.15)",
                        color: "var(--l-success)",
                        fontSize: 12,
                        borderRadius: 10,
                        padding: "8px 12px",
                      }}
                    >
                      {t("landing.features.chatPaidText")}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* COMPARE */}
      <section className="l-section section-alt" id="compare">
        <div className="section-inner">
          <div className="section-label">{t("landing.compare.label")}</div>
          <h2>{t("landing.compare.title1")}<br />{t("landing.compare.title2")}</h2>
          <p className="section-sub">{t("landing.compare.sub")}</p>

          <div className="compare-wrap fade-up">
            <table className="compare-table">
              <thead>
                <tr>
                  <th style={{ width: "40%" }}>{t("landing.compare.colFeature")}</th>
                  <th className="ours">oTutorHub</th>
                  <th>{t("landing.compare.colCompetitors")}</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>{t("landing.compare.r1")}</td><td className="yes">{t("landing.compare.r1Ours")}</td><td className="no">{t("landing.compare.r1Them")}</td></tr>
                <tr><td>{t("landing.compare.r2")}</td><td className="yes">{t("landing.compare.r2Ours")}</td><td className="no">{t("landing.compare.r2Them")}</td></tr>
                <tr><td>{t("landing.compare.r3")}</td><td className="yes">{t("landing.compare.r3Ours")}</td><td className="no">{t("landing.compare.r3Them")}</td></tr>
                <tr><td>{t("landing.compare.r4")}</td><td className="yes">{t("landing.compare.r4Ours")}</td><td className="no">{t("landing.compare.r4Them")}</td></tr>
                <tr><td>{t("landing.compare.r5")}</td><td className="yes">{t("landing.compare.r5Ours")}</td><td className="no">{t("landing.compare.r5Them")}</td></tr>
                <tr><td>{t("landing.compare.r6")}</td><td className="yes">{t("landing.compare.r6Ours")}</td><td className="no">{t("landing.compare.r6Them")}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="l-section features-bg" id="pricing">
        <div className="section-inner" style={{ textAlign: "center" }}>
          <div className="section-label">{t("landing.pricing.label")}</div>
          <h2>{t("landing.pricing.title")}</h2>
          <p className="section-sub" style={{ margin: "0 auto" }}>{t("landing.pricing.sub")}</p>

          <div className="pricing-grid fade-up">
            {/* FREE */}
            <div className="price-card">
              <div className="price-plan">{t("landing.pricing.freePlan")}</div>
              <div className="price-amount">{t("landing.pricing.freePrice")}</div>
              <div className="price-period">{t("landing.pricing.freePeriod")}</div>
              <ul className="price-list">
                <li><span className="check">✓</span> {t("landing.pricing.free1")}</li>
                <li><span className="check">✓</span> {t("landing.pricing.free2")}</li>
                <li><span className="check">✓</span> {t("landing.pricing.free3")}</li>
                <li><span className="check">✓</span> {t("landing.pricing.free4")}</li>
                <li><span className="check">✓</span> {t("landing.pricing.free5")}</li>
                <li><span className="cross">–</span> {t("landing.pricing.free6")}</li>
                <li><span className="cross">–</span> {t("landing.pricing.free7")}</li>
              </ul>
              <Link to={signupHref} className="btn-ghost" style={{ width: "100%", textAlign: "center" }}>
                {t("landing.pricing.freeCta")}
              </Link>
            </div>

            {/* PRO */}
            <div className="price-card featured">
              <div className="price-badge">{t("landing.pricing.proBadge")}</div>
              <div className="price-plan">{t("landing.pricing.proPlan")}</div>
              <div className="price-amount">{t("landing.pricing.proPrice")}</div>
              <div className="price-period">{t("landing.pricing.proPeriod")}</div>
              <ul className="price-list">
                <li><span className="check">✓</span> {t("landing.pricing.pro1")}</li>
                <li><span className="check">✓</span> {t("landing.pricing.pro2")}</li>
                <li><span className="check">✓</span> {t("landing.pricing.pro3")}</li>
                <li><span className="check">✓</span> {t("landing.pricing.pro4")}</li>
                <li><span className="check">✓</span> {t("landing.pricing.pro5")}</li>
                <li><span className="check">✓</span> {t("landing.pricing.pro6")}</li>
                <li><span className="check">✓</span> {t("landing.pricing.pro7")}</li>
              </ul>
              <Link to={signupHref} className="btn-primary" style={{ width: "100%", textAlign: "center", boxSizing: "border-box" }}>
                {t("landing.pricing.proCta")}
              </Link>
              <p className="price-note">{t("landing.pricing.proNote")}</p>
            </div>
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="l-section section-alt">
        <div className="section-inner">
          <div className="section-label">{t("landing.testimonials.label")}</div>
          <h2>{t("landing.testimonials.title")}</h2>

          <div className="testi-grid fade-up">
            <div className="testi-card">
              <div className="testi-stars">★★★★★</div>
              <p className="testi-text">{t("landing.testimonials.t1Text")}</p>
              <div className="testi-author">
                <div className="testi-avatar">ОМ</div>
                <div>
                  <div className="testi-name">{t("landing.testimonials.t1Name")}</div>
                  <div className="testi-role">{t("landing.testimonials.t1Role")}</div>
                </div>
              </div>
            </div>
            <div className="testi-card">
              <div className="testi-stars">★★★★★</div>
              <p className="testi-text">{t("landing.testimonials.t2Text")}</p>
              <div className="testi-author">
                <div className="testi-avatar">ВД</div>
                <div>
                  <div className="testi-name">{t("landing.testimonials.t2Name")}</div>
                  <div className="testi-role">{t("landing.testimonials.t2Role")}</div>
                </div>
              </div>
            </div>
            <div className="testi-card">
              <div className="testi-stars">★★★★★</div>
              <p className="testi-text">{t("landing.testimonials.t3Text")}</p>
              <div className="testi-author">
                <div className="testi-avatar">ІК</div>
                <div>
                  <div className="testi-name">{t("landing.testimonials.t3Name")}</div>
                  <div className="testi-role">{t("landing.testimonials.t3Role")}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="cta-section">
        <div className="cta-inner">
          <h2>{t("landing.finalCta.title")}</h2>
          <p>{t("landing.finalCta.sub")}</p>
          <Link to={signupHref} className="btn-white">{t("landing.finalCta.cta")}</Link>
          <p className="cta-footnote">{t("landing.finalCta.footnote")}</p>
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
    </div>
  );
}
