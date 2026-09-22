/**
 * 22.09: «чи справді ця функція оновилась у проді?» — питання, яке тричі
 * плутало реліз (§0 спільного контексту): стара й нова версія edge-функції
 * відповідають ззовні однаково, а Publish їх не чіпає зовсім.
 *
 * `GET …/functions/v1/<fn>?version` віддає мітку збірки — без даних, без
 * побічних дій, ДО будь-якої перевірки доступу. Агент звіряє мітку сам із
 * браузера, не просячи власницю переказувати відповіді Lovable.
 *
 * ПРАВИЛО: кожен пакет, що міняє edge-функції, підіймає EDGE_BUILD.
 */
export const EDGE_BUILD = "2026-09-22.2";

export function versionProbe(req: Request, fn: string): Response | null {
  if (req.method !== "GET") return null;
  if (!new URL(req.url).searchParams.has("version")) return null;
  return new Response(JSON.stringify({ fn, build: EDGE_BUILD }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}
