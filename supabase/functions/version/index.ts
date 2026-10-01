// version — «яку версію edge-функцій крутить прод?»
//
// Навіщо: Publish у Lovable НЕ деплоїть edge-функції (третій канал доставки,
// §0 спільного контексту). Досі «чи передеплоєно» вгадувалось, і власниця тричі
// бачила в скані «ті самі помилки, які агент нібито виправляв». Тепер робот у CI
// питає цю функцію і порівнює з штампом у репо (`_shared/version.ts`,
// генерується `scripts/stamp-edge.mjs`): збіглось — прод свіжий; ні — у звіті
// стоїть «edge-функції застарілі, потрібен передеплой». Нічого приватного тут
// немає: лише хеш вмісту і кількість функцій.
import { EDGE_VERSION, EDGE_FUNCTIONS, EDGE_FN_VERSION } from "../_shared/version.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return new Response(
    /* 01.10: `edge` — штамп усього пакета (яким він був, коли САМУ цю функцію
       деплоїли), `self` — штамп цієї функції. Робот звіряє `self`: Lovable
       передеплоює лише змінені, тож пакетний штамп тут майже завжди «старий», і
       саме він давав хибне «edge-функції застарілі» щоранку. */
    JSON.stringify({ edge: EDGE_VERSION, self: EDGE_FN_VERSION["version"] ?? EDGE_VERSION, functions: EDGE_FUNCTIONS, at: new Date().toISOString() }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } },
  );
});
