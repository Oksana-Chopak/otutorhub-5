// lifecycle-nudges — ланцюжок листів/Telegram для незалежних репетиторів (13.10).
//
// Навіщо: після реєстрації людина лишалась сама — ні «з чого почати», ні «ти
// додав учня, постав урок», ні «тріал закінчується, ось що ти вже зібрав», ні
// «два тижні тиші — усе на місці». Воронка 13.10: 15 закінчених тріалів без
// оплати, 0 підписок.
//
// Як працює: pg_cron кличе щогодини. База (`lifecycle_candidates`) сама вирішує,
// кому що сказати (одне повідомлення на людину на день, кожен крок — раз, сплячі —
// раз на цикл сну, тихі години 20:00–09:00 Києва) і віддає цифри людини. Тут —
// слова (`_shared/lifecycleTexts.ts`) і канали: Telegram, якщо є бот; інакше
// пошта (шаблон `lifecycle-nudge` через send-transactional-email); і завжди
// дзвіночок у застосунку (він же пуш через trg_send_push_on_notification).
// Кожна доставка — рядок у `lifecycle_messages`; повторний запуск нічого не дублює.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { versionProbe } from "../_shared/build.ts";
import { withJob } from "../_shared/jobRun.ts";
import { lifecycleMessage, telegramText, normLang, type LifecycleKind, type LifecycleNumbers } from "../_shared/lifecycleTexts.ts";

/** Ціни = src/lib/pricing.ts (PRICE_PER_MONTH.monthly / .yearly) — стереже lifecycle-nudges.test.ts. */
const PRICE_MONTHLY = 299;
const PRICE_YEARLY = 249;
const APP_URL = (Deno.env.get("APP_URL") ?? "https://otutorhub.com").replace(/\/+$/, "");
const MAX_PER_RUN = 200;

type Candidate = {
  user_id: string; kind: LifecycleKind; cycle_key: string; lang: string; first_name: string;
  email: string | null; chat_id: number | null; numbers: LifecycleNumbers;
};

function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Посилання «відписатися» — той самий механізм, що в розсилках. */
async function unsubscribeUrl(admin: any, email: string): Promise<string | undefined> {
  const { data: existing } = await admin.from("marketing_unsubscribe_tokens").select("token").eq("email", email).maybeSingle();
  let token = existing?.token as string | undefined;
  if (!token) {
    token = randomToken();
    const { error } = await admin.from("marketing_unsubscribe_tokens").insert({ token, email });
    if (error) {
      const { data: again } = await admin.from("marketing_unsubscribe_tokens").select("token").eq("email", email).maybeSingle();
      token = again?.token ?? undefined;
    }
  }
  return token ? `${APP_URL}/marketing-unsubscribe?token=${token}` : undefined;
}

Deno.serve(withJob("lifecycle-nudges", async (req) => {
  const probe = versionProbe(req, "lifecycle-nudges");
  if (probe) return probe;
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  if (!supabaseUrl || !serviceKey) return new Response(JSON.stringify({ error: "Missing env" }), { status: 500 });

  // Доступ: секрет pg_cron (vault) — або env CRON_SECRET, яким ходить GitHub (ручний запуск).
  const auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const provided = auth.replace(/^Bearer\s+/i, "") || req.headers.get("x-cron-secret") || "";
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: vaultSecret } = await admin.rpc("get_cron_shared_secret");
  const envSecret = Deno.env.get("CRON_SECRET") ?? "";
  if (!provided || !((vaultSecret && provided === vaultSecret) || (envSecret && provided === envSecret))) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  let dryRun = false;
  try { dryRun = new URL(req.url).searchParams.get("dry") === "1"; } catch { /* ні */ }

  const { data, error } = await (admin.rpc as any)("lifecycle_candidates", { _at: new Date().toISOString(), _limit: MAX_PER_RUN });
  if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  const quiet = !!data?.quiet;
  const rows = (Array.isArray(data?.rows) ? data.rows : []) as Candidate[];
  if (quiet) return new Response(JSON.stringify({ ok: true, sent: 0, quiet: true }), { headers: { "Content-Type": "application/json" } });

  let sent = 0, telegram = 0, email = 0, inapp = 0, failed = 0;
  const byKind: Record<string, number> = {};
  for (const c of rows) {
    const lang = normLang(c.lang);
    const msg = lifecycleMessage(c.kind, lang, c.first_name ?? "", c.numbers, { monthly: PRICE_MONTHLY, yearly: PRICE_YEARLY });
    if (dryRun) { byKind[c.kind] = (byKind[c.kind] ?? 0) + 1; continue; }
    const channels: string[] = [];
    try {
      // 1) Telegram — якщо є бот
      if (c.chat_id && botToken) {
        const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: c.chat_id, text: telegramText(msg, APP_URL), parse_mode: "HTML", disable_web_page_preview: true }),
        });
        if (r.ok) { channels.push("telegram"); telegram++; }
      }
      // 2) Пошта — якщо Telegram не дійшов (щоб не дублювати одне й те саме двома каналами)
      if (!channels.length && c.email) {
        const unsub = await unsubscribeUrl(admin, c.email);
        const r = await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
          body: JSON.stringify({
            templateName: "lifecycle-nudge",
            recipientEmail: c.email,
            idempotencyKey: `lifecycle:${c.user_id}:${c.kind}:${c.cycle_key || "once"}`,
            templateData: { title: msg.title, lines: msg.lines, ctaText: msg.cta.text, ctaUrl: `${APP_URL}${msg.cta.path}`, unsubscribeUrl: unsub, lang },
          }),
        });
        if (r.ok) { channels.push("email"); email++; }
      }
      // 3) Дзвіночок у застосунку — завжди (тригер шле пуш на телефон/браузер)
      const { error: nErr } = await admin.from("notifications").insert({
        user_id: c.user_id, type: "lifecycle", title: msg.title, body: msg.lines[0] ?? null, link: msg.cta.path,
      });
      if (!nErr) { channels.push("inapp"); inapp++; }
    } catch (e) {
      console.error("[lifecycle-nudges] send failed:", c.user_id, c.kind, (e as any)?.message ?? e);
    }
    if (channels.length) {
      const { error: recErr } = await (admin.rpc as any)("lifecycle_record", {
        _user_id: c.user_id, _kind: c.kind, _cycle_key: c.cycle_key ?? "", _channels: channels,
        _meta: { lang, numbers: c.numbers, title: msg.title },
      });
      if (recErr) console.error("[lifecycle-nudges] журнал не записався:", recErr.message);
      sent++;
      byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
    } else {
      failed++;
    }
    await new Promise((r) => setTimeout(r, 60));
  }

  return new Response(JSON.stringify({ ok: true, sent, telegram, email, inapp, failed, candidates: rows.length, dryRun, ...byKind }), {
    headers: { "Content-Type": "application/json" },
  });
}));
