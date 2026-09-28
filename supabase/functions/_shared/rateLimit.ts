// Ліміт частоти для ПУБЛІЧНИХ edge-функцій (verify_jwt = false) — 27.09.
//
// Було: лічильник у памʼяті ізолята з ключем «IP+пошта». Дві діри одразу:
//   • памʼять обнуляється з кожним холодним стартом ізолята (і ізолятів
//     кілька) — ліміт існував лише на папері;
//   • ключ із поштою означає, що КОЖНА нова пошта — новий ліміт, тож із
//     однієї адреси можна було без стелі створювати акаунти й розсилати листи
//     підтвердження від нашого домену → домен у спамі → справжнім клієнтам не
//     доходять листи.
//
// Тепер правда живе в базі: `rate_limit_check(scope, key, max, window)`
// (міграція 20260927150000; ключ зберігається лише як md5, рядки живуть добу).
// Якщо база недоступна (SQL ще не вставлено, тимчасовий збій) — функція НЕ
// відчиняє двері навстіж: працює запасний лічильник у памʼяті ізолята і в
// `error_log` пишеться рядок, щоб збій було видно в /errors, а не лише в
// логах Supabase, яких ніхто не бачить.
//
// deno-lint-ignore-file no-explicit-any

export type RateVerdict = "allow" | "limit";

const memHits = new Map<string, number[]>();
function memLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (memHits.get(key) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  memHits.set(key, arr);
  if (memHits.size > 5000) {
    for (const [k, v] of memHits) if (v.every((t) => now - t >= windowMs)) memHits.delete(k);
  }
  return arr.length > max;
}

/** IP того, хто прийшов — за шлюзом Supabase це x-forwarded-for / cf-connecting-ip. */
export function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/**
 * Одна спроба за ключем. `allow` — можна, `limit` — забагато.
 * `admin` — клієнт зі службовим ключем (RPC виконувана лише для service_role).
 */
export async function rateLimit(
  admin: any,
  scope: string,
  key: string,
  max: number,
  windowSeconds: number,
): Promise<RateVerdict> {
  try {
    // RPC додано міграцією 20260927150000 — поки Lovable не перегенерував
    // types.ts, кличемо через (rpc as any), як і решту свіжих RPC у репо.
    const { data, error } = await (admin.rpc as any)("rate_limit_check", {
      _scope: scope,
      _key: key,
      _max: max,
      _window_seconds: windowSeconds,
    });
    if (error) throw error;
    return data === true ? "limit" : "allow";
  } catch (e) {
    const msg = String((e as any)?.message ?? e);
    console.error(`rate_limit_check unavailable (${scope}): ${msg}`);
    try {
      await admin.from("error_log").insert({
        message: `rate_limit_check недоступна (${scope}) — працює запасний лічильник у памʼяті`,
        url: `edge:${scope}`,
        context: { scope, error: msg.slice(0, 500) },
      });
    } catch {
      /* логування не має ламати відповідь */
    }
    return memLimited(`${scope}:${key.toLowerCase()}`, max, windowSeconds * 1000) ? "limit" : "allow";
  }
}
