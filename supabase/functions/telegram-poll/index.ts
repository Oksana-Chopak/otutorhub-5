// Polls Telegram getUpdates and links app users via /start <code>
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendPaymentReminder, normLang } from "../_shared/paymentReminder.ts";
import { versionProbe } from "../_shared/build.ts";
import { withJob } from '../_shared/jobRun.ts'
import { rateLimit } from '../_shared/rateLimit.ts';

const MAX_RUNTIME_MS = 55_000;
const MIN_REMAINING_MS = 5_000;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* 25.10 — ВЕБХУК замість опитування щохвилини.
 *
 * Було: крон стріляв у цю функцію раз на хвилину, і вона тримала довгий
 * getUpdates до 55 с. Наслідки, усі три справжні: кнопки в боті («Нагадати»,
 * «Оплачено») могли чекати до хвилини; два запуски накладались і Telegram
 * віддавав 409 Conflict (той самий збій, що з 30.09 світився в ранковому
 * дайджесті); і кожна хвилина лишала рядок у job_runs.
 *
 * Тепер Telegram стукає САМ, щойно є повідомлення. Крон лишається, але його
 * робота інша: він стежить, що вебхук стоїть і живий, і піднімає його назад,
 * якщо Telegram почав відмовляти (getWebhookInfo показує last_error_message).
 * Опитування лишилось цілим як запасний шлях: якщо setWebhook не вдався, крон
 * того ж запуску опитує по-старому — бот не замовкає ніколи.
 *
 * ВІДКАТ: USE_WEBHOOK = false → наступний запуск крону зніме вебхук
 * (deleteWebhook) і повернеться до опитування. Без SQL і без секретів.
 */
const USE_WEBHOOK = true;

Deno.serve(async (req) => {
  const probe = versionProbe(req, "telegram-poll");
  if (probe) return probe;
  /* Цей заголовок Telegram додає до КОЖНОЇ доставки вебхука (значення — те, що
     ми дали в setWebhook). Є заголовок — прийшов Telegram, а не крон: окрема
     гілка й БЕЗ withJob, інакше кожне повідомлення в боті ставало б рядком
     «запуск процесу» в job_runs і топило б зведення «🛡 Нічні процеси». */
  if (req.headers.get("x-telegram-bot-api-secret-token") !== null) return await webhookRun(req);
  return await withJob("telegram-poll", cronRun)(req);
});

