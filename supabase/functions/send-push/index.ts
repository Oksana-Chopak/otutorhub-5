// Edge Function: send a Web Push notification to a user
// Requires Supabase secrets (set in Dashboard → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY  — P-256 public key in base64url (uncompressed point, 65 bytes)
//   VAPID_PRIVATE_KEY — P-256 private scalar in base64url (32 bytes, JWK "d")
//   VAPID_SUBJECT     — mailto: or https: contact URI, e.g. mailto:hello@otutorhub.com
//
// Generate keys: node scripts/generate-vapid.mjs
// POST body: { userId: string, title: string, body?: string, link?: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { versionProbe } from "../_shared/build.ts";

// 13.09: публічний ключ — той самий, що в src/lib/pushConfig.ts (він публічний
// за задумом), тож секрет VAPID_PUBLIC_KEY не обовʼязковий. Без ПРИВАТНОГО
// ключа веб-пуш неможливий — але це не привід відповідати 500 на кожен виклик
// (так було: «Missing config» → усі, хто ввімкнув сповіщення, не отримували
// нічого, а кожна edge-функція, що кличе send-push, логувала помилку).
// Веб-гілка тоді пропускається, нативна (FCM) працює незалежно.
const VAPID_PUBLIC_KEY  = Deno.env.get("VAPID_PUBLIC_KEY") ||
  "BCrxR65dgGaBFQUAPWxcsCuXcE9DfLVnZ-kenhhRr8i2H3_ka6XO4LIfbYeK17BLosDUUvTvfyvRQH74jB1f1_s";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT     = Deno.env.get("VAPID_SUBJECT") ?? "mailto:hello@otutorhub.com";
const WEB_PUSH_READY    = !!VAPID_PRIVATE_KEY;

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
  const ikmKey = await crypto.subtle.importKey("raw", ikm as any, "HKDF", false, ["deriveBits"]);
  const prk = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: salt as any, info: new Uint8Array(0) as any }, ikmKey, 256);
  const prkKey = await crypto.subtle.importKey("raw", prk as any, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0) as any, info: info as any }, prkKey, length * 8);
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
    "raw", b64urlDecode(p256dh) as any, { name: "ECDH", namedCurve: "P-256" }, false, [],
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

  const aesKey = await crypto.subtle.importKey("raw", cek as any, "AES-GCM", false, ["encrypt"]);
  // Pad plaintext: record size = 4096, add delimiter 0x02
  const padded = concat(plaintext, new Uint8Array([2]));
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as any }, aesKey, padded as any);

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

async function sendOne(sub: { endpoint: string; p256dh: string; auth: string }, payload: object): Promise<"ok" | "gone" | "retry"> {
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

  if (res.status === 201 || res.status === 200) return "ok";
  // 22.09 (скан Lovable, ПІДТВЕРДЖЕНО — правка 13.09 цього не закрила): функція
  // повертала false на будь-який збій, а викликач видаляв КОЖНУ підписку з
  // false. Тобто один тайм-аут чи 5xx push-сервісу назавжди стирав реєстрацію
  // пристрою — репетитор, який увімкнув нагадування, просто переставав їх
  // отримувати, без жодного попередження, аж поки випадково не відкриє
  // застосунок. Тепер три стани, і видаляється лише справді мертве:
  //  · 404/410 — push-сервіс каже «такої підписки більше немає» (стандарт);
  //  · 401/403 — ключ VAPID не той. Це може бути і ротація ключів, і НАША
  //    власна помилка конфігурації; видаляти на цьому означало б при одному
  //    зламаному секреті стерти підписки ВСІМ. Лишаємо: клієнтський хук сам
  //    перепідпише браузер новим ключем при відкритті застосунку;
  //  · решта (429, 5xx) — тимчасове, повториться наступного разу.
  if (res.status === 404 || res.status === 410) {
    console.warn("push endpoint gone", res.status, sub.endpoint.slice(0, 48));
    return "gone";
  }
  if (res.status === 401 || res.status === 403) {
    console.error("push VAPID rejected — підписку НЕ видаляємо", res.status, sub.endpoint.slice(0, 48));
    return "retry";
  }
  console.error("push send failed (тимчасово)", res.status, (await res.text().catch(() => "")).slice(0, 200));
  return "retry";
}

// ── FCM HTTP v1: нативний Android (40b) ─────────────────────────────────
// Секрет FCM_SERVICE_ACCOUNT_JSON — JSON ключа сервісного акаунта Firebase.
// Немає секрету → нативна гілка мовчки пропускається, веб-пуш працює далі.
const FCM_SA_RAW = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON") ?? "";

