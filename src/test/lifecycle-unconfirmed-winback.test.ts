import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { lifecycleMessage, KINDS, type LifecycleNumbers, type Lang } from "../../supabase/functions/_shared/lifecycleTexts";
import { PRICE_PER_MONTH } from "@/lib/pricing";

/**
 * 19.10 — рішення власниці «перше і друге тільки зроби»:
 *  1. не підтвердив пошту → повторний лист підтвердження на день 1–7 (auth «resend
 *     signup»), без welcome у замкнені двері;
 *  2. тріал минув, учні є, Pro не купив → повернення раз на вікно 10–30 · 30–60 ·
 *     60–90 · 90–120 днів, без «сплячих» кроків (ядро замкнене);
 *  + крони нагадувань і ланцюжка — 6 запусків на добу замість 24.
 * Поведінку бази тримає сценарій 67; тут — слова, дроти й міграція.
 */
const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const PRICE = { monthly: PRICE_PER_MONTH.monthly, yearly: PRICE_PER_MONTH.yearly };
const FULL: LifecycleNumbers = { students: 3, lessons: 12, debt_lessons: 2, debt_sum: 900, debt_by_cur: { UAH: 900 }, unmarked: 4, trial_days_left: 0, reminded_times: 5, recovered_sum: 1800, currency: "UAH" };
const MIG = "supabase/migrations/20261019180000_lifecycle_unconfirmed_winback_cron6.sql";

describe("повернення після тріалу: цифри людини, Pro за публічною ціною, без Light", () => {
  it("є в списку кроків і в трьох мовах", () => {
    expect(KINDS).toContain("win_back");
    expect(KINDS).toContain("unconfirmed_d1");
    for (const lang of ["uk", "en", "sv"] as Lang[]) {
      const m = lifecycleMessage("win_back", lang, "Олег", FULL, PRICE);
      expect(m.cta.path).toBe("/subscription");
      expect(m.lines.join("\n")).toContain(String(PRICE.monthly));
      expect(m.lines.join("\n")).not.toMatch(/Light|149/);
    }
  });

  it("uk: заголовок із учнями й уроками, борг словами, кнопка «Повернутись з Pro»", () => {
    const m = lifecycleMessage("win_back", "uk", "Олег", FULL, PRICE);
    expect(m.title).toBe("Олег, твої 3 учні і 12 уроків досі тут");
    expect(m.lines.join("\n")).toContain("Неоплачених: 2 уроки на 900 ₴");
    expect(m.cta.text).toBe("Повернутись з Pro");
    const noLessons = lifecycleMessage("win_back", "uk", "", { ...FULL, lessons: 0, debt_lessons: 0 }, PRICE);
    expect(noLessons.title).toBe("твої 3 учні досі тут");
    expect(noLessons.lines.join("\n")).not.toMatch(/Неоплачених/);
  });
});

describe("міграція 20261019180000: кроки, прапорець lapsed, крони 6×, сценарій 67", () => {
  it("файл на місці, ідемпотентний, з перевіркою в кінці", () => {
    expect(existsSync(join(ROOT, MIG))).toBe(true);
    const m = read(MIG);
    expect(m).toMatch(/CREATE OR REPLACE FUNCTION public\.lifecycle_candidates\(_at timestamptz DEFAULT now\(\), _limit integer DEFAULT 200\)/);
    expect(m).toMatch(/\(u\.email_confirmed_at IS NOT NULL\) AS confirmed,/);
    expect(m).toMatch(/WHEN NOT s\.confirmed AND s\.days >= 1 AND s\.days < 8\s+THEN 'unconfirmed_d1'/);
    expect(m).toMatch(/WHEN NOT s\.confirmed\s+THEN NULL/);
    expect(m).toMatch(/WHEN s\.lapsed AND s\.opted_in AND s\.students > 0 AND s\.trial_left <= -10 AND s\.trial_left > -120 THEN 'win_back'/);
    expect(m).toMatch(/WHEN s\.lapsed\s+THEN NULL/);
    expect(m).toMatch(/WHEN p\.kind = 'win_back' THEN floor\(\(-p\.trial_left\) \/ 30\)::int::text/);
    // 14.10 і 15.10 лишаються: власниця/псевдоніми поза ланцюжком, борг по валютах
    expect(m).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.platform_admins pa WHERE pa\.user_id = s\.tutor_id\)/);
    expect(m).toMatch(/debt_by_cur/);
    expect(m).toMatch(/GRANT EXECUTE ON FUNCTION public\.lifecycle_candidates\(timestamptz, integer\) TO service_role;/);
    expect(m).toMatch(/-- LIVE-MARKER-NONE:/);
  });

  it("крони: 6 запусків на добу, старий щогодинний знято, той самий секрет", () => {
    const m = read(MIG);
    expect(m).toMatch(/cron\.schedule\(\s*'payment-reminders-6x',\s*'5 6-18\/2 \* \* \*'/);
    expect(m).toMatch(/cron\.schedule\(\s*'lifecycle-nudges',\s*'7 6-17\/2 \* \* \*'/);
    expect(m).toMatch(/jobname IN \('payment-reminders-hourly', 'payment-reminders-6x'\)/);
    expect((m.match(/'Bearer ' \|\| public\.get_cron_shared_secret\(\)/g) ?? []).length).toBe(2);
    expect(m).not.toMatch(/service_role_key/);
  });

  it("сценарій 67 на місці і сценарій 66 підтверджує пошту своїм акторам", () => {
    expect(existsSync(join(ROOT, "scripts/db-replay/scenarios/67-lifecycle-unconfirmed-winback.sql"))).toBe(true);
    expect(read("scripts/db-replay/scenarios/66-lifecycle-nudges.sql")).toMatch(/UPDATE auth\.users SET email_confirmed_at = t0 WHERE id IN \(tutor, quiet, admin, alias_\);/);
    expect(read("docs/PROD-DB-SYNC.md")).toMatch(/20261019180000_lifecycle_unconfirmed_winback_cron6/);
  });
});

describe("edge lifecycle-nudges: повторний лист підтвердження через auth, невідомий крок не валить запуск", () => {
  const s = noComments(read("supabase/functions/lifecycle-nudges/index.ts"));
  it("unconfirmed_d1 → auth.resend(signup) на пошту людини, без дзвіночка, запис у журнал каналом email_confirm", () => {
    expect(s).toMatch(/if \(c\.kind === "unconfirmed_d1"\) \{/);
    expect(s).toMatch(/admin\.auth\.resend\(\{ type: "signup", email: c\.email, options: \{ emailRedirectTo: redirect \} \}\)/);
    expect(s).toMatch(/\/auth\?confirmed=1&email=\$\{encodeURIComponent\(c\.email\)\}&lng=\$\{lang\}/);
    expect(s).toMatch(/_channels: \["email_confirm"\]/);
  });
  it("крок, якого збірка не знає, пропускається з логом — не TypeError на весь запуск", () => {
    expect(s).toMatch(/if \(!KINDS\.includes\(c\.kind\)\) \{/);
    expect(s).toMatch(/confirmResent/);
  });
  it("дайджест знає підписи нових кроків у трьох мовах", () => {
    const d = read("supabase/functions/tutor-daily-digest/index.ts");
    expect((d.match(/win_back: "/g) ?? []).length).toBe(3);
    expect((d.match(/unconfirmed_d1: "/g) ?? []).length).toBe(3);
  });
});