async function cronRun(req: Request): Promise<Response> {
  const startTime = Date.now();
  const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!TELEGRAM_BOT_TOKEN || !supabaseUrl || !supabaseServiceKey) {
    return new Response(JSON.stringify({ error: 'Missing env' }), { status: 500 });
  }
  const auth = req.headers.get('authorization') || req.headers.get('Authorization');
  const provided = auth?.replace(/^Bearer\s+/i, '') || req.headers.get('x-cron-secret');
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data: expected } = await supabase.rpc('get_cron_shared_secret');
  if (!provided || !expected || provided !== expected) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  const TG_BASE = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

  // Оренда (30.09): Telegram дозволяє лише ОДИН getUpdates водночас. Крон стріляє
  // щохвилини, а прогін триває до ~55 с — при затримці на кілька секунд два
  // запуски накладаються, і Telegram відповідає 409 Conflict (перший такий збій
  // побачив дайджест 30.09). Одна оренда на 45 с у базі: другий запуск за цей час
  // чесно каже «зайнято» і виходить успішно — це не збій.
  /* Вебхук — головний шлях. Якщо він стоїть і Telegram на нього не скаржиться,
     опитування цього запуску не потрібне взагалі: виходимо одразу, не чіпаючи
     Telegram getUpdates (він однаково віддав би 409 при живому вебхуку). */
  if (USE_WEBHOOK) {
    const w = await ensureWebhook(TG_BASE, supabaseUrl, String(expected));
    if (w.active) return new Response(JSON.stringify({ ok: true, mode: "webhook", ...w }));
    console.warn("webhook не піднявся, падаю на опитування", w);
  } else {
    // ВІДКАТ: прибрати вебхук і повернутись до опитування.
    try { await fetch(`${TG_BASE}/deleteWebhook`, { method: "POST" }); } catch (e) { console.warn("deleteWebhook failed", e); }
  }

  if ((await rateLimit(supabase, 'telegram_poll_lease', 'bot', 1, 45)) === 'limit') {
    return new Response(JSON.stringify({ ok: true, skipped: 'busy', processed: 0 }));
  }

  const { data: state, error: stateErr } = await supabase
    .from('telegram_bot_state')
    .select('*')   // bot_username з'являється після міграції 20260911120000 — '*' не ламає опитування до неї
    .eq('id', 1)
    .single();

  if (stateErr) return new Response(JSON.stringify({ error: stateErr.message }), { status: 500 });

  let currentOffset = state.update_offset as number;
  let processed = 0;

  // Ім'я бота — в базу (раз), щоб лендінг будував deep-link анонімно
  // (landing_bot_username) замість хардкоду в клієнті. Помилка не блокує опитування.
  if (!(state as { bot_username?: string | null }).bot_username) {
    try {
      const me = await fetch(`${TG_BASE}/getMe`).then((r) => r.json());
      const username = me?.result?.username;
      if (username) await supabase.from('telegram_bot_state').update({ bot_username: username }).eq('id', 1);
    } catch (e) { console.warn('getMe failed', e); }
  }

  while (true) {
    const elapsed = Date.now() - startTime;
    const remainingMs = MAX_RUNTIME_MS - elapsed;
    if (remainingMs < MIN_REMAINING_MS) break;
    const timeout = Math.min(50, Math.floor(remainingMs / 1000) - 5);
    if (timeout < 1) break;

    const resp = await fetch(`${TG_BASE}/getUpdates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offset: currentOffset, timeout, allowed_updates: ['message', 'callback_query'] }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      // 409 = інший getUpdates ще живий (напр., старий ізолят під час передеплою):
      // наступний хвилинний запуск підбере все — це «зайнято», не збій.
      if (resp.status === 409) {
        return new Response(JSON.stringify({ ok: true, skipped: 'conflict', processed, finalOffset: currentOffset }));
      }
      return new Response(JSON.stringify({ error: data }), { status: 502 });
    }
    const updates = data.result ?? [];
    if (updates.length === 0) continue;

    for (const u of updates) {
      if (await processUpdate(TG_BASE, supabase, u,
        { supabaseUrl, serviceKey: supabaseServiceKey, botToken: TELEGRAM_BOT_TOKEN })) processed++;
    }

    const newOffset = Math.max(...updates.map((u: any) => u.update_id)) + 1;
    await supabase
      .from('telegram_bot_state')
      .update({ update_offset: newOffset, updated_at: new Date().toISOString() })
      .eq('id', 1);
    currentOffset = newOffset;
  }

  return new Response(JSON.stringify({ ok: true, processed, finalOffset: currentOffset }));
}

/** Адреса, на яку Telegram стукатиме. Беремо з env, щоб не вшивати проєкт у код. */
function webhookUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/telegram-poll`;
}

/* Піднімає вебхук і стежить, що він живий.
 *
 * Перевстановлюємо лише у двох випадках, щоб не ходити до Telegram даремно:
 *   • адреса не наша (вебхука немає, або лишився чужий/старий);
 *   • Telegram скаржиться, що наша функція відмовляє (401/403 у
 *     last_error_message). Так само самолікується розбіжність секрету після
 *     ротації `cron_shared_secret`: Telegram ще шле старий токен, ми віддаємо
 *     401, він це запам'ятовує — і наступний запуск крону ставить вебхук з
 *     новим токеном. Доставки, відбиті тим часом, Telegram повторює сам.
 */
async function ensureWebhook(TG_BASE: string, supabaseUrl: string, secret: string): Promise<{ active: boolean; action: string; error?: string }> {
  const want = webhookUrl(supabaseUrl);
  try {
    const info = await fetch(`${TG_BASE}/getWebhookInfo`).then((r) => r.json());
    const cur = String(info?.result?.url ?? "");
    const lastErr = String(info?.result?.last_error_message ?? "");
    const rejected = /\b(401|403)\b/.test(lastErr);
    if (cur === want && !rejected) return { active: true, action: "already" };
    const set = await fetch(`${TG_BASE}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: want,
        secret_token: secret,
        allowed_updates: ["message", "callback_query"],
        // false: усе, що Telegram накопичив за час опитування, доїде вебхуком.
        drop_pending_updates: false,
      }),
    }).then((r) => r.json());
    if (set?.ok) return { active: true, action: rejected ? "reset-after-reject" : "set" };
    return { active: false, action: "set-failed", error: String(set?.description ?? "") };
  } catch (e) {
    return { active: false, action: "info-failed", error: String(e) };
  }
}

/* Доставка від Telegram: один апдейт у тілі запиту.
 *
 * Функція публічна (verify_jwt = false), тож єдині двері — секретний заголовок.
 * Невідповідність = 401, а НЕ 200: Telegram повторює невдалу доставку, тож
 * натиснута кнопка не губиться, поки крон не перевстановить вебхук з чинним
 * токеном. Відповідати треба швидко — Telegram чекає, і на таймаут повторює.
 */
async function webhookRun(req: Request): Promise<Response> {
  const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!TELEGRAM_BOT_TOKEN || !supabaseUrl || !supabaseServiceKey) {
    return new Response(JSON.stringify({ error: "Missing env" }), { status: 500 });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data: expected } = await supabase.rpc("get_cron_shared_secret");
  const provided = req.headers.get("x-telegram-bot-api-secret-token");
  if (!expected || !provided || provided !== String(expected)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 401 });
  }

  let u: any;
  try { u = await req.json(); } catch { return new Response(JSON.stringify({ ok: true, skipped: "bad-json" })); }
  const id = Number(u?.update_id);
  if (!Number.isFinite(id)) return new Response(JSON.stringify({ ok: true, skipped: "no-update-id" }));

  /* Та сама доставка може прийти двічі: Telegram повторює, якщо не дочекався
     відповіді, навіть коли робота вже зроблена. Без цього «Оплачено» могло б
     закрити борг двічі. Ключ — update_id, стеля 1 на годину; механізм той
     самий, що в публічних дверях (`rate_limit_check`). */
  if ((await rateLimit(supabase, "telegram_update", String(id), 1, 3600)) === "limit") {
    return new Response(JSON.stringify({ ok: true, skipped: "duplicate", update_id: id }));
  }

  const TG_BASE = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
  try {
    const did = await processUpdate(TG_BASE, supabase, u, { supabaseUrl, serviceKey: supabaseServiceKey, botToken: TELEGRAM_BOT_TOKEN });
    return new Response(JSON.stringify({ ok: true, via: "webhook", processed: did ? 1 : 0, update_id: id }));
  } catch (e) {
    /* 200 попри виняток: інакше Telegram повторює той самий апдейт по колу, а
       причина однаково не в ньому. Слід лишаємо в логах і в error_log через
       withErrorLog вище за стеком. */
    console.error("webhook update failed", id, e);
    return new Response(JSON.stringify({ ok: false, via: "webhook", update_id: id, error: String(e) }), { status: 200 });
  }
}

/** Один апдейт Telegram. ОДНЕ місце обробки для обох шляхів — крону й вебхука,
 *  інакше дві гілки розійдуться, і кнопка, що працює з опитування, тихо
 *  перестане працювати з вебхука. Повертає true, якщо щось справді зробила. */
async function processUpdate(
  TG_BASE: string,
  supabase: any,
  u: any,
  env: { supabaseUrl: string; serviceKey: string; botToken: string },
): Promise<boolean> {
  const supabaseUrl = env.supabaseUrl;
  const supabaseServiceKey = env.serviceKey;
  const TELEGRAM_BOT_TOKEN = env.botToken;
  // ── Кнопки з дайджесту: «Нагадати» / «Оплачено» ──────────────────────
  if (u.callback_query) {
    await handleDigestCallback(TG_BASE, supabase, u.callback_query,
      { supabaseUrl, serviceKey: supabaseServiceKey, botToken: TELEGRAM_BOT_TOKEN });
    return true;
  }
  const msg = u.message;
  if (!msg) return false;
  const text: string = msg.text ?? '';
  const chatId: number = msg.chat.id;
  const fromName = escapeHtml(msg.from?.first_name ?? 'друже');

  const startMatch = text.match(/^\/start(?:\s+(\S+))?/);
  if (startMatch) {
    const code = startMatch[1];
    if (!code) {
      await sendTg(TG_BASE, chatId, `Привіт, ${fromName}! 👋\n\nЩоб отримувати сповіщення з oTutorHub, відкрийте розділ <b>Налаштування → Telegram</b> в апці й натисніть "Підключити Telegram". Скопіюйте отриманий код і надішліть мені:\n\n<code>/start ВАШ_КОД</code>`);
    } else if (/^lh_[0-9a-f]{32}$/i.test(code)) {
      // Дайджест ДО реєстрації (10.09): токен з лендінгу → той самий
      // дайджест сюди + запрошення створити акаунт цим же токеном
      // (тригер attach_landing_handoff прив'яже цей chat_id при реєстрації).
      await handleLandingHandoff(TG_BASE, supabase, code.toLowerCase(), chatId, msg.from?.first_name ?? null);
    } else {
      const codeUp = code.trim().toUpperCase();
      const { data: link } = await supabase
        .from('user_telegram_links')
        .select('user_id, link_code_expires_at')
        .eq('link_code', codeUp)
        .maybeSingle();

      if (!link) {
        await sendTg(TG_BASE, chatId, '❌ Код не знайдено. Згенеруйте новий у застосунку.');
      } else if (link.link_code_expires_at && new Date(link.link_code_expires_at) < new Date()) {
        await sendTg(TG_BASE, chatId, '⌛ Код прострочений. Згенеруйте новий у застосунку.');
      } else {
        await supabase
          .from('user_telegram_links')
          .update({
            chat_id: chatId,
            linked_at: new Date().toISOString(),
            link_code: null,
            link_code_expires_at: null,
          })
          .eq('user_id', link.user_id);
        // 13.10: у мить підключення — користь, а не «Готово!»: перший дайджест
        // із цифрами людини (tutor_snapshot — ті самі предикати, що й у Фінансах).
        await sendTg(TG_BASE, chatId, await linkedWelcome(supabase, link.user_id));
      }
    }
  } else if (text === '/stop' || text === '/unlink') {
    await supabase.from('user_telegram_links').delete().eq('chat_id', chatId);
    await sendTg(TG_BASE, chatId, 'Сповіщення вимкнено. Щоб увімкнути знову — згенеруйте новий код у застосунку.');
  }

  return true;
  return false;
}

/** Перше повідомлення після підключення: репетитору — знімок його справ, учню — що сюди приходитиме. */
async function linkedWelcome(supabase: any, userId: string): Promise<string> {
  const fallback = '✅ Готово! Сюди приходитимуть нагадування про уроки й оплати, домашка та повідомлення від репетитора.';
  try {
    const { data: s } = await (supabase.rpc as any)('tutor_snapshot', { _tutor_id: userId });
    if (!s || !s.is_tutor) return fallback;
    const n = (v: unknown) => Number(v ?? 0);
    const cur = String(s.currency ?? 'UAH');
    const symOf = (c: string) => (c === 'UAH' ? '₴' : c === 'EUR' ? '€' : c === 'USD' ? '$' : c);
    const sym = symOf(cur);
    /* Борг по валютах, як у Фінансах: дві валюти — два числа, ніколи сума
       (15.10). Без розбивки з бази лишається єдине, що є, — debt_sum. */
    const byCur = (s.debt_by_cur && typeof s.debt_by_cur === 'object') ? s.debt_by_cur as Record<string, unknown> : null;
    const debtMoney = (): string => {
      const pairs = Object.entries(byCur ?? {}).filter(([, v]) => Number(v ?? 0) > 0);
      if (pairs.length === 0) return `${Math.round(n(s.debt_sum))} ${sym}`;
      return pairs
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .map(([c, v]) => `${Math.round(Number(v))} ${symOf(c)}`)
        .join(' + ');
    };
    const parts: string[] = [];
    parts.push(`👥 Учнів: <b>${n(s.students)}</b>`);
    parts.push(`📅 Уроків на 7 днів: <b>${n(s.lessons_week)}</b>`);
    if (n(s.debt_lessons) > 0) parts.push(`💳 Чекають оплати: <b>${debtMoney()}</b> за ${n(s.debt_lessons)} ур.`);
    else parts.push('✅ Боргів немає');
    if (n(s.unmarked) > 0) parts.push(`✏️ Без відмітки «проведено»: <b>${n(s.unmarked)}</b>`);
    return [
      '✅ <b>Підключено!</b> Щоранку о 8:00 — твій день: уроки, борги й кнопка «Нагадати» одним дотиком. Ось де ти зараз:',
      '',
      ...parts,
      '',
      n(s.students) === 0
        ? 'Додай першого учня — і завтра вранці тут буде справжній дайджест: https://otutorhub.com/my-students?new=1'
        : 'Відкрити застосунок: https://otutorhub.com/',
    ].join('\n');
  } catch {
    return fallback;
  }
}

async function sendTg(base: string, chatId: number, text: string, extra: Record<string, unknown> = {}) {
  await fetch(`${base}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra }),
  });
}

