import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { isNativeApp } from "@/lib/platform";
import { isSafeInternalPath } from "@/lib/safePath";

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
          const path = u.pathname + u.search + u.hash;
          if (isSafeInternalPath(path)) navigate(path);
        } catch { /* сторонній url — ігноруємо */ }
      });
      // 40b: тап по нативному пушу веде туди ж, куди й лінк у сповіщенні.
      let pushSub: { remove: () => Promise<void> } | undefined;
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        pushSub = await PushNotifications.addListener("pushNotificationActionPerformed", (act) => {
          const target = (act.notification?.data as { link?: string } | undefined)?.link;
          if (isSafeInternalPath(target)) navigate(target);
        });
      } catch { /* плагін недоступний */ }
      remove = () => { void sub.remove(); void pushSub?.remove(); };
    })();
    return () => remove?.();
  }, [navigate]);
  return null;
}
