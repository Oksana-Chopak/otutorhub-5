// Помилки edge-функцій — в error_log (02.10, лог-менеджмент).
//
// До цього з 49 edge-функцій у error_log писали 3: решта кидала console.error
// у логи Supabase, яких не бачить ніхто. Тепер кожна функція-запит обгорнута:
//
//   Deno.serve(withErrorLog("send-student-invite", async (req) => { … }));
//
// Обгортка нічого не змінює у відповіді. Кинутий виняток і відповідь 5xx
// лягають рядком у error_log (message «edge <name>: <статус> <початок тіла>»,
// url «edge:<name>»), звідки їх читають /errors, група помилок в адмінці,
// ранковий дайджест і щоденна рутина в GitHub. 4xx — не помилки продукту
// (401/403/429 — чужі стуки й ліміти), їх не пишемо. Проби версії й OPTIONS
// теж ні. Cron-функції мають withJob (job_runs) — цю обгортку не беруть.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";

type Handler = (req: Request) => Promise<Response> | Response;

async function record(name: string, message: string, context: Record<string, unknown>) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;
  try {
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    await admin.from("error_log").insert({ message: message.slice(0, 500), url: `edge:${name}`, context });
  } catch (e) {
    console.error(`[withErrorLog] запис не вдався (${name}):`, (e as any)?.message ?? e);
  }
}

export function withErrorLog(name: string, handler: Handler): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    let probe = req.method === "OPTIONS";
    try { probe = probe || new URL(req.url).searchParams.has("version"); } catch { /* сирий URL */ }
    let res: Response;
    try {
      res = await handler(req);
    } catch (e) {
      const msg = String((e as any)?.message ?? e);
      if (!probe) await record(name, `edge ${name}: виняток — ${msg}`, { stack: String((e as any)?.stack ?? "").slice(0, 1500) });
      throw e;
    }
    if (probe || res.status < 500) return res;
    let body = "";
    try { body = (await res.clone().text()).slice(0, 300); } catch { /* тіло не читається */ }
    await record(name, `edge ${name}: ${res.status} ${body}`, { status: res.status });
    return res;
  };
}
