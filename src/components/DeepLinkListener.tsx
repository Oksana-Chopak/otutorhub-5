import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { isNativeApp } from "@/lib/platform";

/**
 * Deep links (40a): https://otutorhub.com/join/XXX, /auth?confirmed=1 тощо
 * відкриваються всередині застосунку, а не в браузері поверх нього.
 */
export function DeepLinkListener() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!isNativeApp()) return;
    let remove: (() => void) | undefined;
    void (async () => {
      const { App } = await import("@capacitor/app");
      const sub = await App.addListener("appUrlOpen", ({ url }) => {
        try {
          const u = new URL(url);
          navigate(u.pathname + u.search + u.hash);
        } catch { /* сторонній url — ігноруємо */ }
      });
      remove = () => { void sub.remove(); };
    })();
    return () => remove?.();
  }, [navigate]);
  return null;
}
