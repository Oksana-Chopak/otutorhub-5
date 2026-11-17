import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withJob } from "../_shared/jobRun.ts";

/**
 * Щоденний бекап критичних таблиць у ПРИВАТНИЙ бакет db-backups (рішення 05.09,
 * пункт 8 премортему: платформні ризики).
 *
 * ЧОМУ ТАК: у власниці немає прямого доступу до Supabase-консолі (усе через
 * Lovable), тож розраховувати на ручні дампи не можна. Ця функція знімає
 * повний JSON-знімок бізнес-даних щоночі, кладе його gzip-ом у приватний
 * Storage-бакет того САМОГО проєкту і тримає 30 останніх копій. Це страховка
 * від людської/агентської помилки (DELETE без WHERE, крива міграція) — тобто
 * від найімовірнішого сценарію втрати; від падіння самого Supabase вона не
 * рятує (для цього лишається їхній інфраструктурний бекап).
 *
 * Виклик: pg_cron щоночі (див. міграцію 20260909200000) або вручну з
 * заголовком Authorization: Bearer <cron shared secret> — та сама схема
 * авторизації, що в lesson-reminders.
 */

// Бізнес-дані. СВІДОМО без логів/сповіщень (шумні й відновні) і без
// auth.users (керується Supabase Auth; email-звʼязок є в profiles).
const TABLES = [
  "profiles",
  "profile_contacts",
  "profile_financial_contacts",
  "user_roles",
  "platform_admins",
  "tutor_workspace_settings",
  "tutor_details",
  "tutor_subject_rates",
  "tutor_student_defaults",
  "student_rates",
  "student_details",
  "lessons",
  "lesson_details",
  "lesson_groups",
  "group_enrollments",
  "lesson_participants",
  "student_wallet_transactions",
  "chat_threads",
  "chat_messages",
  "liqpay_payments",
  "referrals",
  "tutor_streaks",
  "tutor_badges",
  "user_telegram_links",
  /* 17.11 — СЛІПА ЗОНА: список складено 05.09 і відтоді не поповнювався, а таблиць стало
     втричі більше. У бекап не потрапляла ВСЯ модель школи (hubs / hub_managers / hub_members),
     посилання й заявки на оплату, запити учнів, нотатки, доступні години, словник предметів,
     відписки від розсилок. Після «DELETE без WHERE» це було б невідновно. Нижче — усе, що є
     бізнес-даними; те, що свідомо НЕ бекапиться, названо в NOT_BACKED_UP з причиною, і
     `backup-coverage.test.ts` падає, якщо зʼявиться таблиця, якої немає в жодному зі списків. */
  "hubs",
  "hub_managers",
  "hub_members",
  "hub_join_invites",
  "hub_leads",
  "tutor_student_pairs",
  "payment_links",
  "payment_claims",
  "lesson_change_requests",
  "lesson_feedback",
  "lesson_attachments",
  "lesson_tutor_notes",
  "lesson_reminders",
  "lesson_payment_reminders",
  "lifecycle_messages",
  "homework_done",
  "manager_notes",
  "manager_audit_log",
  "tutor_notes",
  "tutor_student_notes",
  "tutor_availability_weekly",
  "tutor_availability_overrides",
  "availability_requests",
  "tutor_referral_requests",
  "subscription_requests",
  "feedback_submissions",
  "student_intake_quiz",
  "student_rewards",
  "pro_bonus_ledger",
  "referral_codes",
  "subjects",
  "subject_canon",
  "feature_flags",
  "chat_reads",
  "chat_message_attachments",
  "chat_message_reactions",
  "marketing_campaigns",
  "marketing_unsubscribes",
  "marketing_unsubscribe_tokens",
  "email_unsubscribe_tokens",
  "suppressed_emails",
] as const;

