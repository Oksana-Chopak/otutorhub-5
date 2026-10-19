import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isStaleChunkError } from "@/lib/staleBuild";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * 19.10 — три знахідки з ранкового дайджесту власниці:
 *  1. «нагадування про оплату — 25×» прочиталось як 25 нагадувань, а було 25 запусків
 *     щогодинного крону (last_counts останнього, «нічного», запуску без лічильників).
 *  2. Листи просять «відповідай на цей лист», а йшли з noreply@ без Reply-To.
 *  3. Дві помилки з проду: стара збірка у вкладці після Publish і шум замка сесії
 *     supabase-js — обидві читались як збої продукту.
 */

describe("ранковий дайджест: лічильники за добу зі словом, не «N×»", () => {
  const src = noComments(read("supabase/functions/tutor-daily-digest/index.ts"));

  it("сумує лічильники всіх успішних запусків за 26 годин із job_runs", () => {
    expect(src).toMatch(/\.from\("job_runs"\)\s*\.select\("job, ok, counts"\)/);
    expect(src).toMatch(/const SUM_KEYS = \["sent", "processed", "started", "archived", "created", "delivered"\];/);
    expect(src).toMatch(/if \(!r\.ok\) continue;/);
  });

  it("рядок процесу: «надіслано N · M запусків», і ніде більше голого «N×»", () => {
    expect(src).toMatch(/tail = ` — \$\{label\}\$\{okRuns > 1 && okRuns <= 200 \? ` · \$\{D\.jobRuns\(okRuns\)\}` : ""\}`;/);
    expect(src).toMatch(/runs > 1 \? ` — \$\{D\.jobRuns\(runs\)\}` : ""/);
    expect(src).not.toMatch(/\$\{runs\}×/);
  });

  it("суперадмін бачить, кому пішли нагадування, пошту за добу і кроки ланцюжка", () => {
    expect(src).toMatch(/\.from\("lesson_payment_reminders"\)\s*\.select\("student_id, tutor_id, channel"\)/);
    expect(src).toMatch(/\.from\("email_send_log"\)\s*\.select\("message_id, status, created_at"\)/);
    expect(src).toMatch(/\.from\("lifecycle_messages"\)\s*\.select\("kind"\)/);
    // один лист = кілька рядків журналу — рахується ОСТАННІЙ статус
    expect(src).toMatch(/finalByMsg\.set\(String\(r\.message_id \?\? r\.created_at\), String\(r\.status\)\)/);
    expect(src).toMatch(/if \(remindersDay\) lines\.push\(D\.remindersDay\(/);
    expect(src).toMatch(/if \(mailDay\) lines\.push\(D\.mailDay\(/);
    expect(src).toMatch(/lines\.push\(parts \? D\.chainDay\(parts\) : D\.chainNone\);/);
  });

  it("нові ключі словника — у трьох мовах", () => {
    for (const key of ["jobSent", "jobProcessed", "jobTables", "jobRuns", "remindersDay", "mailDay", "chainDay", "chainNone", "chainKind"]) {
      expect((src.match(new RegExp(`^ {4}${key}:`, "gm")) ?? []).length, `${key} у трьох мовах`).toBe(3);
    }
  });
});

describe("пошта: Reply-To на живу скриньку, брендове імʼя, тема мовою листа", () => {
  it("send-transactional-email кладе reply_to у чергу, диспетчер передає його в API", () => {
    const sender = noComments(read("supabase/functions/send-transactional-email/index.ts"));
    expect(sender).toMatch(/const REPLY_TO = Deno\.env\.get\("EMAIL_REPLY_TO"\) \?\? "hello@otutorhub\.com"/);
    expect(sender).toMatch(/from: `\$\{FROM_NAME\} <noreply@\$\{FROM_DOMAIN\}>`,\s*sender_domain: SENDER_DOMAIN,\s*reply_to: REPLY_TO,/);
    const queue = noComments(read("supabase/functions/process-email-queue/index.ts"));
    expect(queue).toMatch(/reply_to: payload\.reply_to,/);
  });

  it("листи авторизації: той самий Reply-To, тема українською, як і тіло", () => {
    const hook = noComments(read("supabase/functions/auth-email-hook/index.ts"));
    expect(hook).toMatch(/reply_to: REPLY_TO,/);
    expect(hook).toMatch(/siteName: FROM_NAME,/);
    expect(hook).not.toMatch(/signup: 'Confirm your email'/);
    expect(hook).toMatch(/signup: 'Підтвердіть email — oTutorHub'/);
    expect(hook).toMatch(/recovery: 'Скидання пароля — oTutorHub'/);
  });

  it("ланцюжок справді обіцяє відповідь на лист — тому Reply-To обовʼязковий", () => {
    const texts = read("supabase/functions/_shared/lifecycleTexts.ts");
    expect(texts).toMatch(/відповідай на цей лист/);
  });
});

describe("стара збірка у вкладці й шум замка сесії — не збої продукту", () => {
  it("впізнає повідомлення з проду про зниклий модуль збірки", () => {
    expect(isStaleChunkError("Failed to fetch dynamically imported module: https://otutorhub.com/assets/Index-By8Xifsb.js")).toBe(true);
    expect(isStaleChunkError("Importing a module script failed.")).toBe(true);
    expect(isStaleChunkError("Cannot read properties of undefined")).toBe(false);
  });

  it("main.tsx вмикає один reload на збірку через vite:preloadError", () => {
    expect(noComments(read("src/main.tsx"))).toMatch(/installStaleBuildReload\(\);/);
    const s = noComments(read("src/lib/staleBuild.ts"));
    expect(s).toMatch(/addEventListener\("vite:preloadError"/);
    expect(s).toMatch(/if \(alreadyReloadedForThisBuild\(\)\) return;/);
    expect(s).toMatch(/event\.preventDefault\(\);[^\n]*\n\s*window\.location\.reload\(\);/);
  });

  it("журнал помилок не пише шум замка сесії supabase-js", () => {
    const s = noComments(read("src/lib/errorLog.ts"));
    expect(s).toMatch(/was released because another request stole it/);
  });
});