/* ── Дайджест до реєстрації ─────────────────────────────────────────────────
   Текст дайджесту готує лендінг тим самим кодом, що малює його на екрані, —
   тут лише пересилаємо (escape, бо parse_mode HTML) і додаємо кнопку
   «Створити акаунт» з тим самим токеном. Токен — секрет із 32 hex; чужий або
   прострочений — ввічлива відмова без деталей. */
const LH = {
  uk: {
    expired: "⌛ Посилання застаріло. Поверніться на otutorhub.com, вставте список ще раз і натисніть «Отримати це в Telegram».",
    intro: "Ось ваш дайджест — такий приходитиме щоранку о 07:30:",
    outro: "Хочете отримувати його щодня — з нагадуваннями учням і без ручного вводу? Створіть акаунт за хвилину: список уже всередині, а цей Telegram буде підключено автоматично.",
    btn: "Створити акаунт →",
  },
  en: {
    expired: "⌛ This link has expired. Go back to otutorhub.com, paste your list again and tap “Get this in Telegram”.",
    intro: "Here is your digest — you'd get one like this every morning at 07:30:",
    outro: "Want it daily — with reminders to your students and nothing typed twice? Create an account in a minute: the list is already inside, and this Telegram gets connected automatically.",
    btn: "Create account →",
  },
  sv: {
    expired: "⌛ Länken har gått ut. Gå tillbaka till otutorhub.com, klistra in listan igen och tryck på ”Få detta i Telegram”.",
    intro: "Här är din sammanfattning — en sådan får du varje morgon kl. 07:30:",
    outro: "Vill du ha den dagligen — med påminnelser till eleverna och inget skrivet två gånger? Skapa ett konto på en minut: listan finns redan inne och den här Telegram-chatten kopplas automatiskt.",
    btn: "Skapa konto →",
  },
} as const;

