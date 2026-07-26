// Microsoft Clarity loads ONLY after the user grants analytics consent
// (GDPR/ePrivacy: session recording + _clck/_clsk cookies are non-essential).
// The tag used to live unconditionally in index.html <head>; it now loads here
// after an explicit opt-in stored in localStorage.

const CONSENT_KEY = "oth-cookie-consent-v1";

const CLARITY_ID = "wpk45tlt0l";

export type Consent = "accepted" | "declined";

export function getConsent(): Consent | null {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "accepted" || v === "declined" ? v : null;
  } catch {
    return null;
  }
}

let loaded = false;
export function loadClarity(): void {
  if (loaded || typeof window === "undefined" || typeof document === "undefined") return;
  // 2026-07-25, product decision by Oksana: analytics run in native apps too,
  // same consent flow as web. Declared in App Privacy / Data Safety forms.
  if (getConsent() !== "accepted") return;
  loaded = true;
  (function (c: any, l: Document, a: string, r: string, i: string) {
    c[a] = c[a] || function () {
      (c[a].q = c[a].q || []).push(arguments);
    };
    const t = l.createElement(r) as HTMLScriptElement;
    t.async = true;
    t.src = "https://www.clarity.ms/tag/" + i;
    const y = l.getElementsByTagName(r)[0];
    y.parentNode?.insertBefore(t, y);
  })(window, document, "clarity", "script", CLARITY_ID);
}

export function setConsent(v: Consent): void {
  try {
    localStorage.setItem(CONSENT_KEY, v);
  } catch {
    /* ignore */
  }
  if (v === "accepted") loadClarity();
}

// On app start, load Clarity only if the user previously accepted.
if (typeof window !== "undefined" && getConsent() === "accepted") loadClarity();
