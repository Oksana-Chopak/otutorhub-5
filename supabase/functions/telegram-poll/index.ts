// Polls Telegram getUpdates and links app users via /start <code>
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendPaymentReminder, normLang } from "../_shared/paymentReminder.ts";

const MAX_RUNTIME_MS = 55_000;
const MIN_REMAINING_MS = 5_000;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

Deno.serve(async (req) => {
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
      return new Response(JSON.stringify({ error: data }), { status: 502 });
    }
    const updates = data.result ?? [];
    if (updates.length === 0) continue;

    for (const u of updates) {
      // ── Кнопки з дайджесту: «Нагадати» / «Оплачено» ──────────────────────
      if (u.callback_query) {
        await handleDigestCallback(TG_BASE, supabase, u.callback_query,
          { supabaseUrl, serviceKey: supabaseServiceKey, botToken: TELEGRAM_BOT_TOKEN });
        processed++;
        continue;
      }
      const msg = u.message;
      if (!msg) continue;
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
            await sendTg(TG_BASE, chatId, '✅ Готово! Я надсилатиму вам сповіщення про нові повідомлення в чатах oTutorHub.');
          }
        }
      } else if (text === '/stop' || text === '/unlink') {
        await supabase.from('user_telegram_links').delete().eq('chat_id', chatId);
        await sendTg(TG_BASE, chatId, 'Сповіщення вимкнено. Щоб увімкнути знову — згенеруйте новий код у застосунку.');
      }

      processed++;
    }

    const newOffset = Math.max(...updates.map((u: any) => u.update_id)) + 1;
    await supabase
      .from('telegram_bot_state')
      .update({ update_offset: newOffset, updated_at: new Date().toISOString() })
      .eq('id', 1);
    currentOffset = newOffset;
  }

  return new Response(JSON.stringify({ ok: true, processed, finalOffset: currentOffset }));
});

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
    paid: (n: number) => `✅ Позначено оплаченими: ${n} ур. Застосунок уже знає.`,
    remDone: (ch: string[]) => `🔔 Надіслано: ${ch.map((c) => ({ telegram: "Telegram", email: "email", inapp: "застосунок" } as Record<string, string>)[c] ?? c).join(", ")}`,
    remSkip: "Сьогодні вже нагадували — учень отримав. Наступне — через 24 год.",
  },
  en: {
    bad: "Unknown action", nolink: "Telegram is not linked to an account",
    nodebt: "This student has no open debts ✅",
    paid: (n: number) => `✅ Marked as paid: ${n} lessons. The app already knows.`,
    remDone: (ch: string[]) => `🔔 Sent via: ${ch.map((c) => ({ telegram: "Telegram", email: "email", inapp: "app" } as Record<string, string>)[c] ?? c).join(", ")}`,
    remSkip: "Already reminded today — the student got it. Next one in 24 h.",
  },
  sv: {
    bad: "Okänd åtgärd", nolink: "Telegram är inte kopplat till kontot",
    nodebt: "Eleven har inga obetalda lektioner ✅",
    paid: (n: number) => `✅ Markerat som betalt: ${n} lektioner. Appen vet redan.`,
    remDone: (ch: string[]) => `🔔 Skickat via: ${ch.map((c) => ({ telegram: "Telegram", email: "e-post", inapp: "appen" } as Record<string, string>)[c] ?? c).join(", ")}`,
    remSkip: "Redan påmint idag — eleven fick den. Nästa om 24 h.",
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
  const m = data.match(/^(rem|paid|hpaid):([0-9a-f-]{36})$/);
  if (!m || !chatId) { await answerCb(base, cqId, CB.uk.bad); return; }
  const action = m[1]; const studentId = m[2];

  const { data: link } = await db
    .from('user_telegram_links').select('user_id').eq('chat_id', chatId).maybeSingle();
  const tutorId: string | undefined = link?.user_id;
  if (!tutorId) { await answerCb(base, cqId, CB.uk.nolink); return; }
  const { data: tutorProf } = await db.from('profiles').select('preferred_language').eq('id', tutorId).maybeSingle();
  const L = CB[normLang(tutorProf?.preferred_language)];

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
    if (hubIndivIds.length) {
      await db.from('lesson_details')
        .update({ student_payment_status: 'paid', student_paid_at: now })
        .in('lesson_id', hubIndivIds).eq('student_payment_status', 'unpaid');
    }
    if (hubPartIds.length) {
      await db.from('lesson_participants')
        .update({ student_payment_status: 'paid', student_paid_at: now })
        .in('id', hubPartIds).eq('student_payment_status', 'unpaid');
    }
    await db.from('manager_audit_log').insert({
      actor_id: tutorId, action: 'mark_paid_via_telegram', entity_type: 'student_debt', entity_id: studentId,
      before: { unpaid_lessons: hubIndivIds, unpaid_participants: hubPartIds, scope: 'hub', hub_id: hm?.hub_id ?? null },
      after: { status: 'paid', source: 'telegram_digest_button_manager', chat_id: chatId },
    });
    await answerCb(base, cqId, L.paid(hubTotal));
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
    if (indivIds.length) {
      await db.from('lesson_details')
        .update({ student_payment_status: 'paid', student_paid_at: now })
        .in('lesson_id', indivIds).eq('student_payment_status', 'unpaid');
    }
    if (grpPartIds.length) {
      await db.from('lesson_participants')
        .update({ student_payment_status: 'paid', student_paid_at: now })
        .in('id', grpPartIds).eq('student_payment_status', 'unpaid');
    }
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
  await answerCb(base, cqId, res.sent === 0 ? L.remSkip : L.remDone(res.channels));
}
