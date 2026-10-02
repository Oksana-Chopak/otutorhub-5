// import-sheet-fetch — Google Таблиця за посиланням → CSV для імпорту (29.09).
//
// Навіщо: репетитори ведуть учнів у Google Таблицях; перенести руками ніхто не
// буде, а не перенести = не почати. Людина вставляє посилання — ми читаємо
// таблицю, і далі працює той самий парсер і той самий екран підтвердження
// (число ніколи не вигадується).
//
// Як: без жодних прав Google. Якщо таблиця відкрита «всім, хто має посилання»,
// експорт у CSV доступний публічно. Якщо ні — Google веде на сторінку входу,
// і ми чесно відповідаємо «таблиця приватна: відкрий доступ за посиланням».
//
// Безпека: лише docs.google.com (жодних довільних адрес — SSRF), ліміт 1 МБ і
// 500 рядків, таймаут 15 с, стеля 30 таблиць/год на репетитора в базі; з
// лендінгу без акаунта — 200 рядків, 5/год з адреси, 500/добу на платформу.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { versionProbe } from "../_shared/build.ts";
import { rateLimit, clientIp } from "../_shared/rateLimit.ts";
import { withErrorLog } from "../_shared/errorLog.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export const MAX_BYTES = 1_000_000;
export const MAX_ROWS = 500;
/** Лендінг (без акаунта): менше рядків і жорсткіший ліміт — це публічні двері. */
export const MAX_ROWS_ANON = 200;
const FETCH_TIMEOUT_MS = 15_000;
const PER_TUTOR_HOUR = 30;
const PER_IP_HOUR_ANON = 5;
const PLATFORM_DAY_ANON = 500;

/** Посилання на Google Таблицю → адреса експорту CSV. null = не Google Таблиця. */
export function sheetCsvUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:" || u.hostname !== "docs.google.com") return null;
  // Опубліковано у веб: /spreadsheets/d/e/<id>/pub → лишаємо як є з output=csv
  const pub = u.pathname.match(/^\/spreadsheets\/d\/e\/([A-Za-z0-9_-]+)\/pub/);
  if (pub) {
    const gid = u.searchParams.get("gid");
    return `https://docs.google.com/spreadsheets/d/e/${pub[1]}/pub?output=csv${gid ? `&gid=${encodeURIComponent(gid)}` : ""}`;
  }
  const m = u.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{10,})/);
  if (!m) return null;
  const gidFromHash = (u.hash.match(/gid=(\d+)/) ?? [])[1];
  const gid = u.searchParams.get("gid") ?? gidFromHash;
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${encodeURIComponent(gid)}` : ""}`;
}

Deno.serve(withErrorLog("import-sheet-fetch", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const probe = versionProbe(req, "import-sheet-fetch");
  if (probe) return probe;
  if (req.method !== "POST") return json(405, { error: "method" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await userClient.auth.getUser();

  let body: { url?: string } = {};
  try { body = await req.json(); } catch { /* порожнє тіло */ }
  const csvUrl = sheetCsvUrl(String(body.url ?? ""));
  if (!csvUrl) return json(400, { error: "bad_url" });

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  // Залогінений — 30/год на людину. Лендінг без акаунта (29.09: «маєш Google
  // Таблицю? встав посилання» ще до реєстрації) — 5/год з адреси і 500/добу на
  // платформу; ліміти живуть у базі, як у всіх публічних дверей.
  if (user) {
    if ((await rateLimit(admin, "import_sheet_fetch", user.id, PER_TUTOR_HOUR, 3600)) === "limit") {
      return json(429, { error: "rate_limited" });
    }
  } else {
  /* 01.10: обидва ключі перевірялись ПАРАЛЕЛЬНО, а `rate_limit_check` записує
     спробу беззастережно — ще до вердикту. Тобто вже заблокована адреса далі
     нарощувала ПЛАТФОРМЕНИЙ лічильник, і 501 дешевий запит з однієї машини
     вимикав читання Google Таблиці ДЛЯ ВСІХ відвідувачів до кінця добового
     вікна (а іншого шляху для аноніма тут немає). Тому перевірка послідовна:
     найдешевший ключ першим, і при відмові ми не торкаємось спільного. */
    if ((await rateLimit(admin, "import_sheet_fetch_ip", clientIp(req), PER_IP_HOUR_ANON, 3600)) === "limit") {
      return json(429, { error: "rate_limited" });
    }
    if ((await rateLimit(admin, "import_sheet_fetch_all", "platform", PLATFORM_DAY_ANON, 86400)) === "limit") {
      return json(429, { error: "rate_limited" });
    }
  }
  const maxRows = user ? MAX_ROWS : MAX_ROWS_ANON;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(csvUrl, { redirect: "follow", signal: ctrl.signal, headers: { "User-Agent": "oTutorHub-import/1.0" } });
  } catch (e) {
    clearTimeout(timer);
    return json(504, { error: (e as any)?.name === "AbortError" ? "timeout" : "fetch_failed" });
  }
  clearTimeout(timer);

  // Приватна таблиця → Google веде на сторінку входу (HTML), а не CSV.
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (res.url.includes("accounts.google.com") || ct.includes("text/html") || res.status === 401 || res.status === 403) {
    return json(403, { error: "private" });
  }
  if (res.status === 404) return json(404, { error: "not_found" });
  if (!res.ok) return json(502, { error: "google_error", status: res.status });

  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) return json(413, { error: "too_big" });
  const text = await res.text();
  if (text.length > MAX_BYTES) return json(413, { error: "too_big" });
  // Порожні рядки таблиці експортуються як ",,,," — це не рядки даних.
  const lines = text.split(/\r?\n/).filter((l) => l.replace(/[,;\t"\s]/g, "") !== "");
  if (lines.length > maxRows + 1) return json(413, { error: "too_many_rows", rows: lines.length - 1 });
  if (lines.length < 2) return json(422, { error: "empty" });

  return json(200, { csv: lines.join("\n"), rows: lines.length - 1 });
}));