/** Свідомо НЕ в бекапі: назва → чому. Нова таблиця мусить стати або в TABLES, або сюди. */
export const NOT_BACKED_UP: Record<string, string> = {
  ai_calls: "журнал викликів AI, живе 90 днів",
  app_events: "події аналітики продукту — відновні з поведінки, не дані людей",
  paywall_events: "події аналітики пейволу",
  landing_funnel_daily: "добові лічильники лендінгу",
  landing_handoffs: "естафета з лендінгу, живе годину",
  error_log: "журнал помилок",
  job_runs: "журнал запусків кронів, живе 30 днів",
  rate_limit_hits: "лічильники частоти, живуть добу",
  email_send_log: "журнал листів",
  email_send_state: "службовий стан черги листів",
  notifications: "дзвіночок: шумні й відновні, сам урок і гроші — у своїх таблицях",
  tutor_daily_digests: "журнал надісланих дайджестів",
  telegram_bot_state: "зсув бота — після відновлення виставляється сам",
  device_push_tokens: "пристрій реєструється заново при відкритті застосунку",
  push_subscriptions: "браузер підписується заново при відкритті застосунку",
  google_calendar_tokens: "секрети доступу до календаря — не тримаємо копій; людина підключає календар заново",
  google_oauth_exchange_codes: "одноразові коди, живуть хвилини",
  pending_invite_tokens: "одноразові ключі запрошень — запрошення надсилається заново",
};

const PAGE = 1000;
/**
 * Первинний ключ таблиць, де він не `id` — ним упорядковуються сторінки читання.
 * Тест `backup-coverage` звіряє: кожна таблиця з `TABLES` або має колонку `id` у `types.ts`,
 * або записана тут, і кожна колонка звідси справді є в таблиці.
 */
export const ORDER_KEY: Record<string, string[]> = {
  chat_message_reactions: ["message_id", "user_id", "emoji"],
  feature_flags: ["key"],
  homework_done: ["lesson_id", "student_id"],
  hub_managers: ["hub_id", "user_id"],
  hub_members: ["hub_id", "user_id"],
  lesson_details: ["lesson_id"],
  lesson_tutor_notes: ["lesson_id"],
  marketing_unsubscribe_tokens: ["token"],
  marketing_unsubscribes: ["email"],
  platform_admins: ["user_id"],
  profile_contacts: ["user_id"],
  profile_financial_contacts: ["user_id"],
  student_details: ["user_id"],
  subject_canon: ["norm"],
  tutor_details: ["user_id"],
  tutor_streaks: ["tutor_id"],
  tutor_student_notes: ["tutor_id", "student_id"],
  tutor_student_pairs: ["tutor_id", "student_id"],
  tutor_workspace_settings: ["tutor_id"],
};

const RETENTION_DAYS = 30;
const BUCKET = "db-backups";

