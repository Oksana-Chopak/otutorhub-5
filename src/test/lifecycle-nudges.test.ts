import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { lifecycleMessage, telegramText, KINDS, normLang, type LifecycleNumbers, type Lang } from "../../supabase/functions/_shared/lifecycleTexts";
import { stripHtml } from "../../supabase/functions/_shared/htmlToText";
import { PRICE_PER_MONTH } from "@/lib/pricing";

/**
 * Ланцюжок листів/Telegram (13.10, пре-мортем: «зовсім немає ланцюжка, яким би
 * ми онбордили нових, просинали неактивних чи повідомляли про апдейти»).
 *
 * Поведінку бази (кому що коли, дедуплікація, тихі години, відписка, сегменти)
 * тримає сценарій `66-lifecycle-nudges.sql`. Тут — слова й дроти: тексти в трьох
 * мовах без вигаданих цифр, ціни = src/lib/pricing.ts, кнопки ведуть на живі
 * маршрути, edge-функція зареєстрована як cron-процес, розсилка вміє Telegram.
 */
const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const PRICE = { monthly: PRICE_PER_MONTH.monthly, yearly: PRICE_PER_MONTH.yearly };
const ZERO: LifecycleNumbers = { students: 0, lessons: 0, debt_lessons: 0, debt_sum: 0, unmarked: 0, trial_days_left: 7, reminded_times: 0, recovered_sum: 0, currency: "UAH" };
const FULL: LifecycleNumbers = { students: 3, lessons: 12, debt_lessons: 2, debt_sum: 900, unmarked: 4, trial_days_left: 2, reminded_times: 5, recovered_sum: 1800, currency: "UAH" };

