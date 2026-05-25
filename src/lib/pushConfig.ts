// VAPID public key — safe to commit, it is public by design.
// Corresponds to VAPID_PRIVATE_KEY secret in Supabase Edge Functions.
export const VAPID_PUBLIC_KEY =
  "BIuCP5SFeluDkT-vIZK9IXDjCN5f4_aTxWD6uJqj1Ul7cXaNwVA8CBhZ3Kmavnf7hESeTMyKNgWK6dHL_Vr67qs";

export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from(Array.from(raw).map((c) => c.charCodeAt(0)));
}
