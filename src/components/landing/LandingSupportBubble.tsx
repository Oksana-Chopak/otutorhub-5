import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageCircle, X, Send } from "lucide-react";
import { LandingContactDialog } from "@/components/landing/LandingContactDialog";
import { supportTelegramUrl } from "@/lib/support";

/**
 * Вікно швидкого звʼязку для НЕзареєстрованих (15.09, рішення власниці).
 *
 * Скарга живого користувача була про підтримку всередині застосунку, але та
 * сама дірка є й зовні: на лендінгу контакт лежав ЛИШЕ рядком у футері —
 * тобто людина, у якої виникло питання до реєстрації, мусила догорнути до
 * самого низу й помітити його серед інших посилань. Питання без відповіді
 * на цьому етапі = людина, яка просто пішла.
 *
 * Тому: бульбашка внизу праворуч, яка їде разом зі сторінкою. Перший показ —
 * із підписом (щоб її помітили), далі згортається в кружечок.
 *
 * 27.09, живе спостереження власниці («по-моєму вікно чату звідти зникло»):
 * закриття запамʼятовувалось у sessionStorage, тобто до кінця сесії браузера —
 * на практиці «назавжди», бо вкладку не закривають тижнями. Один випадковий
 * дотик по хрестику — і підтримки на лендінгу більше не існує. Тепер памʼять
 * НА ДОБУ (localStorage із міткою часу): не набридаємо, але й не зникаємо.
 *
 * Друга частина того самого рішення: поруч із Telegram зʼявилась форма звʼязку
 * (`LandingContactDialog`) — для тих, хто Telegram не має. Вона пише в ту саму
 * скриньку звернень, з якої власниця вже вміє відповідати.
 *
 * Не перекриває банер кук: відступ рахується з тієї самої змінної
 * --cookie-banner-h, що й FAB у застосунку.
 */
const DISMISS_KEY = "otutorhub_support_bubble_until";
const DISMISS_MS = 24 * 60 * 60 * 1000;

export function LandingSupportBubble() {
  const { t } = useTranslation();
  const url = supportTelegramUrl();
  const [hidden, setHidden] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    let until = 0;
    try { until = Number(localStorage.getItem(DISMISS_KEY) ?? 0); } catch { /* приватний режим */ }
    if (until > Date.now()) return;
    // Показуємо не миттєво: спершу людина має побачити сам лендінг.
    const show = window.setTimeout(() => setHidden(false), 2500);
    const shrink = window.setTimeout(() => setExpanded(false), 9000);
    return () => { window.clearTimeout(show); window.clearTimeout(shrink); };
  }, []);

  // 15.09: бульбашка висіла ПОВЕРХ відкритої анкети підбору (z-index 60 проти
  // 50 у діалога) — робот зняв її просто на тексті «Ми отримали ваш запит».
  // Радікс до того ж ставить сусідам aria-hidden, тож виходило найгірше
  // поєднання: на екрані видно, для читалки не існує. Тому z-index тепер НИЖЧЕ
  // шару діалогів (підстраховка), а поки модалка відкрита — бульбашки нема
  // взагалі: питання до підтримки ставлять не посеред заповнення форми.
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const check = () => setModalOpen(!!document.querySelector('[role="dialog"][data-state="open"]'));
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state"] });
    return () => mo.disconnect();
  }, []);

  // Форма звʼязку є навіть без Telegram — тому умова більше не вимагає `url`.
  if (hidden || (modalOpen && !formOpen)) return null;

  const dismiss = () => {
    setHidden(true);
    try { localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_MS)); } catch { /* ігноруємо */ }
  };

  return (
    <div
      style={{
        position: "fixed", right: 16, zIndex: 40,
        bottom: "calc(16px + var(--cookie-banner-h, 0px))",
        display: "flex", alignItems: "center", gap: 8,
      }}
    >
      <button
        type="button"
        onClick={() => setFormOpen(true)}
        aria-label={t("landingContact.title")}
        title={t("landingContact.title")}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          height: 52, width: 52, borderRadius: 999, border: "none", cursor: "pointer",
          background: "var(--ds-surface,#fff)", color: "var(--l-accent-text, #0a7d79)",
          boxShadow: "0 10px 26px -10px rgba(15,15,26,.35)",
        }}
      >
        <Send size={20} strokeWidth={2.2} />
      </button>
      {url && (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("landing.support.aria")}
        style={{
          display: "inline-flex", alignItems: "center", gap: 9,
          height: 52, padding: expanded ? "0 18px 0 16px" : 0, width: expanded ? "auto" : 52,
          justifyContent: "center", borderRadius: 999, textDecoration: "none",
          /* Контраст: --l-accent (#0ABAB5) — це ЗАЛИВКА бренду; білий напис на
             ній дає 2.06:1. Для білого тексту в лендінговій палітрі існує
             окремий, темніший --l-accent-btn (#0a7d79) — саме він і є тлом
             кнопки. Це та сама пастка «колір бренду ≠ колір тексту», через яку
             лендінг уже лікували 11.09. */
          background: "var(--l-accent-btn, #0a7d79)", color: "#ffffff",
          fontFamily: "'Golos Text', Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15,
          boxShadow: "0 10px 26px -10px rgba(15,15,26,.45)",
          transition: "width .25s ease, padding .25s ease",
        }}
      >
        <MessageCircle size={22} strokeWidth={2.2} />
        {expanded && <span style={{ whiteSpace: "nowrap" }}>{t("landing.support.label")}</span>}
      </a>
      )}
      {expanded && (
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("landing.support.close")}
          style={{
            width: 44, height: 44, borderRadius: 999, border: "none", cursor: "pointer",
            background: "rgba(15,15,26,.06)", color: "var(--l-muted2, #5b6070)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <X size={18} />
        </button>
      )}
      <LandingContactDialog open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}

export default LandingSupportBubble;
