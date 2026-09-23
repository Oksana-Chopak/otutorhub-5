/**
 * 22.09: «чи справді ця функція оновилась у проді?» — питання, яке тричі
 * плутало реліз (§0 спільного контексту): стара й нова версія edge-функції
 * відповідають ззовні однаково, а Publish їх не чіпає зовсім.
 *
 * `GET …/functions/v1/<fn>?version` віддає мітку збірки — без даних, без
 * побічних дій, ДО будь-якої перевірки доступу. Агент звіряє мітку сам із
 * браузера, не просячи власницю переказувати відповіді Lovable.
 *
 * Мітка — НЕ ручна (ручний BUILD_TAG не бампався з 07.09 через ~40 комітів):
 * це хеш вмісту всіх edge-функцій із `_shared/version.ts`, який генерує
 * `npm run stamp`; ворота `stamp-edge` падають, якщо функцію змінили й не
 * перештампували. Той самий хеш віддає функція `version` (весь пакет разом),
 * а робот у CI (tests/prod) звіряє обидва з репо — по функції, поіменно.
 */
import { EDGE_VERSION, EDGE_FUNCTIONS } from "./version.ts";

export const EDGE_BUILD = EDGE_VERSION;

export function versionProbe(req: Request, fn: string): Response | null {
  if (req.method !== "GET") return null;
  if (!new URL(req.url).searchParams.has("version")) return null;
  return new Response(JSON.stringify({ fn, build: EDGE_BUILD, functions: EDGE_FUNCTIONS }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}
