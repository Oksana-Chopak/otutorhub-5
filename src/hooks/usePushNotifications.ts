import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { VAPID_PUBLIC_KEY, urlBase64ToUint8Array } from "@/lib/pushConfig";

type PermissionState = "default" | "granted" | "denied";

const db = supabase as unknown as typeof supabase & {
  from(table: "push_subscriptions"): ReturnType<typeof supabase.from>;
};

export function usePushNotifications() {
  const { user } = useAuth();
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<PermissionState>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  const swReg = useCallback(async (): Promise<ServiceWorkerRegistration | null> => {
    if (!("serviceWorker" in navigator)) return null;
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      return reg;
    } catch {
      return null;
    }
  }, []);

  // Check initial state
  useEffect(() => {
    const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(ok);
    if (ok) setPermission(Notification.permission as PermissionState);
  }, []);

  // Check if already subscribed in DB
  useEffect(() => {
    if (!user || !supported) return;
    (async () => {
      const reg = await swReg();
      if (!reg) return;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) { setSubscribed(false); return; }
      const { data } = await db
        .from("push_subscriptions")
        .select("id")
        .eq("user_id", user.id)
        .eq("endpoint", sub.endpoint)
        .maybeSingle();
      setSubscribed(!!data);
    })();
  }, [user?.id, supported]);

  const subscribe = useCallback(async () => {
    if (!user || !supported) return;
    setLoading(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm as PermissionState);
      if (perm !== "granted") { setLoading(false); return; }

      const reg = await swReg();
      if (!reg) { setLoading(false); return; }

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      const json = sub.toJSON();
      const p256dh = json.keys?.p256dh ?? "";
      const auth = json.keys?.auth ?? "";
      if (!p256dh || !auth) {
        // Browser returned invalid subscription — abort silently
        setLoading(false);
        return;
      }
      await db.from("push_subscriptions").upsert(
        { user_id: user.id, endpoint: sub.endpoint, p256dh, auth },
        { onConflict: "user_id,endpoint" }
      );
      setSubscribed(true);
    } catch {
      /* permission denied or other error */
    }
    setLoading(false);
  }, [user?.id, supported, swReg]);

  const unsubscribe = useCallback(async () => {
    if (!user || !supported) return;
    setLoading(true);
    try {
      const reg = await swReg();
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await db.from("push_subscriptions").delete().eq("user_id", user.id).eq("endpoint", sub.endpoint);
          await sub.unsubscribe();
        }
      }
      setSubscribed(false);
    } catch { /* ignore */ }
    setLoading(false);
  }, [user?.id, supported, swReg]);

  return { supported, permission, subscribed, loading, subscribe, unsubscribe };
}
