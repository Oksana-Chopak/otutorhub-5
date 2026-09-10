/**
 * Meta Conversions API — серверний двійник браузерного Pixel.
 *
 * Браузерну подію ріжуть блокувальники; ця приходить із сервера. Обидві несуть
 * ОДИН `event_id`, тож Meta бачить одну конверсію, а не дві.
 *
 * МОВЧИТЬ БЕЗ КЛЮЧІВ: поки в Lovable немає META_PIXEL_ID і META_CAPI_TOKEN,
 * функція повертає 200 {skipped:"not_configured"} — фронт нічого не помічає.
 *
 * ЩО ЙДЕ ДО META: назва події з білого списку, event_id, адреса сторінки, пара
 * чисел (скільки учнів, скільки боргу) і технічні ідентифікатори — IP,
 * user-agent, куки _fbp/_fbc. Це персональні дані, тому фронт кличе цю функцію
 * ЛИШЕ після згоди на куки. Імен, телефонів, пошт і самого списку учнів тут
 * немає й бути не може: тіло розбирається по білому списку полів.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ALLOWED = new Set(["PageView", "Lead", "CompleteRegistration"]);
const API_VERSION = "v21.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const pixelId = Deno.env.get("META_PIXEL_ID");
  const token = Deno.env.get("META_CAPI_TOKEN");
  if (!pixelId || !token) return json(200, { skipped: "not_configured" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "bad_json" }); }

  const eventName = String(body.event_name ?? "");
  if (!ALLOWED.has(eventName)) return json(200, { skipped: "event_not_allowed" });

  const eventId = String(body.event_id ?? "").slice(0, 64) || crypto.randomUUID();
  const sourceUrl = typeof body.event_source_url === "string" ? body.event_source_url.slice(0, 500) : undefined;

  // Тільки числа і тільки три ключі — жодного вільного тексту в бік Meta.
  const raw = (body.custom_data ?? {}) as Record<string, unknown>;
  const custom: Record<string, number> = {};
  for (const k of ["students", "owed", "monthly"]) {
    const v = raw[k];
    if (typeof v === "number" && Number.isFinite(v)) custom[k] = Math.round(v);
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ua = req.headers.get("user-agent") ?? undefined;
  const userData: Record<string, string> = {};
  if (ip) userData.client_ip_address = ip;
  if (ua) userData.client_user_agent = ua;
  if (typeof body.fbp === "string" && body.fbp) userData.fbp = body.fbp.slice(0, 128);
  if (typeof body.fbc === "string" && body.fbc) userData.fbc = body.fbc.slice(0, 256);

  const payload = {
    data: [{
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: "website",
      ...(sourceUrl ? { event_source_url: sourceUrl } : {}),
      user_data: userData,
      ...(Object.keys(custom).length ? { custom_data: custom } : {}),
    }],
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    );
    if (!res.ok) {
      // Не віддаємо тіло помилки Meta назовні — там буває сам токен у луні.
      return json(200, { sent: false, status: res.status });
    }
    return json(200, { sent: true });
  } catch {
    return json(200, { sent: false, status: 0 });
  }
});
