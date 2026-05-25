// Edge Function: send a Web Push notification to a user
// Requires Supabase secrets (set in Dashboard → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY  — P-256 public key in base64url (uncompressed point, 65 bytes)
//   VAPID_PRIVATE_KEY — P-256 private scalar in base64url (32 bytes, JWK "d")
//   VAPID_SUBJECT     — mailto: or https: contact URI, e.g. mailto:hello@otutorhub.com
//
// Generate keys: node scripts/generate-vapid.mjs
// POST body: { userId: string, title: string, body?: string, link?: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VAPID_PUBLIC_KEY  = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT     = Deno.env.get("VAPID_SUBJECT") ?? "mailto:hello@otutorhub.com";

function b64url(buf: BufferSource): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf instanceof ArrayBuffer ? buf : (buf as Uint8Array)))
  ).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function b64urlDecode(s: string): Uint8Array {
  const p = s.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(p + "=".repeat((4 - p.length % 4) % 4));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function importVapidPrivate(): Promise<CryptoKey> {
  // Public key: uncompressed P-256 point (65 bytes: 0x04 + x32 + y32)
  const pubBytes = b64urlDecode(VAPID_PUBLIC_KEY);
  const x = b64url(pubBytes.slice(1, 33));
  const y = b64url(pubBytes.slice(33, 65));
  return crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", d: VAPID_PRIVATE_KEY, x, y, key_ops: ["sign"] },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

async function vapidToken(audience: string): Promise<string> {
  const header  = b64url(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 43200,
    sub: VAPID_SUBJECT,
  })));
  const unsigned = `${header}.${payload}`;
  const key = await importVapidPrivate();
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${b64url(sig)}`;
}

// HKDF using SHA-256
async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const ikmKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const prk = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: new Uint8Array(0) }, ikmKey, 256);
  const prkKey = await crypto.subtle.importKey("raw", prk, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info }, prkKey, length * 8);
  return new Uint8Array(bits);
}

async function encryptPayload(
  p256dh: string,
  auth: string,
  plaintext: Uint8Array,
): Promise<{ ciphertext: Uint8Array; serverPublicKey: Uint8Array; salt: Uint8Array }> {
  // Generate server ECDH key pair
  const serverKP = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const serverPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", serverKP.publicKey));

  // Import client public key
  const clientPub = await crypto.subtle.importKey(
    "raw", b64urlDecode(p256dh), { name: "ECDH", namedCurve: "P-256" }, false, [],
  );

  // ECDH shared secret
  const sharedBits = await crypto.subtle.deriveBits({ name: "ECDH", public: clientPub }, serverKP.privateKey, 256);
  const sharedSecret = new Uint8Array(sharedBits);

  const authSecret = b64urlDecode(auth);
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // PRK_key
  const prkKey = await hkdf(sharedSecret, authSecret,
    concat(new TextEncoder().encode("Content-Encoding: auth\0"), new Uint8Array(1)), 32);

  const clientPubRaw = b64urlDecode(p256dh);

  // Content encryption key + nonce
  const keyInfo   = concat(new TextEncoder().encode("Content-Encoding: aes128gcm\0"), new Uint8Array(1));
  const nonceInfo = concat(new TextEncoder().encode("Content-Encoding: nonce\0"), new Uint8Array(1));

  // context = client key len (2) + client key + server key len (2) + server key
  const context = concat(
    new Uint8Array([0, clientPubRaw.length]), clientPubRaw,
    new Uint8Array([0, serverPubRaw.length]), serverPubRaw,
  );

  const cek   = await hkdf(prkKey, salt, concat(keyInfo, context), 16);
  const nonce = await hkdf(prkKey, salt, concat(nonceInfo, context), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // Pad plaintext: record size = 4096, add delimiter 0x02
  const padded = concat(plaintext, new Uint8Array([2]));
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded);

  // Build aes128gcm content-encoding header: salt(16) + rs(4) + keyid_len(1) + keyid(65)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  const header = concat(salt, rs, new Uint8Array([serverPubRaw.length]), serverPubRaw);

  return { ciphertext: concat(header, new Uint8Array(cipherBuf)), serverPublicKey: serverPubRaw, salt };
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

async function sendOne(sub: { endpoint: string; p256dh: string; auth: string }, payload: object): Promise<boolean> {
  const url = new URL(sub.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const token = await vapidToken(audience);
  const auth = `vapid t=${token},k=${VAPID_PUBLIC_KEY}`;

  const body = new TextEncoder().encode(JSON.stringify(payload));
  const { ciphertext } = await encryptPayload(sub.p256dh, sub.auth, body);

  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Authorization": auth,
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      "TTL": "86400",
    },
    body: ciphertext,
  });

  return res.status === 201 || res.status === 200;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!supabaseUrl || !serviceKey || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return new Response(JSON.stringify({ error: "Missing config" }), { status: 500 });
  }

  // Auth: require service-role key. This function is only invoked server-side
  // by other edge functions and DB triggers — never directly by clients.
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const provided = authHeader?.replace(/^Bearer\s+/i, "");
  if (!provided || provided !== serviceKey) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  let body: { userId?: string; title?: string; body?: string; link?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const { userId, title = "oTutorHub", body: msgBody = "", link = "/" } = body;
  if (!userId) {
    return new Response(JSON.stringify({ error: "userId required" }), { status: 400 });
  }

  // Fetch push subscriptions for this user (using service role bypasses RLS)
  const { data: subs } = await (db as unknown as typeof db & {
    from(t: "push_subscriptions"): ReturnType<typeof db.from>;
  }).from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (!subs || subs.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0 }), { headers: { "Content-Type": "application/json" } });
  }

  const payload = { title, body: msgBody, link };
  const results = await Promise.allSettled(
    (subs as { endpoint: string; p256dh: string; auth: string }[]).map((s) => sendOne(s, payload))
  );
  const sent = results.filter((r) => r.status === "fulfilled" && r.value).length;

  return new Response(JSON.stringify({ ok: true, sent }), {
    headers: { "Content-Type": "application/json" },
  });
});
