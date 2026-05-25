// Generate VAPID keys for Web Push notifications.
// Run once: node scripts/generate-vapid.mjs
// Then add output values to:
//   .env.local            → VITE_VAPID_PUBLIC_KEY=<public>
//   Supabase Secrets      → VAPID_PUBLIC_KEY=<public>
//                         → VAPID_PRIVATE_KEY=<private>
//                         → VAPID_SUBJECT=mailto:hello@otutorhub.com
import { webcrypto } from "node:crypto";

const { publicKey, privateKey } = await webcrypto.subtle.generateKey(
  { name: "ECDH", namedCurve: "P-256" },
  true,
  ["deriveKey", "deriveBits"],
);

const pubRaw  = await webcrypto.subtle.exportKey("raw", publicKey);
const privJwk = await webcrypto.subtle.exportKey("jwk", privateKey);

const pubB64  = Buffer.from(pubRaw).toString("base64url");
const privB64 = privJwk.d;

console.log("─".repeat(60));
console.log("VAPID keys generated — store these securely:\n");
console.log(`VITE_VAPID_PUBLIC_KEY=${pubB64}`);
console.log(`VAPID_PUBLIC_KEY=${pubB64}`);
console.log(`VAPID_PRIVATE_KEY=${privB64}`);
console.log(`VAPID_SUBJECT=mailto:hello@otutorhub.com`);
console.log("─".repeat(60));
