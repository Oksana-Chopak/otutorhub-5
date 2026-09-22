// ci-report — вердикт робота з GitHub у Telegram суперадміна (22.09, «Сторож»).
//
// Навіщо: 835 червоних запусків CI поспіль (з 25.08) ніхто не побачив — GitHub
// ніхто не відкриває, а пошта губиться. Власниця живе в Telegram, там же приходить
// дайджест. Тому кожен пуш у main закінчується ОДНИМ рядком тут: «🟢 можна
// Publish» або «🔴 не публікуй — ось що впало». І щоранку — стан проду.
//
// Хто може писати: лише GitHub Actions із CRON_SECRET (той самий, що вже стоїть у
// секретах GitHub і Supabase для scheduled-notifications — жодного нового ключа).
// Кому: усім із platform_admins, у кого є привʼязаний Telegram (chat_id).
// Що: текст як є (HTML Telegram), без даних користувачів — лише вердикт робота.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const secret = Deno.env.get("CRON_SECRET");
  const provided = req.headers.get("x-cron-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || !provided || provided !== secret) return json(403, { error: "Forbidden" });

  const bot = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!bot || !url || !serviceKey) return json(500, { error: "Missing env" });

  let text = "";
  try {
    const body = await req.json();
    text = String(body?.text ?? "").trim();
  } catch {
    return json(400, { error: "JSON body { text } expected" });
  }
  if (!text) return json(400, { error: "text is empty" });
  if (text.length > 3800) text = text.slice(0, 3800) + "…";

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: admins, error: aErr } = await db.from("platform_admins").select("user_id");
  if (aErr) return json(500, { error: `platform_admins: ${aErr.message}` });
  const ids = (admins ?? []).map((r: { user_id: string }) => r.user_id);
  if (!ids.length) return json(200, { ok: true, sent: 0, reason: "no platform admins" });

  const { data: links, error: lErr } = await db
    .from("user_telegram_links")
    .select("user_id, chat_id")
    .in("user_id", ids)
    .not("chat_id", "is", null);
  if (lErr) return json(500, { error: `user_telegram_links: ${lErr.message}` });

  let sent = 0;
  const failed: string[] = [];
  for (const l of links ?? []) {
    const r = await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: Number(l.chat_id), text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (r.ok) sent++;
    else failed.push(`${l.user_id}: ${r.status}`);
  }
  return json(200, { ok: failed.length === 0, sent, failed });
});