async function handleLandingHandoff(base: string, supabase: any, token: string, chatId: number, firstName: string | null) {
  const { data: h } = await supabase
    .from('landing_handoffs')
    .select('token, digest_text, lang, expires_at, user_id, chat_id')
    .eq('token', token)
    .maybeSingle();
  const lang = (h?.lang === 'en' || h?.lang === 'sv') ? h.lang : 'uk';
  const T = LH[lang as keyof typeof LH];
  if (!h || new Date(h.expires_at) < new Date() || h.user_id) {
    await sendTg(base, chatId, T.expired);
    return;
  }
  // Токен належить тому чату, який відкрив його першим: інший chat_id
  // отримує відмову — список чужих учнів не має розходитись по чатах.
  if (h.chat_id && h.chat_id !== chatId) {
    await sendTg(base, chatId, T.expired);
    return;
  }
  if (!h.chat_id) {
    await supabase
      .from('landing_handoffs')
      .update({ chat_id: chatId, tg_first_name: firstName, claimed_at: new Date().toISOString() })
      .eq('token', token);
  }
  await sendTg(base, chatId, `${escapeHtml(T.intro)}\n\n${escapeHtml(String(h.digest_text))}`);
  const signup = `https://otutorhub.com/auth?signup=1&role=tutor&lh=${encodeURIComponent(token)}`;
  await sendTg(base, chatId, escapeHtml(T.outro), {
    reply_markup: { inline_keyboard: [[{ text: T.btn, url: signup }]] },
  });
}