Deno.serve(withJob("db-backup", async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Missing env" }), { status: 500 });
  }
  // Той самий гейт, що в lesson-reminders: тільки крон/довірений виклик.
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  const provided = auth?.replace(/^Bearer\s+/i, "") || req.headers.get("x-cron-secret");
  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: expected } = await supabase.rpc("get_cron_shared_secret");
  if (!provided || !expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  const startedAt = new Date();
  const dump: Record<string, unknown[]> = {};
  const skipped: Record<string, string> = {};
  const mismatched: Record<string, string> = {};

  for (const table of TABLES) {
    const rows: unknown[] = [];
    try {
      for (let from = 0; ; from += PAGE) {
        // 17.11: сторінки БЕЗ порядку база може віддати з перекриттям — у таблиці понад 1000
        // рядків частина рядків потрапила б у копію двічі, а частина не потрапила б узагалі.
        // Порядок — за первинним ключем таблиці (`ORDER_KEY`, типово `id`).
        let q = supabase.from(table).select("*");
        for (const col of ORDER_KEY[table] ?? ["id"]) q = q.order(col, { ascending: true });
        const { data, error } = await q.range(from, from + PAGE - 1);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < PAGE) break;
        // Запобіжник від нескінченного циклу на дуже великих таблицях:
        // 200k рядків на таблицю вистачає з величезним запасом до 4000 підписників.
        if (rows.length >= 200_000) break;
      }
      dump[table] = rows;
      // Звірка з базою: скільки рядків у таблиці насправді. Розбіжність лягає у сам файл і у
      // відповідь функції (її читає нічний нагляд) — копія не видає себе за повну.
      const { count, error: cntErr } = await supabase.from(table).select("*", { count: "exact", head: true });
      if (!cntErr && typeof count === "number" && Math.abs(count - rows.length) > Math.max(5, Math.round(count * 0.01))) {
        mismatched[table] = `у базі ${count}, у копії ${rows.length}`;
      }
    } catch (e) {
      // Одна зникла/перейменована таблиця не має валити ВЕСЬ бекап —
      // фіксуємо пропуск у самому файлі, він видимий при перевірці.
      skipped[table] = e instanceof Error ? e.message : String(e);
    }
  }

  const payload = {
    exported_at: startedAt.toISOString(),
    project: "otutorhub",
    tables_included: Object.keys(dump),
    tables_skipped: skipped,
    tables_row_mismatch: mismatched,
    row_counts: Object.fromEntries(Object.entries(dump).map(([k, v]) => [k, v.length])),
    data: dump,
  };

  // gzip через вбудований CompressionStream (Deno).
  const jsonBytes = new TextEncoder().encode(JSON.stringify(payload));
  const gzStream = new Blob([jsonBytes]).stream().pipeThrough(new CompressionStream("gzip"));
  const gzBytes = new Uint8Array(await new Response(gzStream).arrayBuffer());

  const day = startedAt.toISOString().slice(0, 10); // YYYY-MM-DD
  const path = `backup-${day}.json.gz`;

  // 11.09: бакет створюємо САМІ, якщо його немає. Причина конкретна: рядок
  // `INSERT INTO storage.buckets` з міграції Lovable мовчки не переніс (його
  // рушій, схоже, не пише у storage.*), тож розклад був живий, а куди класти
  // файл — ні. О 23:45 це впало б у 500 і ніхто б не дізнався. Тепер бекап
  // самодостатній: privacy лишається — бакет ПРИВАТНИЙ (public: false).
  const { error: bucketErr } = await supabase.storage.createBucket(BUCKET, { public: false });
  // "already exists" — нормальний щоденний шлях, не помилка.
  if (bucketErr && !/exist/i.test(bucketErr.message)) {
    return new Response(JSON.stringify({ error: `bucket failed: ${bucketErr.message}` }), { status: 500 });
  }

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, gzBytes, { contentType: "application/gzip", upsert: true });
  if (upErr) {
    return new Response(JSON.stringify({ error: `upload failed: ${upErr.message}` }), { status: 500 });
  }

  // Ретенція: все старше 30 днів — геть (імена детерміновані, тож по імені).
  let removed = 0;
  const { data: files } = await supabase.storage.from(BUCKET).list("", { limit: 1000 });
  if (files) {
    const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
    const stale = files
      .filter((f) => {
        const m = /^backup-(\d{4}-\d{2}-\d{2})\.json\.gz$/.exec(f.name);
        return m ? new Date(m[1]).getTime() < cutoff : false;
      })
      .map((f) => f.name);
    if (stale.length) {
      const { error: delErr } = await supabase.storage.from(BUCKET).remove(stale);
      if (!delErr) removed = stale.length;
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      file: path,
      bytes: gzBytes.length,
      tables: Object.keys(dump).length,
      rows: Object.values(payload.row_counts).reduce((a, b) => a + (b as number), 0),
      skipped,
      // лічильники для нічного нагляду: «пропущено таблиць» і «копія розійшлась із базою»
      tables_skipped: Object.keys(skipped).length,
      tables_mismatched: Object.keys(mismatched).length,
      mismatched,
      retention_removed: removed,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}));
