import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { VAPID_PUBLIC_KEY, urlBase64ToUint8Array } from "@/lib/pushConfig";
import { isNativeApp } from "@/lib/platform";

type PermissionState = "default" | "granted" | "denied";

const db = supabase as any;

/** Ключ локального кешу токена пристрою — щоб знати, чи вже підписані. */
const NATIVE_TOKEN_KEY = "native_push_token";

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

  const native = isNativeApp();

  // Check initial state
  useEffect(() => {
    // 40b: у наативі web-push (SW+VAPID) не працює — там FCM через плагін,
    // тож підтримка є ЗАВЖДИ, просто іншим транспортом.
    if (native) {
      setSupported(true);
      void (async () => {
        try {
          const { PushNotifications } = await import("@capacitor/push-notifications");
          const perm = await PushNotifications.checkPermissions();
          setPermission(perm.receive === "granted" ? "granted" : perm.receive === "denied" ? "denied" : "default");
          setSubscribed(perm.receive === "granted" && !!localStorage.getItem(NATIVE_TOKEN_KEY));
        } catch { /* плагін недоступний — лишаємось у default */ }
      })();
      return;
    }
    const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(ok);
    if (ok) setPermission(Notification.permission as PermissionState);
  }, [native]);

  // 40b: слухач видачі токена — пише його в device_push_tokens (RLS own-only).
  useEffect(() => {
    if (!native || !user) return;
    let remove: (() => void) | undefined;
    void (async () => {
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        const sub = await PushNotifications.addListener("registration", (tk) => {
          localStorage.setItem(NATIVE_TOKEN_KEY, tk.value);
          void db.from("device_push_tokens")
            .upsert({ token: tk.value, user_id: user.id, platform: "android" }, { onConflict: "token" })
            .then(() => setSubscribed(true));
        });
        const errSub = await PushNotifications.addListener("registrationError", () => setSubscribed(false));
        remove = () => { void sub.remove(); void errSub.remove(); };
      } catch { /* ignore */ }
    })();
    return () => remove?.();
  }, [native, user?.id]);

  // Check if already subscribed in DB
  useEffect(() => {
    if (!user || !supported || native) return;
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
  }, [user?.id, supported, native, swReg]);

  const subscribe = useCallback(async () => {
    if (!user || !supported) return;
    if (native) {
      setLoading(true);
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        let perm = await PushNotifications.checkPermissions();
        if (perm.receive !== "granted") perm = await PushNotifications.requestPermissions();
        setPermission(perm.receive === "granted" ? "granted" : perm.receive === "denied" ? "denied" : "default");
        // register() віддає токен у слухач 'registration' вище — там і зберігаємо.
        if (perm.receive === "granted") await PushNotifications.register();
      } catch { /* ignore */ }
      setLoading(false);
      return;
    }
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
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
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
  }, [user?.id, supported, swReg, native]);

  const unsubscribe = useCallback(async () => {
    if (!user || !supported) return;
    if (native) {
      setLoading(true);
      try {
        const tk = localStorage.getItem(NATIVE_TOKEN_KEY);
        if (tk) await db.from("device_push_tokens").delete().eq("token", tk);
        localStorage.removeItem(NATIVE_TOKEN_KEY);
        setSubscribed(false);
      } catch { /* ignore */ }
      setLoading(false);
      return;
    }
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
  }, [user?.id, supported, swReg, native]);

  return { supported, permission, subscribed, loading, subscribe, unsubscribe };
}
