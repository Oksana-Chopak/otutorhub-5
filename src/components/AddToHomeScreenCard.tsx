import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { isNativeApp } from "@/lib/platform";
import { logEvent } from "@/lib/analytics";

/**
 * iPhone: «Додай на головний екран» (13.10, пре-мортем: iOS-застосунку в App Store
 * немає — Apple блокує Account Holder, — а половина репетиторів на iPhone).
 * Safari не дає програмного «Встановити» (жодного beforeinstallprompt), тож
 * єдиний чесний шлях — показати, де лежить «Поділитися → На Початковий екран»,
 * і зникнути назавжди після дотику ✕ або щойно застосунок уже відкрито з екрана.
 *
 * Показуємо лише: iPhone/iPad · Safari у браузері (не standalone) · не нативна
 * збірка · не закрито раніше. Android має застосунок у Play — тут не шумимо.
 */
const KEY = "ot_a2hs_dismissed";

export function shouldOfferHomeScreen(env: {
  ua: string;
  standalone: boolean;
  native: boolean;
  dismissed: boolean;
}): boolean {
  if (env.native || env.standalone || env.dismissed) return false;
  const ios = /iPhone|iPad|iPod/i.test(env.ua) || (/Macintosh/i.test(env.ua) && /Mobile/i.test(env.ua));
  if (!ios) return false;
  // Chrome/Firefox на iOS теж уміють, але підказка «Поділитися» там інша — не вводимо в оману.
  const safari = /Safari/i.test(env.ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(env.ua);
  return safari;
}

function readEnv() {
  let dismissed = false;
  try { dismissed = localStorage.getItem(KEY) === "1"; } catch { /* приватний режим */ }
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone = nav.standalone === true || (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches);
  return { ua: navigator.userAgent, standalone, native: isNativeApp(), dismissed };
}

export function AddToHomeScreenCard() {
  const { t } = useTranslation();
  const [show, setShow] = useState(() => shouldOfferHomeScreen(readEnv()));
  if (!show) return null;
  const dismiss = () => {
    try { localStorage.setItem(KEY, "1"); } catch { /* приватний режим */ }
    logEvent("a2hs_dismissed");
    setShow(false);
  };
  return (
    <div data-testid="a2hs-card" className="rounded-[16px] border-[0.5px] border-border bg-card text-foreground" style={{ padding: "12px 14px", display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 14 }}>
      <div aria-hidden style={{ fontSize: 26, lineHeight: 1 }}>📲</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 15 }}>{t("a2hs.title")}</div>
        <div className="text-muted-foreground" style={{ fontSize: 14, lineHeight: 1.45, marginTop: 3 }}>{t("a2hs.steps")}</div>
      </div>
      <button type="button" onClick={dismiss} aria-label={t("common.close")}
        className="bg-secondary text-muted-foreground" style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <X size={18} />
      </button>
    </div>
  );
}
