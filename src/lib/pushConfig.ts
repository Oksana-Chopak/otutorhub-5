// VAPID public key — safe to commit, it is public by design.
// Corresponds to VAPID_PRIVATE_KEY secret in Supabase Edge Functions.
// 13.09: пара перегенерована — приватного ключа до попереднього публічного
// не існувало в секретах (send-push відповідав 500 «Missing config» на кожен
// виклик). Старі підписки браузерів хук перепідписує сам (див.
// usePushNotifications: applicationServerKey не збігається → unsubscribe →
// subscribe), а send-push видаляє мертві endpoint-и.
export const VAPID_PUBLIC_KEY =
  "BCrxR65dgGaBFQUAPWxcsCuXcE9DfLVnZ-kenhhRr8i2H3_ka6XO4LIfbYeK17BLosDUUvTvfyvRQH74jB1f1_s";

export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from(Array.from(raw).map((c) => c.charCodeAt(0)));
}
