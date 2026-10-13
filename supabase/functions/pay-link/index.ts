// pay-link — публічна сторінка оплати за магічним посиланням (13.10).
//
// Навіщо: нагадування про оплату доходило лише до учня з акаунтом і Telegram;
// батьки в Україні живуть у Viber/Telegram і нічого не встановлюють. Тепер
// репетитор пересилає посилання сам (або воно вкладене в автоматичне
// нагадування), а за ним — борг, реквізити й кнопка «Я оплатив(ла)» без входу.
//
// Безпека (PUBLIC DOORS): токен — 64 hex (256 біт), живе 60 днів, відкликається;
// функція без JWT, тож ліміти — у БАЗІ (rate_limit_check): перегляд 60/год з
// адреси, заявка 10/год з адреси і стеля 3/добу на пару в самій функції бази;
// сторінка бачить лише імʼя учня без прізвища, уроки пари й реквізити — те, що
// учень і так отримує в нагадуванні. Нічого з тіла запиту в базу не пишеться,
// крім суми (перевіряється) і короткої нотатки (обрізається).
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { versionProbe } from "../_shared/build.ts";
import { rateLimit, clientIp } from "../_shared/rateLimit.ts";
import { withErrorLog } from "../_shared/errorLog.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const TOKEN_RE = /^[0-9a-f]{64}$/;
const VIEWS_PER_IP_HOUR = 60;
const CLAIMS_PER_IP_HOUR = 10;
const NOTE_MAX = 200;

/** Токен з рядка запиту або тіла — лише 64 hex, інакше null. */
export function parseToken(raw: unknown): string | null {
  const t = String(raw ?? "").trim().toLowerCase();
  return TOKEN_RE.test(t) ? t : null;
}

/** Сума заявки: число 1…1 000 000 з крапкою чи комою; інакше null. */
export function parseAmount(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return null;
  return Math.round(n * 100) / 100;
}

Deno.serve(withErrorLog("pay-link", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const probe = versionProbe(req, "pay-link");
  if (probe) return probe;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const ip = clientIp(req);

  if (req.method === "GET") {
    const token = parseToken(new URL(req.url).searchParams.get("t"));
    if (!token) return json(404, { ok: false, reason: "not_found" });
    if ((await rateLimit(admin, "pay_link_view", ip, VIEWS_PER_IP_HOUR, 3600)) === "limit") {
      return json(429, { ok: false, reason: "rate_limited" });
    }
    const { data, error } = await (admin.rpc as any)("payment_link_view", { _token: token });
    if (error) return json(500, { ok: false, reason: "db", message: error.message });
    const body = (data ?? { ok: false, reason: "not_found" }) as { ok?: boolean };
    return json(body.ok ? 200 : 404, body);
  }

  if (req.method === "POST") {
    let body: { token?: unknown; amount?: unknown; note?: unknown } = {};
    try { body = await req.json(); } catch { /* порожнє тіло */ }
    const token = parseToken(body.token);
    if (!token) return json(404, { ok: false, reason: "not_found" });
    const amount = parseAmount(body.amount);
    if (amount === null) return json(400, { ok: false, reason: "bad_amount" });
    if ((await rateLimit(admin, "pay_link_claim", ip, CLAIMS_PER_IP_HOUR, 3600)) === "limit") {
      return json(429, { ok: false, reason: "rate_limited" });
    }
    const note = String(body.note ?? "").replace(/\s+/g, " ").trim().slice(0, NOTE_MAX) || null;
    const { data, error } = await (admin.rpc as any)("payment_link_claim", { _token: token, _amount: amount, _note: note });
    if (error) return json(500, { ok: false, reason: "db", message: error.message });
    const res = (data ?? { ok: false, reason: "not_found" }) as { ok?: boolean; reason?: string };
    return json(res.ok ? 200 : res.reason === "not_found" ? 404 : 200, res);
  }

  return json(405, { ok: false, reason: "method" });
}));