describe("тексти ланцюжка — три мови, без вигаданих цифр", () => {
  it("кожен крок у кожній мові має заголовок, рядки й кнопку на маршрут застосунку", () => {
    for (const lang of ["uk", "en", "sv"] as Lang[]) {
      for (const kind of KINDS) {
        const m = lifecycleMessage(kind, lang, "Марта", FULL, PRICE);
        expect(m.title.length, `${kind}/${lang} title`).toBeGreaterThan(5);
        expect(m.lines.length, `${kind}/${lang} lines`).toBeGreaterThan(0);
        for (const l of m.lines) expect(l.length, `${kind}/${lang} порожній рядок`).toBeGreaterThan(0);
        expect(m.cta.path, `${kind}/${lang} cta`).toMatch(/^\//);
        expect(m.cta.text.length).toBeGreaterThan(2);
      }
    }
  });

  it("нульові цифри не показуються: «0 учнів», «0 ₴» у листі не зʼявляються", () => {
    for (const lang of ["uk", "en", "sv"] as Lang[]) {
      for (const kind of KINDS) {
        const text = [lifecycleMessage(kind, lang, "", ZERO, PRICE).title, ...lifecycleMessage(kind, lang, "", ZERO, PRICE).lines].join("\n");
        expect(text, `${kind}/${lang}`).not.toMatch(/\b0 (учн|урок|lesson|student|elev|lektion|₴)/);
        expect(text).not.toMatch(/undefined|NaN|null/);
      }
    }
  });

  it("справжні цифри людини потрапляють у текст: учні, уроки, нагадано за тебе, повернуто, борг", () => {
    const m = lifecycleMessage("trial_7_left", "uk", "Марта", FULL, PRICE);
    const text = m.lines.join("\n");
    expect(text).toContain("3 учні");
    expect(text).toContain("12 уроків");
    expect(text).toContain("нагадано за тебе 5 разів");
    expect(text).toContain("повернуто після нагадувань 1 800 ₴");
    // 14.10 (лист-«морок» власниці): у сплячих — спершу цифра і дія, не «назбиралось» і «тиша»
    const s = lifecycleMessage("inactive_7", "uk", "Марта", FULL, PRICE);
    expect(s.title).toBe("Марта, 2 уроки чекають на оплату — 900 ₴");
    expect(s.lines.join("\n")).toContain("Познач проведені уроки (4)");
    expect(s.lines.join("\n")).toContain("Одним дотиком нагадаємо кожному учню");
    expect(s.cta.path).toBe("/finances?tab=debts");
    const big = lifecycleMessage("inactive_14", "uk", "", { ...FULL, debt_lessons: 19, debt_sum: 10200 }, PRICE);
    expect(big.title).toBe("19 уроків чекають на оплату — 10 200 ₴");
    expect(big.title).not.toMatch(/Ми зберегли|тиші|Назбиралось/);
    expect(big.lines.join("\n")).not.toMatch(/Два тижні тиші/);
    const clean = lifecycleMessage("inactive_14", "uk", "Марта", ZERO, PRICE);
    expect(clean.title).toBe("Марта, усе чисто — глянь розклад на тиждень");
    expect(clean.cta.path).toBe("/");
    const e = lifecycleMessage("inactive_14", "en", "", FULL, PRICE);
    expect(e.title).toBe("2 lessons awaiting payment — 900 ₴");
    expect(e.lines.join("\n")).toContain("Mark the lessons you taught (4)");
  });

  it("ціна Pro в листах = src/lib/pricing.ts (місячна й річна), і та сама константа в edge-функції", () => {
    for (const lang of ["uk", "en", "sv"] as Lang[]) {
      const t = lifecycleMessage("trial_2_left", lang, "", FULL, PRICE).lines.join("\n");
      expect(t).toContain(`${PRICE_PER_MONTH.monthly} ₴`);
      expect(t).toContain(`${PRICE_PER_MONTH.yearly} ₴`);
    }
    const edge = read("supabase/functions/lifecycle-nudges/index.ts");
    expect(edge).toContain(`const PRICE_MONTHLY = ${PRICE_PER_MONTH.monthly};`);
    expect(edge).toContain(`const PRICE_YEARLY = ${PRICE_PER_MONTH.yearly};`);
  });

  it("кнопки ведуть на живі маршрути, а їхні параметри хтось читає", () => {
    const app = read("src/App.tsx");
    const paths = new Set<string>();
    for (const lang of ["uk", "en", "sv"] as Lang[]) for (const kind of KINDS) paths.add(lifecycleMessage(kind, lang, "", FULL, PRICE).cta.path);
    for (const p of paths) {
      const route = p.split("?")[0];
      if (route === "/") continue;
      expect(app, `маршрут ${route}`).toMatch(new RegExp(`path="${route.replace(/\//g, "\\/")}"`));
    }
    expect(paths.has("/my-students?new=1")).toBe(true);
    expect(read("src/pages/MyStudentsPage.tsx")).toMatch(/searchParams\.get\("new"\) === "1"/);
    expect(paths.has("/schedule?create=1")).toBe(true);
    expect(read("src/pages/SchedulePage.tsx")).toMatch(/searchParams\.get\("create"\) === "1"/);
  });

  it("Telegram-текст: заголовок жирним, HTML екранується, посилання останнім рядком", () => {
    const m = lifecycleMessage("welcome", "uk", "<Марта>", ZERO, PRICE);
    const t = telegramText(m, "https://otutorhub.com");
    expect(t.startsWith("<b>")).toBe(true);
    expect(t).toContain("&lt;Марта&gt;");
    expect(t.trim().endsWith("https://otutorhub.com/")).toBe(true);
    expect(normLang("sv")).toBe("sv");
    expect(normLang("xx")).toBe("uk");
  });
});

describe("розсилка в Telegram: HTML листа → звичайний текст", () => {
  it("абзаци, списки й посилання переживають, теги — ні", () => {
    const html = "<p>Привіт!</p><ul><li>Перше</li><li>Друге &amp; третє</li></ul><p><a href='https://otutorhub.com/'>Відкрити</a></p><p><a href=\"https://otutorhub.com/x\">https://otutorhub.com/x</a></p>";
    const t = stripHtml(html);
    expect(t).toBe("Привіт!\n• Перше\n• Друге & третє\nВідкрити: https://otutorhub.com/\nhttps://otutorhub.com/x");
    expect(t).not.toMatch(/<[a-z]/i);
  });
});

describe("дроти ланцюжка й розсилки", () => {
  it("edge lifecycle-nudges: cron-процес (withJob), секрет крону, кандидати й журнал через RPC, канали Telegram → пошта → дзвіночок", () => {
    const s = read("supabase/functions/lifecycle-nudges/index.ts");
    expect(s).toMatch(/Deno\.serve\(withJob\("lifecycle-nudges", async \(req\) => \{/);
    expect(s).toMatch(/get_cron_shared_secret/);
    expect(s).toMatch(/\(admin\.rpc as any\)\("lifecycle_candidates"/);
    expect(s).toMatch(/\(admin\.rpc as any\)\("lifecycle_record"/);
    expect(s).toMatch(/templateName: "lifecycle-nudge"/);
    expect(s).toMatch(/from\("notifications"\)\.insert\(/);
    expect(s).toMatch(/if \(!channels\.length && c\.email\)/); // пошта лише якщо Telegram не дійшов
    expect(read("supabase/config.toml")).toMatch(/\[functions\.lifecycle-nudges\]\n\s+verify_jwt = false/);
    expect(read("supabase/functions/tutor-daily-digest/index.ts")).toMatch(/"scheduled-notifications", "lifecycle-nudges",\s*\n\s*\];/);
    expect(read("supabase/functions/_shared/transactional-email-templates/registry.ts")).toMatch(/'lifecycle-nudge': lifecycleNudge/);
    expect(read("supabase/functions/_shared/transactional-email-templates/lifecycle-nudge.tsx")).toMatch(/unsubscribeUrl/);
  });

  it("14.10: ланцюжок не пише власниці й її тестовим акаунтам; лист про борги веде одразу на вкладку боргів", () => {
    const m = read("supabase/migrations/20261014090000_lifecycle_skip_admins.sql");
    expect(m).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.platform_admins pa WHERE pa\.user_id = s\.tutor_id\)/);
    expect(m).toMatch(/regexp_replace\(lower\(coalesce\(nullif\(trim\(pc\.email\), ''\), u\.email\)\), '\\\+\[\^@\]\*@', '@'\)/);
    expect(read("scripts/db-replay/scenarios/66-lifecycle-nudges.sql")).toMatch(/admin66\+test@replay\.local/);
    expect(read("src/pages/FinancesPage.tsx")).toMatch(/useState<"ops"\|"debts"\|"analytics">\(rawTab === "debts" \? "debts" : "ops"\)/);
  });

  it("міграція: журнал, кандидати, рахунок «нагадано за вас», сегменти за справжніми статусами, крон щогодини, сценарій 66", () => {
    const m = read("supabase/migrations/20261013150000_lifecycle_nudges.sql");
    expect(m).toMatch(/CREATE TABLE IF NOT EXISTS public\.lifecycle_messages/);
    expect(m).toMatch(/UNIQUE \(user_id, kind, cycle_key\)/);
    expect(m).toMatch(/FUNCTION public\.lifecycle_candidates\(_at timestamptz DEFAULT now\(\), _limit integer DEFAULT 200\)/);
    expect(m).toMatch(/GRANT EXECUTE ON FUNCTION public\.lifecycle_candidates\(timestamptz, integer\) TO service_role;/);
    expect(m).toMatch(/FUNCTION public\.tutor_reminder_stats\(_tutor_id uuid\)/);
    expect(m).toMatch(/WHEN 'pro_active' THEN tws\.subscription_status = 'active'/);
    expect(m).not.toMatch(/subscription_status = 'pro'/);
    expect(m).not.toMatch(/subscription_status = 'expired'/);
    expect(m).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_marketing_recipients\(text\) TO authenticated, service_role;/);
    expect(m).toMatch(/cron\.schedule\(\s*'lifecycle-nudges',\s*'7 \* \* \* \*'/);
    expect(m).toMatch(/-- LIVE-MARKER: lifecycle_candidates/);
    expect(existsSync(join(ROOT, "scripts/db-replay/scenarios/66-lifecycle-nudges.sql"))).toBe(true);
    expect(read("docs/PROD-DB-SYNC.md")).toMatch(/20261013150000_lifecycle_nudges/);
  });

  it("розсилка: канали email/telegram, текст для Telegram, лічильники по каналах; адмінка має перемикачі й шаблон «оновлення застосунку»", () => {
    const e = read("supabase/functions/send-marketing-campaign/index.ts");
    expect(e).toMatch(/c === "email" \|\| c === "telegram"/);
    expect(e).toMatch(/api\.telegram\.org\/bot\$\{BOT\}\/sendMessage/);
    expect(e).toMatch(/telegram_sent: tgSent,\s*\n\s*telegram_failed: tgFailed,/);
    expect(e).toMatch(/"has_telegram"\]/);
    const p = read("src/pages/MarketingPage.tsx");
    expect(p).toMatch(/const UPDATE_PRESET_KEYS = \{/);
    expect(p).toMatch(/body: \{ subject, htmlBody, telegramText, channels, segment, dryRun: false \}/);
    expect(p).toMatch(/\(supabase\.rpc as any\)\("lifecycle_summary", \{ _days: 30 \}\)/);
    expect(p).toMatch(/value: "has_telegram"/);
  });
});
