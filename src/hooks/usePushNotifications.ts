import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { VAPID_PUBLIC_KEY, urlBase64ToUint8Array, subscriptionKeyMatches } from "@/lib/pushConfig";
import { isNativeApp } from "@/lib/platform";

type PermissionState = "default" | "granted" | "denied";

const db = supabase as any;

/** Ключ локального кешу токена пристрою — щоб знати, чи вже підписані. */
const NATIVE_TOKEN_KEY = "native_push_token";

type HealResult = "none" | "ok" | "healed" | "off";
let healInFlight: Promise<HealResult> | null = null;

/**
 * 22.09 (скан Lovable «пуші тихо вимикаються»): send-push більше НЕ видаляє
 * підписку на 401/403 — це може бути і наша власна помилка ключа, і тоді
 * стерлись би підписки всім. Але підписка зі СТАРИМ ключем (після ротації)
 * так само отримує 403 назавжди, і без цього кроку пристрій лишався б
 * «увімкненим» у профілі, ніколи нічого не отримуючи. Тому браузер лагодить
 * себе сам — при відкритті застосунку, а не лише при дотику до тогла:
 * ключ не той → стара підписка з бази геть → перепідписка новим ключем.
 * Якщо браузер не дає перепідписатись без дотику (Safari) — чесно «вимкнено»,
 * і людина вмикає знову одним дотиком.
 */
export function healPushSubscription(userId: string): Promise<HealResult> {
  if (healInFlight) return healInFlight;
  healInFlight = (async (): Promise<HealResult> => {
    try {
      if (isNativeApp() || typeof navigator === "undefined" || !("serviceWorker" in navigator)
        || typeof window === "undefined" || !("PushManager" in window)) return "none";
      // getRegistration, НЕ register: не ставимо service worker тим, хто пушів не вмикав.
      const reg = await navigator.serviceWorker.getRegistration("/");
      if (!reg) return "none";
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return "none";
      const serverKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      if (subscriptionKeyMatches(sub.options?.applicationServerKey, serverKey) !== false) return "ok";
      // Стара підписка вже не працює — прибираємо її рядок ПЕРШИМ: якщо
      // перепідписка не вдасться, профіль покаже правду «вимкнено».
      await db.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", sub.endpoint);
      await sub.unsubscribe().catch(() => {});
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return "off";
      const fresh = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey as BufferSource });
      const j = fresh.toJSON();
      const p256dh = j.keys?.p256dh ?? "";
      const auth = j.keys?.auth ?? "";
      if (!p256dh || !auth) return "off";
      const { error } = await db.from("push_subscriptions").upsert(
        { user_id: userId, endpoint: fresh.endpoint, p256dh, auth },
        { onConflict: "user_id,endpoint" },
      );
      if (error) { console.error("push self-heal: save failed", error.message); return "off"; }
      return "healed";
    } catch {
      return "off";
    }
  })().finally(() => { healInFlight = null; });
  return healInFlight;
}

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
    // (синхронна версія цієї ж перевірки — isPushCapable нижче; тримати їх у парі)
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
    let cancelled = false;
    (async () => {
      const reg = await swReg();
      if (!reg) return;
      // Спершу — самолікування старого ключа (спільне з AppLayout, не дублюється).
      await healPushSubscription(user.id);
      const sub = await reg.pushManager.getSubscription();
      if (!sub) { if (!cancelled) setSubscribed(false); return; }
      const { data } = await db
        .from("push_subscriptions")
        .select("id")
        .eq("user_id", user.id)
        .eq("endpoint", sub.endpoint)
        .maybeSingle();
      if (!cancelled) setSubscribed(!!data);
    })();
    return () => { cancelled = true; };
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

      const serverKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      let sub = await reg.pushManager.getSubscription();
      // 13.09: підписка зі СТАРИМ VAPID-ключем (після ротації) — push-сервіс
      // відкидає такі надсилання (403), і subscribe() з новим ключем кидає
      // InvalidStateError. Тому звіряємо ключ і перепідписуємо мовчки.
      if (sub) {
        // На дотику ключ, який браузер не показує (null), теж перепідписуємо:
        // це разова дія людини, а не щоразове відкриття.
        const same = subscriptionKeyMatches(sub.options?.applicationServerKey, serverKey) === true;
        if (!same) { await sub.unsubscribe().catch(() => {}); sub = null; }
      }
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: serverKey as BufferSource,
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

/**
 * П2.8: синхронна перевірка «чи взагалі можливі пуші на цій платформі» — для
 * обгорток (картка в профілі, смужка в дзвіночку), яким не потрібен повний хук
 * зі слухачами. Дзеркалить логіку supported вище: натив = завжди так (FCM),
 * веб = SW + PushManager + Notification.
 */
export function isPushCapable(): boolean {
  if (isNativeApp()) return true;
  return typeof navigator !== "undefined" && typeof window !== "undefined"
    && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}