function fcmPemToPkcs8(pem: string): Uint8Array {
  const b64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let fcmTokenCache: { value: string; exp: number } | null = null;

async function fcmMintToken(sa: { client_email: string; private_key: string; token_uri?: string }): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (fcmTokenCache && fcmTokenCache.exp > nowSec + 60) return fcmTokenCache.value;
  const enc = new TextEncoder();
  const head = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64url(enc.encode(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSec,
    exp: nowSec + 3600,
  })));
  const key = await crypto.subtle.importKey(
    "pkcs8", fcmPemToPkcs8(sa.private_key) as any,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(`${head}.${claim}`));
  const jwt = `${head}.${claim}.${b64url(new Uint8Array(sig))}`;
  const res = await fetch(sa.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`fcm token mint failed: ${res.status}`);
  fcmTokenCache = { value: json.access_token, exp: nowSec + Number(json.expires_in ?? 3600) };
  return json.access_token;
}

// deno-lint-ignore no-explicit-any
async function fcmSendNative(fcmDb: any, fcmUserId: string, msg: { title: string; body: string; link: string; tag?: string }): Promise<number> {
  if (!FCM_SA_RAW) {
    console.log("FCM_SERVICE_ACCOUNT_JSON not set — native push skipped");
    return 0;
  }
  let sa: { client_email: string; private_key: string; project_id: string; token_uri?: string };
  try { sa = JSON.parse(FCM_SA_RAW); } catch {
    console.error("FCM_SERVICE_ACCOUNT_JSON is not valid JSON — native push skipped");
    return 0;
  }
  const { data: fcmRows, error: fcmRowsErr } = await fcmDb.from("device_push_tokens").select("token").eq("user_id", fcmUserId);
  if (fcmRowsErr) console.error("fcm: tokens read failed", fcmRowsErr.message);
  if (!fcmRows || fcmRows.length === 0) return 0;
  let access: string;
  try { access = await fcmMintToken(sa); } catch (e) { console.error("fcm mint failed", e); return 0; }
  let okCount = 0;
  for (const row of fcmRows as { token: string }[]) {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token: row.token,
          notification: { title: msg.title, body: msg.body },
          data: { link: msg.link, ...(msg.tag ? { tag: msg.tag } : {}) },
          android: { priority: "HIGH", notification: { ...(msg.tag ? { tag: msg.tag } : {}) } },
        },
      }),
    });
    if (res.ok) { okCount++; continue; }
    const txt = await res.text();
    // Токен помер разом із застосунком — прибираємо, щоб не довбати FCM вічно.
    // 22.09: ЛИШЕ «UNREGISTERED» — так FCM каже саме про мертвий токен. Голий
    // 404 / NOT_FOUND FCM дає і на НАШУ помилку (не той project_id у секреті) —
    // тоді старе правило стерло б токени всіх телефонів одним зламаним секретом.
    if (txt.includes("UNREGISTERED")) {
      const { error: tokDelErr } = await fcmDb.from("device_push_tokens").delete().eq("token", row.token);
      if (tokDelErr) console.error("fcm: dead token not removed", tokDelErr.message);
    } else {
      console.error("fcm send failed", res.status, txt.slice(0, 200));
    }
  }
  return okCount;
}

Deno.serve(async (req) => {
  const probe = versionProbe(req, "send-push");
  if (probe) return probe;
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!supabaseUrl || !serviceKey) {
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

  let body: { userId?: string; title?: string; body?: string; link?: string; tag?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const { userId, title = "oTutorHub", body: msgBody = "", link = "/", tag } = body;
  if (!userId) {
    return new Response(JSON.stringify({ error: "userId required" }), { status: 400 });
  }

  // Fetch push subscriptions for this user (using service role bypasses RLS)
  const { data: subs } = await (db as unknown as typeof db & {
    from(t: "push_subscriptions"): ReturnType<typeof db.from>;
  }).from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId);

  // 40b: раніше тут був ранній вихід «немає веб-підписок → sent 0», і нативні
  // токени не питались зовсім. Тепер обидва транспорти незалежні.
  const payload = { title, body: msgBody, link, ...(tag ? { tag } : {}) };
  let sent = 0;
  if (WEB_PUSH_READY) {
    const list = (subs ?? []) as { endpoint: string; p256dh: string; auth: string }[];
    const results = await Promise.allSettled(list.map((s) => sendOne(s, payload)));
    sent = results.filter((r) => r.status === "fulfilled" && r.value === "ok").length;
    // Видаляємо ЛИШЕ те, що push-сервіс назвав мертвим. Відхилений проміс — це
    // тайм-аут або мережа, тобто тимчасове: така підписка лишається.
    const dead = list
      .filter((_, i) => { const r = results[i]; return r.status === "fulfilled" && r.value === "gone"; })
      .map((s) => s.endpoint);
    if (dead.length) {
      const { error: delErr } = await db.from("push_subscriptions").delete().eq("user_id", userId).in("endpoint", dead);
      if (delErr) console.error("push: мертві підписки не видалились", delErr.message);
    }
  } else if ((subs ?? []).length > 0) {
    console.warn("VAPID_PRIVATE_KEY not set — web push skipped for", (subs ?? []).length, "subscription(s)");
  }
  const sentNative = await fcmSendNative(db, userId, { title, body: msgBody, link, tag });

  return new Response(JSON.stringify({ ok: true, sent, sentNative, web: WEB_PUSH_READY ? "ok" : "not_configured" }), {
    headers: { "Content-Type": "application/json" },
  });
});
