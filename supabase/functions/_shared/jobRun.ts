// Мертвий вимикач (27.09): кожен запуск cron-функції лишає рядок у `job_runs`.
//
// pg_cron кличе edge-функції через net.http_post «вистрелив і забув»; логи
// Supabase не бачать ні власниця, ні агент. Отже впалий дайджест, нагадування
// чи бекап досі були невидимі, поки не поскаржиться клієнт (13.09: нагадування
// мовчали тиждень при «успішному» кроні). Тепер:
//
//   Deno.serve(withJob("tutor-daily-digest", async (req) => { … }));
//
// Обгортка нічого не змінює у відповіді. Після відповіді вона записує в базу
// (через `job_run_record`, лише service_role): назву, тривалість, ok/ні,
// HTTP-статус, лічильники з JSON-тіла (скільки надіслано) і текст помилки.
// Кинутий виняток — теж рядок (ok=false) і далі летить як летів.
// Проби робота (`?version`, OPTIONS) і чужі стуки (401/403) запусками не є.
// Зведення читає ранковий дайджест суперадміна (`job_health`).
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";

type Handler = (req: Request) => Promise<Response> | Response;

const MAX_COUNT_KEYS = 20;

/** Лічильники з відповіді функції: лише числа, булеві та короткі рядки верхнього рівня. */
export function pickCounts(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (n >= MAX_COUNT_KEYS) break;
    if (typeof v === "number" || typeof v === "boolean") { out[k] = v; n++; }
    else if (typeof v === "string" && v.length <= 120) { out[k] = v; n++; }
    else if (Array.isArray(v)) { out[k] = v.length; n++; }
  }
  return n ? out : null;
}

async function record(job: string, ok: boolean, ms: number, status: number | null, counts: Record<string, unknown> | null, error: string | null) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;
  try {
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    // RPC з міграції 20260927170000 — до перегенерації types.ts кличемо через (rpc as any)
    const { error: rpcErr } = await (admin.rpc as any)("job_run_record", {
      _job: job, _ok: ok, _ms: ms, _status: status, _counts: counts, _error: error,
    });
    if (rpcErr) console.error(`[withJob] job_run_record failed for ${job}: ${rpcErr.message}`);
  } catch (e) {
    console.error(`[withJob] record failed for ${job}:`, (e as any)?.message ?? e);
  }
}

export function withJob(job: string, handler: Handler): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const started = Date.now();
    let probe = req.method === "OPTIONS";
    try { probe = probe || new URL(req.url).searchParams.has("version"); } catch { /* сирий URL — не проба */ }
    let res: Response;
    try {
      res = await handler(req);
    } catch (e) {
      const msg = String((e as any)?.message ?? e);
      if (!probe) await record(job, false, Date.now() - started, null, null, msg);
      throw e;
    }
    if (probe || res.status === 401 || res.status === 403) return res;
    let counts: Record<string, unknown> | null = null;
    let error: string | null = null;
    try {
      const ct = res.headers.get("content-type") ?? "";
      const text = await res.clone().text();
      if (text && text.length <= 4000 && (ct.includes("application/json") || /^[\[{]/.test(text.trim()))) {
        const parsed = JSON.parse(text);
        if (res.ok) counts = pickCounts(parsed);
        else error = text.slice(0, 500);
      } else if (!res.ok && text) {
        error = text.slice(0, 500);
      }
    } catch { /* тіло не JSON — лічильників не буде, це не помилка */ }
    await record(job, res.ok, Date.now() - started, res.status, counts, error);
    return res;
  };
}