// Відповіді на кнопки — мовою репетитора (profiles.preferred_language).
const CB = {
  uk: {
    bad: "Незрозуміла дія", nolink: "Telegram не прив’язаний до акаунта",
    nodebt: "Боргів у цього учня вже немає ✅",
    writeFailed: "Не вдалося зберегти — спробуйте ще раз або позначте в застосунку",
    paid: (n: number) => `✅ Позначено оплаченими: ${n} ур. Застосунок уже знає.`,
    remDone: (ch: string[]) => `🔔 Надіслано: ${ch.map((c) => ({ telegram: "Telegram", email: "email", inapp: "застосунок" } as Record<string, string>)[c] ?? c).join(", ")}`,
    remSkip: "Сьогодні вже нагадували — учень отримав. Наступне — через 24 год.",
    remUndelivered: "⚠️ В учня нема Telegram чи пошти. Готовий текст надіслано вам сюди — перешліть у Viber/Telegram.",
    claimConfirmed: "✅ Оплату записано. Учень бачить «підтверджено ✓».",
    claimRejected: "❌ Позначено «не бачу оплати». Учень отримав прохання перевірити переказ.",
    claimAlready: "Цю заявку вже вирішено раніше.",
    nopayout: "Цьому репетитору зараз нічого не винні ✅",
    payoutDone: (n: number, s: number) => `✅ Виплату позначено: ${n} ур., ${s} ₴. Застосунок уже знає.`,
  },
  en: {
    bad: "Unknown action", nolink: "Telegram is not linked to an account",
    nodebt: "This student has no open debts ✅",
    writeFailed: "Could not save — try again or mark it in the app",
    paid: (n: number) => `✅ Marked as paid: ${n} lessons. The app already knows.`,
    remDone: (ch: string[]) => `🔔 Sent via: ${ch.map((c) => ({ telegram: "Telegram", email: "email", inapp: "app" } as Record<string, string>)[c] ?? c).join(", ")}`,
    remSkip: "Already reminded today — the student got it. Next one in 24 h.",
    remUndelivered: "⚠️ The student has no Telegram or email. The ready text was sent to you here — forward it in Viber/Telegram.",
    claimConfirmed: "✅ Payment recorded. The student sees «confirmed ✓».",
    claimRejected: "❌ Marked as «don’t see it». The student was asked to check the transfer.",
    claimAlready: "This claim was already resolved.",
    nopayout: "Nothing is owed to this tutor right now ✅",
    payoutDone: (n: number, s: number) => `✅ Payout recorded: ${n} lessons, ${s} ₴. The app already knows.`,
  },
  sv: {
    bad: "Okänd åtgärd", nolink: "Telegram är inte kopplat till kontot",
    nodebt: "Eleven har inga obetalda lektioner ✅",
    writeFailed: "Kunde inte spara — försök igen eller markera i appen",
    paid: (n: number) => `✅ Markerat som betalt: ${n} lektioner. Appen vet redan.`,
    remDone: (ch: string[]) => `🔔 Skickat via: ${ch.map((c) => ({ telegram: "Telegram", email: "e-post", inapp: "appen" } as Record<string, string>)[c] ?? c).join(", ")}`,
    remSkip: "Redan påmint idag — eleven fick den. Nästa om 24 h.",
    remUndelivered: "⚠️ Eleven har ingen Telegram eller e-post. Den färdiga texten skickades hit — vidarebefordra i Viber/Telegram.",
    claimConfirmed: "✅ Betalningen registrerad. Eleven ser «bekräftad ✓».",
    claimRejected: "❌ Markerad «ser den inte». Eleven ombads kontrollera överföringen.",
    claimAlready: "Denna begäran är redan avgjord.",
    nopayout: "Inget att betala den här läraren just nu ✅",
    payoutDone: (n: number, s: number) => `✅ Utbetalning noterad: ${n} lektioner, ${s} ₴. Appen vet redan.`,
  },
} as const;

