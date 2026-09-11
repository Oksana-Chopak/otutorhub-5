import { useTranslation } from "react-i18next";
import type { PersonaVars } from "@/pages/LandingPage";
import { formatPrice } from "@/lib/currency";
import { IMPORT_CURRENCY } from "@/lib/importStudents";

/**
 * «Один день з помічником» (10.09) — замість сітки з десяти іконок.
 *
 * Список функцій виглядає так у кожного SaaS, і саме тому його не
 * пересилають. Пересилають «дивись, як воно живе»: пʼять кадрів одного дня —
 * дайджест о 07:30, нагадування учневі о 15:45, Zoom в один клік, AI-конспект
 * після зустрічі й «оплатила ✓» о 17:10. Ті самі функції, але як історія,
 * а не прайс-лист. Решта можливостей — одним рядком чипів нижче, для тих,
 * хто сканує.
 *
 * Кадри — справжні міні-екрани продукту (бульбашка Telegram, картка уроку,
 * конспект, оплата), а не абстрактні іконки. На мобілці — горизонтальна
 * стрічка зі snap, як сторіз; на десктопі — та сама стрічка, ширша.
 */
export function LandingDayStory({ personaVars, personaId }: { personaVars: PersonaVars; personaId: string }) {
  const { t } = useTranslation();
  // Суми в кадрах — через той самий formatPrice, що й у застосунку (валюта
  // імпорту v1 — гривня), а не літералом у тексті.
  const amount = formatPrice(1200, IMPORT_CURRENCY);
  const tp = (key: string) => t(key, { ...personaVars, amount });

  const frames = [
    {
      time: "07:30",
      caption: tp("landingDay.f1Caption"),
      screen: (
        <div className="ld-tg">
          <div className="ld-tg-head"><span className="ld-tg-avatar" aria-hidden="true">☀️</span> oTutorHub</div>
          <div className="ld-tg-bubble">
            <div>{tp("landingDay.f1Line1")}</div>
            <div className="ld-tg-muted">{tp("landingDay.f1Line2")}</div>
            <div className="ld-tg-muted">{tp("landingDay.f1Line3")}</div>
          </div>
        </div>
      ),
    },
    {
      time: "15:45",
      caption: tp("landingDay.f2Caption"),
      screen: (
        <div className="ld-notif">
          <div className="ld-notif-app">🔔 oTutorHub</div>
          <div className="ld-notif-title">{tp("landingDay.f2Title")}</div>
          <div className="ld-notif-text">{tp("landingDay.f2Text")}</div>
        </div>
      ),
    },
    {
      time: "16:00",
      caption: tp("landingDay.f3Caption"),
      screen: (
        <div className="ld-lesson">
          <div className="ld-lesson-top">
            <span className="ld-lesson-name">{tp("landingDay.f3Name")}</span>
            <span className="ld-lesson-time">16:00–17:00</span>
          </div>
          <div className="ld-lesson-sub">{tp("landingDay.f3Sub")}</div>
          <div className="ld-lesson-btn">🎥 {tp("landingDay.f3Btn")}</div>
        </div>
      ),
    },
    {
      time: "17:05",
      caption: tp("landingDay.f4Caption"),
      screen: (
        <div className="ld-notes">
          <div className="ld-notes-head">📝 {tp("landingDay.f4Head")}</div>
          <ul>
            <li>{tp("landingDay.f4L1")}</li>
            <li>{tp("landingDay.f4L2")}</li>
            <li>{tp("landingDay.f4L3")}</li>
          </ul>
        </div>
      ),
    },
    {
      time: "17:10",
      caption: tp("landingDay.f5Caption"),
      screen: (
        <div className="ld-paid">
          <div className="ld-paid-check" aria-hidden="true">✓</div>
          <div>
            <div className="ld-paid-title">{tp("landingDay.f5Title")}</div>
            <div className="ld-paid-sub">{tp("landingDay.f5Sub")}</div>
          </div>
        </div>
      ),
    },
  ];

  const chips = [
    { emoji: "💬", text: tp("landingDay.chipChat") },
    { emoji: "👥", text: tp("landingDay.chipGroups") },
    { emoji: "🗓️", text: tp("landingDay.chipCalendar") },
    { emoji: "💸", text: tp("landingDay.chipCancel") },
    { emoji: "♾️", text: tp("landingDay.chipUnlimited") },
  ];

  return (
    <section className="l-section features-bg" id="features">
      <style>{styles}</style>
      <div className="section-inner">
        <div className="section-label">{t("landingDay.label")}</div>
        <h2>{tp("landingDay.title")}</h2>
        <p className="section-sub">{tp("landingDay.sub")}</p>

        <ol className="ld-strip" aria-label={t("landingDay.stripLabel")}>
          {frames.map((f, i) => (
            <li key={`${personaId}-${i}`} className="ld-frame">
              <div className="ld-time"><span className="ld-dot" aria-hidden="true" />{f.time}</div>
              <div className="ld-screen">{f.screen}</div>
              <p className="ld-caption">{f.caption}</p>
            </li>
          ))}
        </ol>

        <div className="ld-chips" aria-label={t("landingDay.chipsLabel")}>
          <span className="ld-chips-label">{t("landingDay.chipsLabel")}</span>
          {chips.map((c, i) => (
            <span key={i} className="ld-chip"><span aria-hidden="true">{c.emoji}</span> {c.text}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

const styles = `
.ld-strip { list-style:none; margin:28px 0 0; padding:4px 2px 12px; display:flex; gap:16px; overflow-x:auto;
  scroll-snap-type:x mandatory; -webkit-overflow-scrolling:touch; scrollbar-width:thin; }
.ld-frame { flex:0 0 272px; scroll-snap-align:start; display:flex; flex-direction:column; }
@media (min-width: 1100px) { .ld-frame { flex-basis: calc((100% - 64px) / 5); } }
.ld-time { display:flex; align-items:center; gap:8px; font-weight:800; font-size:15px; letter-spacing:.02em; color:var(--txt,#0f0f1a); font-variant-numeric:tabular-nums; }
.ld-dot { width:10px; height:10px; border-radius:50%; background:var(--teal,#2BBFAA); box-shadow:0 0 0 4px rgba(43,191,170,.18); }
.ld-screen { margin-top:10px; min-height:168px; border-radius:18px; background:var(--surface,#fff); border:0.5px solid var(--border,#e6e8ef);
  box-shadow:0 12px 30px -22px rgba(15,15,26,.5); padding:14px; font-size:14px; line-height:1.45; color:var(--txt,#0f0f1a); }
.ld-caption { margin:10px 2px 0; font-size:14px; color:var(--l-muted,#666b82); line-height:1.45; }

.ld-tg-head { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:700; color:var(--l-muted,#666b82); margin-bottom:6px; }
.ld-tg-avatar { width:20px; height:20px; border-radius:50%; background:linear-gradient(135deg,#ffd166,#f4a261); display:inline-flex; align-items:center; justify-content:center; font-size:13px; }
.ld-tg-bubble { border-radius:14px 14px 14px 4px; padding:10px 12px; color:#fff; background:linear-gradient(135deg,#0f0f1a,#1a1f3a); display:grid; gap:4px; }
.ld-tg-muted { color:rgba(255,255,255,.78); }

.ld-notif { border-radius:14px; background:#f6f7fb; padding:10px 12px; }
.ld-notif-app { font-size:13px; font-weight:700; color:var(--l-muted,#666b82); }
.ld-notif-title { font-weight:700; margin-top:4px; }
.ld-notif-text { color:var(--l-muted,#666b82); margin-top:2px; }

.ld-lesson-top { display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
.ld-lesson-name { font-weight:800; }
.ld-lesson-time { font-size:13px; color:var(--l-muted,#666b82); font-variant-numeric:tabular-nums; }
.ld-lesson-sub { color:var(--l-muted,#666b82); margin-top:2px; }
.ld-lesson-btn { margin-top:12px; border-radius:12px; padding:10px 12px; text-align:center; font-weight:700; color:#fff; background:var(--teal,#2BBFAA); }

.ld-notes-head { font-weight:700; margin-bottom:6px; }
.ld-notes ul { margin:0; padding-left:18px; display:grid; gap:4px; color:var(--l-muted,#666b82); }

.ld-paid { display:flex; align-items:center; gap:12px; height:100%; }
.ld-paid-check { width:44px; height:44px; border-radius:50%; background:#e9f9f4; color:#0e9f6e; font-weight:900; font-size:22px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.ld-paid-title { font-weight:800; }
.ld-paid-sub { color:var(--l-muted,#666b82); margin-top:2px; }

.ld-chips { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:18px; }
.ld-chips-label { font-size:13px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--l-muted,#666b82); margin-right:4px; }
.ld-chip { display:inline-flex; align-items:center; gap:6px; border-radius:999px; padding:8px 12px; font-size:14px; font-weight:600;
  background:#eef0f6; border:0.5px solid var(--border,#e6e8ef); color:var(--txt,#0f0f1a); }
`;
