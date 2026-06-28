import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getConsent, setConsent, type Consent } from "@/lib/clarity";

/**
 * Analytics-cookie consent banner. Shown until the user makes a choice; only
 * after "Accept" is Microsoft Clarity loaded (see src/lib/clarity.ts). Most
 * privacy-preserving default: nothing non-essential loads until opt-in.
 */
export function CookieConsent() {
  const { t } = useTranslation();
  const [decided, setDecided] = useState(() => getConsent() !== null);
  if (decided) return null;

  const choose = (v: Consent) => {
    setConsent(v);
    setDecided(true);
  };

  return (
    <div
      role="dialog"
      aria-label={t("cookieConsent.title")}
      style={{
        position: "fixed",
        left: 12,
        right: "auto",
        bottom: 12,
        zIndex: 60,
        width: "min(380px, calc(100vw - 24px))",
        background: "#0f0f1a",
        color: "#fff",
        borderRadius: 16,
        padding: "16px 18px",
        boxShadow: "0 12px 32px -8px rgba(0,0,0,.5)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: "#d7d9e6" }}>
        {t("cookieConsent.text")}{" "}
        <Link to="/privacy" style={{ color: "#2BBFAA", textDecoration: "underline" }}>
          {t("cookieConsent.learnMore")}
        </Link>
      </p>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => choose("declined")}
          style={{
            height: 44,
            padding: "0 18px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,.18)",
            background: "transparent",
            color: "#fff",
            fontWeight: 600,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          {t("cookieConsent.decline")}
        </button>
        <button
          type="button"
          onClick={() => choose("accepted")}
          style={{
            height: 44,
            padding: "0 22px",
            borderRadius: 12,
            border: "none",
            background: "#2BBFAA",
            color: "#0f0f1a",
            fontWeight: 700,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          {t("cookieConsent.accept")}
        </button>
      </div>
    </div>
  );
}