async function answerCb(base: string, id: string, text: string) {
  await fetch(`${base}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: id, text, show_alert: false }),
  });
}

/**
 * Дайджест-кнопки. Модель безпеки: РЕПЕТИТОР визначається за chat_id з бази
 * (user_telegram_links), а НЕ з callback_data. У callback_data — лише
 * student_id; будь-який підроблений uuid просто дасть нуль рядків, бо всі
 * запити нижче додатково фільтрують tutor_id = власник chat_id і
 * source = 'independent' (хабові борги закриває менеджер, не бот).
 */
// deno-lint-ignore no-explicit-any
async function handleDigestCallback(base: string, db: any, cq: any,
  env: { supabaseUrl: string; serviceKey: string; botToken: string }) {
  const cqId: string = cq.id;
  const data: string = cq.data ?? '';
  const chatId: number | undefined = cq.message?.chat?.id;
  const m = data.match(/^(rem|paid|hpaid|tpaid):([0-9a-f-]{36})$/);
  const mc = data.match(/^pc:(ok|no):([0-9a-f-]{36})$/);
  if ((!m && !mc) || !chatId) { await answerCb(base, cqId, CB.uk.bad); return; }

  const { data: link } = await db
    .from('user_telegram_links').select('user_id').eq('chat_id', chatId).maybeSingle();
  const tutorId: string | undefined = link?.user_id;
  if (!tutorId) { await answerCb(base, cqId, CB.uk.nolink); return; }
  const { data: tutorProf } = await db.from('profiles').select('preferred_language').eq('id', tutorId).maybeSingle();
  const L = CB[normLang(tutorProf?.preferred_language)];

  // 01.11: «✅ Підтвердити / ❌ Не бачу» під заявкою «Я оплатив(ла)». Актор —
  // власник chat_id; право (сам репетитор чи менеджер школи) перевіряє база в
  // resolve_payment_claim; гроші йдуть тим самим канонічним шляхом (гаманець
  // пари → автозакриття боргу), жодної другої грошової логіки.
  if (mc) {
    const confirm = mc[1] === 'ok'; const claimId = mc[2];
    const { data: res, error } = await (db.rpc as any)('resolve_payment_claim_as', { _id: claimId, _confirm: confirm, _actor: tutorId });
    if (error) { console.error('telegram-poll resolve claim', error.message); await answerCb(base, cqId, L.writeFailed); return; }
    const reason = String(res?.reason ?? '');
    if (res?.ok) {
      await answerCb(base, cqId, confirm ? L.claimConfirmed : L.claimRejected);
      // Кнопки прибираємо — другий дотик нічого не змінює.
      await fetch(`${base}/editMessageReplyMarkup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: cq.message?.message_id, reply_markup: { inline_keyboard: [] } }),
      }).catch(() => {});
      return;
    }
    await answerCb(base, cqId, reason.startsWith('already_') ? L.claimAlready : L.writeFailed);
    return;
  }
  const action = m![1]; const studentId = m![2];

  // 07.09: «✅ оплатив(ла)» у дайджесті МЕНЕДЖЕРА — закриває ХАБОВІ борги учня
  // (source ≠ independent) по всіх репетиторах школи. Право: власник chat_id
  // мусить мати роль manager (user_roles) — це той самий, хто робить це в
  // застосунку. Незалежні борги тут не чіпаються (їх закриває сам репетитор).
  if (action === 'hpaid') {
    const { data: roleRow } = await db
      .from('user_roles').select('role').eq('user_id', tutorId).eq('role', 'manager').maybeSingle();
    if (!roleRow) { await answerCb(base, cqId, L.bad); return; }
    // Модель «школа = сутність» (07.09): закриваємо лише уроки репетиторів
    // ШКОЛИ цього менеджера. До застосування етапу A (таблиці ще немає) —
    // усе хабове, як раніше.
    const { data: hm, error: hubErr } = await db
      .from('hub_managers').select('hub_id').eq('user_id', tutorId).maybeSingle();
    let hubTutorIds: string[] | null = null; // null = hub-модель ще не застосована
    if (!hubErr) {
      if (!hm?.hub_id) { await answerCb(base, cqId, L.bad); return; }
      const { data: hubTutors } = await db
        .from('tutor_workspace_settings').select('tutor_id').eq('hub_id', hm.hub_id);
      const ids = (hubTutors ?? []).map((t: any) => t.tutor_id as string);
      hubTutorIds = ids;
      if (ids.length === 0) { await answerCb(base, cqId, L.nodebt); return; }
    }
    const inHub = (q: any) => (hubTutorIds ? q.in('tutor_id', hubTutorIds) : q);
    const { data: hubIndiv } = await inHub(db
      .from('lessons')
      .select('id, status, lesson_details(student_price, student_payment_status, is_cancellation_fee)')
      .eq('student_id', studentId).neq('source', 'independent')
      .is('group_id', null).in('status', ['completed', 'cancelled']));
    const hubIndivIds: string[] = (hubIndiv ?? []).filter((l: any) => {
      const d = Array.isArray(l.lesson_details) ? l.lesson_details[0] : l.lesson_details;
      if (!d || (d.student_payment_status ?? 'unpaid') !== 'unpaid') return false;
      if (Number(d.student_price ?? 0) <= 0) return false;
      if (l.status === 'cancelled') return d.is_cancellation_fee === true;
      return true; // completed
    }).map((l: any) => l.id as string);
    const { data: hubGrp } = await inHub(db
      .from('lessons').select('id')
      .neq('source', 'independent').not('group_id', 'is', null).eq('status', 'completed'));
    const hubGrpIds: string[] = (hubGrp ?? []).map((l: any) => l.id);
    let hubPartIds: string[] = [];
    if (hubGrpIds.length) {
      const { data: parts } = await db
        .from('lesson_participants').select('id')
        .in('lesson_id', hubGrpIds).eq('student_id', studentId)
        .eq('student_payment_status', 'unpaid').gt('student_price', 0);
      hubPartIds = (parts ?? []).map((p: any) => p.id);
    }
    const hubTotal = hubIndivIds.length + hubPartIds.length;
    if (hubTotal === 0) { await answerCb(base, cqId, L.nodebt); return; }
    const now = new Date().toISOString();
    // 18.09: жодне з цих оновлень не читало error, а нижче людині одразу
    // відповідали «Позначено оплаченими: N». Тобто при збої менеджер бачив у
    // Telegram зелене підтвердження, а в застосунку ті самі уроки далі висіли
    // боргом — і він більше не перевіряв. Тепер збій каже про себе словами.
    let wrote = true;
    if (hubIndivIds.length) {
      const { error } = await db.from('lesson_details')
        .update({ student_payment_status: 'paid', student_paid_at: now })
        .in('lesson_id', hubIndivIds).eq('student_payment_status', 'unpaid');
      if (error) { console.error('telegram-poll hpaid lesson_details', error.message); wrote = false; }
    }
    if (hubPartIds.length) {
      const { error } = await db.from('lesson_participants')
        .update({ student_payment_status: 'paid', student_paid_at: now })
        .in('id', hubPartIds).eq('student_payment_status', 'unpaid');
      if (error) { console.error('telegram-poll hpaid lesson_participants', error.message); wrote = false; }
    }
    if (!wrote) { await answerCb(base, cqId, L.writeFailed); return; }
    await db.from('manager_audit_log').insert({
      actor_id: tutorId, action: 'mark_paid_via_telegram', entity_type: 'student_debt', entity_id: studentId,
      before: { unpaid_lessons: hubIndivIds, unpaid_participants: hubPartIds, scope: 'hub', hub_id: hm?.hub_id ?? null },
      after: { status: 'paid', source: 'telegram_digest_button_manager', chat_id: chatId },
    });
    await answerCb(base, cqId, L.paid(hubTotal));
    return;
  }

  // 13.09: «👛 Виплатив(ла)» у дайджесті МЕНЕДЖЕРА — позначає виплаченими
  // проведені неоплачені уроки ОДНОГО репетитора своєї школи (callback_data —
  // tutor_id). Дзеркало RPC mark_tutor_payouts_paid (там auth.uid() під service
  // role порожній, тому право перевіряємо тут: власник chat_id = manager, а
  // репетитор — у ЙОГО школі). Свідома відмінність від RPC: чіпаємо лише рядки
  // зі ставкою > 0 — саме ті, що складають показану суму; уроки без ставки
  // лишаються unpaid, щоб backfill після встановлення ставки їх підхопив.
  if (action === 'tpaid') {
    const targetTutorId = studentId; // у tpaid: другий сегмент — id репетитора
    const { data: roleRow } = await db
      .from('user_roles').select('role').eq('user_id', tutorId).eq('role', 'manager').maybeSingle();
    if (!roleRow) { await answerCb(base, cqId, L.bad); return; }
    const { data: hm } = await db
      .from('hub_managers').select('hub_id').eq('user_id', tutorId).maybeSingle();
    if (!hm?.hub_id) { await answerCb(base, cqId, L.bad); return; }
    const { data: member } = await db
      .from('tutor_workspace_settings').select('tutor_id').eq('tutor_id', targetTutorId).eq('hub_id', hm.hub_id).maybeSingle();
    if (!member) { await answerCb(base, cqId, L.bad); return; }
    const { data: rows } = await db
      .from('lessons')
      .select('id, status, starts_at, lesson_details(tutor_payout, tutor_payout_status)')
      .eq('tutor_id', targetTutorId).neq('source', 'independent').is('group_id', null)
      .in('status', ['completed', 'scheduled']);
    const nowMs = Date.now();
    let sum = 0;
    const ids: string[] = (rows ?? []).filter((l: any) => {
      const d = Array.isArray(l.lesson_details) ? l.lesson_details[0] : l.lesson_details;
      if (!d || d.tutor_payout_status === 'paid') return false;
      if (Number(d.tutor_payout ?? 0) <= 0) return false;
      if (!(l.status === 'completed' || new Date(l.starts_at).getTime() <= nowMs)) return false;
      sum += Number(d.tutor_payout);
      return true;
    }).map((l: any) => l.id as string);
    if (ids.length === 0) { await answerCb(base, cqId, L.nopayout); return; }
    const now = new Date().toISOString();
    /* 01.10: гілку «👛 Виплатив(ла)» (13.09) не зачепила правка 18.09 для
       сусідньої гілки боргів — тут `error` не читався, а нижче менеджеру одразу
       відповідали «✅ Виплату позначено… Застосунок уже знає». При збої він бачив
       зелене підтвердження, репетитор лишався невиплаченим у журналі, і наступне
       нагадування виставляло ті самі гроші знову. Той самий спосіб, що в гілці
       `hpaid`: спершу довести запис, потім святкувати. */
    let wrote = true;
    {
      const { error } = await db.from('lesson_details')
        .update({ tutor_payout_status: 'paid', tutor_paid_at: now })
        .in('lesson_id', ids).or('tutor_payout_status.is.null,tutor_payout_status.neq.paid'); // NULL = unpaid (COALESCE у RPC)
      if (error) { console.error('telegram-poll tpaid lesson_details', error.message); wrote = false; }
    }
    if (!wrote) { await answerCb(base, cqId, L.writeFailed); return; }
    {
      const { error } = await db.from('tutor_details').update({ payout_last_marked_at: now }).eq('user_id', targetTutorId);
      // Дата останньої позначки — службова: її збій не скасовує саму виплату,
      // але мовчати про нього не можна (наступне нагадування прийде зарано).
      if (error) console.error('telegram-poll tpaid payout_last_marked_at', error.message);
    }
    await db.from('manager_audit_log').insert({
      actor_id: tutorId, action: 'mark_payout_paid_via_telegram', entity_type: 'tutor_payout', entity_id: targetTutorId,
      before: { unpaid_lessons: ids, sum, hub_id: hm.hub_id },
      after: { status: 'paid', source: 'telegram_digest_button_manager', chat_id: chatId },
    });
    await answerCb(base, cqId, L.payoutDone(ids.length, sum));
    return;
  }

  // Борги цієї пари — індивідуальні (lesson_details) і групові (participants)
  const { data: indiv } = await db
    .from('lessons')
    .select('id, status, subject, starts_at, lesson_details(student_price, student_payment_status, is_cancellation_fee)')
    .eq('tutor_id', tutorId).eq('student_id', studentId).eq('source', 'independent')
    .is('group_id', null).in('status', ['completed', 'scheduled', 'cancelled']);
  const indivRows = (indiv ?? []).filter((l: any) => {
    const d = Array.isArray(l.lesson_details) ? l.lesson_details[0] : l.lesson_details;
    if (!d || (d.student_payment_status ?? 'unpaid') !== 'unpaid') return false;
    if (Number(d.student_price ?? 0) <= 0) return false;
    if (l.status === 'cancelled') return d.is_cancellation_fee === true;
    return true;
  }).map((l: any) => {
    const d = Array.isArray(l.lesson_details) ? l.lesson_details[0] : l.lesson_details;
    return { id: l.id as string, subject: l.subject ?? null, starts_at: l.starts_at as string, student_price: Number(d.student_price ?? 0) };
  });
  const indivIds: string[] = indivRows.map((r: any) => r.id);

  const { data: grp } = await db
    .from('lessons').select('id, subject, starts_at')
    .eq('tutor_id', tutorId).eq('source', 'independent')
    .not('group_id', 'is', null).in('status', ['completed', 'scheduled']);
  const grpLessonIds: string[] = (grp ?? []).map((l: any) => l.id);
  let grpPartIds: string[] = [];
  let grpLessonsForStudent: { id: string; subject: string | null; starts_at: string; student_price: number }[] = [];
  if (grpLessonIds.length) {
    const { data: parts } = await db
      .from('lesson_participants').select('id, lesson_id, student_price')
      .in('lesson_id', grpLessonIds).eq('student_id', studentId)
      .eq('student_payment_status', 'unpaid').gt('student_price', 0);
    grpPartIds = (parts ?? []).map((p: any) => p.id);
    const wanted = new Set((parts ?? []).map((p: any) => p.lesson_id));
    const priceOf = new Map((parts ?? []).map((p: any) => [p.lesson_id, Number(p.student_price ?? 0)]));
    grpLessonsForStudent = (grp ?? []).filter((l: any) => wanted.has(l.id))
      .map((l: any) => ({ id: l.id, subject: l.subject ?? null, starts_at: l.starts_at, student_price: priceOf.get(l.id) ?? 0 }));
  }
  const total = indivIds.length + grpPartIds.length;

  if (action === 'paid') {
    if (total === 0) { await answerCb(base, cqId, L.nodebt); return; }
    const now = new Date().toISOString();
    let wrote = true;
    if (indivIds.length) {
      const { error } = await db.from('lesson_details')
        .update({ student_payment_status: 'paid', student_paid_at: now })
        .in('lesson_id', indivIds).eq('student_payment_status', 'unpaid');
      if (error) { console.error('telegram-poll paid lesson_details', error.message); wrote = false; }
    }
    if (grpPartIds.length) {
      const { error } = await db.from('lesson_participants')
        .update({ student_payment_status: 'paid', student_paid_at: now })
        .in('id', grpPartIds).eq('student_payment_status', 'unpaid');
      if (error) { console.error('telegram-poll paid lesson_participants', error.message); wrote = false; }
    }
    if (!wrote) { await answerCb(base, cqId, L.writeFailed); return; }
    // T4: зміна платіжного статусу з Telegram лишає слід — хто, звідки, що саме.
    await db.from('manager_audit_log').insert({
      actor_id: tutorId, action: 'mark_paid_via_telegram', entity_type: 'student_debt', entity_id: studentId,
      before: { unpaid_lessons: indivIds, unpaid_participants: grpPartIds },
      after: { status: 'paid', source: 'telegram_digest_button', chat_id: chatId },
    });
    await answerCb(base, cqId, L.paid(total));
    return;
  }

  // action === 'rem' — через спільне ядро: 24-годинна дедуплікація за
  // lesson_payment_reminders, три канали, мова учня, лог для крона.
  if (total === 0) { await answerCb(base, cqId, L.nodebt); return; }
  const res = await sendPaymentReminder({
    admin: db, supabaseUrl: env.supabaseUrl, serviceKey: env.serviceKey, botToken: env.botToken,
    tutorId, studentId, kind: 'telegram_button',
    // Групові уроки нагадуємо через parent-урок: беремо ті, де є борг цього учня.
    lessons: [...indivRows, ...grpLessonsForStudent],
  });
  if (res.undelivered) { await answerCb(base, cqId, L.remUndelivered); return; }
  await answerCb(base, cqId, res.sent === 0 ? L.remSkip : L.remDone(res.channels));
}
