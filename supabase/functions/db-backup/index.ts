import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
 * Виклик: pg_cron щоночі (див. міграцію 20260905200000) або вручну з
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
] as const;

const PAGE = 1000;
const RETENTION_DAYS = 30;
const BUCKET = "db-backups";

Deno.serve(async (req) => {
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

  for (const table of TABLES) {
    const rows: unknown[] = [];
    try {
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from(table)
          .select("*")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < PAGE) break;
        // Запобіжник від нескінченного циклу на дуже великих таблицях:
        // 200k рядків на таблицю вистачає з величезним запасом до 4000 підписників.
        if (rows.length >= 200_000) break;
      }
      dump[table] = rows;
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
    row_counts: Object.fromEntries(Object.entries(dump).map(([k, v]) => [k, v.length])),
    data: dump,
  };

  // gzip через вбудований CompressionStream (Deno).
  const jsonBytes = new TextEncoder().encode(JSON.stringify(payload));
  const gzStream = new Blob([jsonBytes]).stream().pipeThrough(new CompressionStream("gzip"));
  const gzBytes = new Uint8Array(await new Response(gzStream).arrayBuffer());

  const day = startedAt.toISOString().slice(0, 10); // YYYY-MM-DD
  const path = `backup-${day}.json.gz`;
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
      retention_removed: removed,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
