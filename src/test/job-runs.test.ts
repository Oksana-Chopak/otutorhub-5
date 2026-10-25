import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * «Мертвий вимикач» (27.09). pg_cron кличе edge-функції через net.http_post
 * «вистрелив і забув», логів Supabase не бачить ніхто — тож упалий дайджест,
 * нагадування чи бекап були невидимі. Кожна cron-функція обгорнута withJob →
 * рядок у job_runs → рядок у ранковому дайджесті суперадміна.
 */

const CRON_FUNCTIONS = [
  "payment-reminders", "payout-reminders", "lesson-reminders", "tutor-daily-digest",
  "tutor-evening-summary", "tutor-weekly-digest", "scheduled-notifications", "db-backup",
  "fireflies-auto-join", "archive-old-chats", "process-email-queue",
  "lifecycle-nudges",
];

describe("кожна cron-функція лишає слід у job_runs", () => {
  for (const fn of CRON_FUNCTIONS) {
    it(`${fn}: Deno.serve(withJob("${fn}", …))`, () => {
      const s = noComments(read(`supabase/functions/${fn}/index.ts`));
      expect(s).toMatch(/from ['"]\.\.\/_shared\/jobRun\.ts['"]/);
      expect(s).toMatch(new RegExp(`Deno\\.serve\\(withJob\\("${fn}", async \\(req(: Request)?\\) => \\{`));
      expect(s).toMatch(/^\}\)\);?$/m);
    });
  }

  /* telegram-poll — єдиний виняток за ФОРМОЮ, не за суттю (25.10). Відколи
     Telegram стукає вебхуком, у функції два входи. Крон так само обгорнутий
     withJob і так само лишає рядок у job_runs — зведення «🛡 Нічні процеси»
     бачить його, як бачило. А доставка вебхука НЕ запис: інакше кожне
     повідомлення в боті ставало б «запуском нічного процесу» і втопило б
     справжні процеси, тобто зламало б саме те, для чого мертвий вимикач є. */
  it("telegram-poll: крон обгорнутий withJob, доставка вебхука — ні", () => {
    const s = noComments(read("supabase/functions/telegram-poll/index.ts"));
    expect(s).toMatch(/from ['"]\.\.\/_shared\/jobRun\.ts['"]/);
    expect(s, "крон усе ще під withJob").toMatch(/withJob\("telegram-poll", cronRun\)\(req\)/);
    expect(s, "вебхук має власну гілку").toMatch(/return await webhookRun\(req\);/);
    const disp = s.slice(s.indexOf("Deno.serve(async (req)"));
    expect(
      disp.indexOf("webhookRun(req)") < disp.indexOf('withJob("telegram-poll"'),
      "гілка вебхука стоїть ДО withJob, інакше доставки писались би як запуски",
    ).toBe(true);
  });
});

describe("обгортка withJob", () => {
  const s = () => noComments(read("supabase/functions/_shared/jobRun.ts"));

  it("пише через job_run_record і не змінює відповідь", () => {
    const src = s();
    expect(src).toMatch(/\(admin\.rpc as any\)\("job_run_record"/);
    expect(src).toMatch(/await record\(job, res\.ok, Date\.now\(\) - started, res\.status, counts, error\);\s*return res;/);
  });

  it("кинутий виняток — теж запис (ok=false), і далі летить як летів", () => {
    expect(s()).toMatch(/if \(!probe\) await record\(job, false, Date\.now\(\) - started, null, null, msg\);\s*throw e;/);
  });

  it("проби робота (?version, OPTIONS) і чужі стуки (401/403) запусками не є", () => {
    const src = s();
    expect(src).toMatch(/searchParams\.has\("version"\)/);
    expect(src).toMatch(/if \(probe \|\| res\.status === 401 \|\| res\.status === 403\) return res;/);
  });

  it("лічильники — лише короткі поля верхнього рівня, стеля 20", () => {
    const src = s();
    expect(src).toMatch(/const MAX_COUNT_KEYS = 20;/);
    expect(src).toMatch(/else if \(Array\.isArray\(v\)\) \{ out\[k\] = v\.length; n\+\+; \}/);
  });
});

describe("ранковий дайджест: зведення нічних процесів — лише суперадміну", () => {
  const s = () => noComments(read("supabase/functions/tutor-daily-digest/index.ts"));

  it("читає job_health і показує його лише platform_admins", () => {
    const src = s();
    expect(src).toMatch(/\(sb\.rpc as any\)\("job_health", \{ _hours: 26 \}\)/);
    expect(src).toMatch(/from\("platform_admins"\)\.select\("user_id"\)/);
    expect(src).toMatch(/if \(superadmins\.has\(userId\)\) \{\s*lines\.push\(\.\.\.jobLines\(D\)\);/);
  });

  it("по рядку на кожен очікуваний процес: ✓ з лічильником, ⚠ зі збоєм, ⛔ якщо не запускався", () => {
    const src = s();
    expect(src).toMatch(/const EXPECTED_DAILY_JOBS = \[/);
    for (const n of ["tutor-daily-digest", "payment-reminders", "db-backup", "telegram-poll"]) expect(src).toContain(`"${n}"`);
    expect(src).toMatch(/for \(const name of EXPECTED_DAILY_JOBS\.filter\(\(x\) => x !== SELF\)\) line\(name, byJob\.get\(name\)\);/);
    expect(src).toMatch(/out\.push\(`⛔ \$\{esc\(D\.jobName\(name\)\)\} — \$\{D\.jobMissing\}`\)/);
    expect(src).toMatch(/out\.push\(`⚠ \$\{esc\(D\.jobName\(name\)\)\}\$\{tail\} · \$\{D\.jobFailed\(failures\)\}/);
  });

  it("сам дайджест у списку «не запускався» не зʼявляється — його рядок пишеться після відповіді", () => {
    const src = s();
    expect(src).toMatch(/const SELF = "tutor-daily-digest";/);
    expect(src).toMatch(/if \(EXPECTED_DAILY_JOBS\.includes\(name\) \|\| name === SELF\) continue;/);
  });

  it("без бази — чесне «не вдалося прочитати», а не тиша; назви процесів — у трьох мовах", () => {
    const src = s();
    expect(src).toMatch(/if \(jobHealth === null\) return \[D\.jobsUnknown\];/);
    for (const key of ["jobsTitle", "jobName", "jobMissing", "jobFailed", "jobsUnknown"]) {
      expect((src.match(new RegExp(`\\b${key}:`, "g")) ?? []).length, `${key} у трьох мовах`).toBe(3);
    }
  });
});

describe("міграція 20260927170000_job_runs і сценарій 98", () => {
  const MIG = "supabase/migrations/20260927170000_job_runs.sql";
  it("на місці, лише для service_role", () => {
    expect(existsSync(join(ROOT, MIG))).toBe(true);
    expect(existsSync(join(ROOT, "scripts/db-replay/scenarios/98-job-runs.sql"))).toBe(true);
    const m = read(MIG);
    expect(m).toMatch(/REVOKE EXECUTE ON FUNCTION public\.job_run_record\(text, boolean, integer, integer, jsonb, text\) FROM PUBLIC, anon, authenticated;/);
    expect(m).toMatch(/REVOKE EXECUTE ON FUNCTION public\.job_health\(integer\) FROM PUBLIC, anon, authenticated;/);
    expect(m).toMatch(/DELETE FROM public\.job_runs WHERE started_at < now\(\) - interval '30 days';/);
  });
});

describe("цикл «вчимося з продакшену»: невпізнані рядки імпорту — в дайджест суперадміна", () => {
  it("читає app_events import_unrecognized за 7 днів і показує форми, не зміст", () => {
    const src = noComments(read("supabase/functions/tutor-daily-digest/index.ts"));
    expect(src).toMatch(/\.from\("app_events"\)\s*\.select\("props"\)\s*\.eq\("name", "import_unrecognized"\)/);
    expect(src).toMatch(/if \(importLoop\) lines\.push\(D\.importLoop\(importLoop\.lists, importLoop\.rows, importLoop\.top\)\);/);
    expect((src.match(/\bimportLoop: \(lists: number, rows: number, top: string\) =>/g) ?? []).length).toBe(3);
  });
});

describe("telegram-poll: один getUpdates водночас", () => {
  it("оренда 45 с у базі; другий запуск і Telegram 409 — «зайнято», не збій", () => {
    const src = noComments(read("supabase/functions/telegram-poll/index.ts"));
    expect(src).toMatch(/rateLimit\(supabase, 'telegram_poll_lease', 'bot', 1, 45\)\) === 'limit'/);
    expect(src).toMatch(/skipped: 'busy'/);
    expect(src).toMatch(/if \(resp\.status === 409\) \{\s*return new Response\(JSON\.stringify\(\{ ok: true, skipped: 'conflict'/);
  });
});
