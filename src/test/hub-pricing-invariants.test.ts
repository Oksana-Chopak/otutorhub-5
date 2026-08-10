import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hubMargin, isNonPositiveMargin } from "@/lib/hubPricing";

describe("hub pricing invariants (маржа хаба — священна)", () => {
  it("margin = student_price − tutor_payout", () => {
    expect(hubMargin(500, 300)).toBe(200);
    expect(hubMargin(500, 500)).toBe(0);
    expect(hubMargin(0, 0)).toBe(0);
  });

  it("нульова/відʼємна маржа детектиться", () => {
    expect(isNonPositiveMargin(500, 500)).toBe(true);
    expect(isNonPositiveMargin(400, 500)).toBe(true);
    expect(isNonPositiveMargin(500, 300)).toBe(false);
  });

  // РОЗТЯЖКА НА РЕГРЕС: ціна учня НІКОЛИ не дефолтиться зі ставки репетитора.
  // Саме такий префіл у PeoplePage тихо зрівняв student_price з tutor_payout
  // і обнулив маржу по нових парах (виявлено власницею на проді, 01.08).
  it("джерело не містить префілу ціни учня зі ставки репетитора", () => {
    const root = join(__dirname, "..");
    const people = readFileSync(join(root, "pages/PeoplePage.tsx"), "utf8");
    const assign = readFileSync(join(root, "components/AssignTutorDialog.tsx"), "utf8");
    const banned = /price:\s*[A-Za-z.]*price\s*\|\|\s*\(?\s*tutorRate/;
    expect(banned.test(people)).toBe(false);
    expect(banned.test(assign)).toBe(false);
    // і взагалі жодного String(tutorRate) у значенні price-поля
    expect(/price:[^,\n]*tutorRate/.test(people)).toBe(false);
  });

  // РОЗТЯЖКА №2: у ЖОДНОМУ файлі src грошові поля не підмінюють одне одного.
  // Саме `tutor_payout ?? student_price` у LessonCard показувало адміну
  // «виплата репетитору = оплата учня» з 10.06 (дані були цілі — брехав дисплей).
  it("жодних крос-фолбеків tutor_payout ↔ student_price у src", () => {
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    const root = join(__dirname, "..");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) { if (!/node_modules|test/.test(p)) walk(p); }
        else if (/\.(ts|tsx)$/.test(e) && !e.includes(".test.")) files.push(p);
      }
    };
    walk(root);
    const bad = /tutor_payout\s*\?\?[^,)\n]*student_price|student_price\s*\?\?[^,)\n]*tutor_payout/;
    const offenders = files.filter((f) => bad.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  // РОЗТЯЖКА №3: збереження ставки в Assign ЗАВЖДИ протягує її на наявні уроки.
  it("AssignTutorDialog кличе backfill_tutor_payouts_for_tutor", () => {
    const root = join(__dirname, "..");
    const assign = readFileSync(join(root, "components/AssignTutorDialog.tsx"), "utf8");
    expect(assign.includes("backfill_tutor_payouts_for_tutor")).toBe(true);
  });

  // РОЗТЯЖКА №4: поповнення гаманця авторозраховує борги — тригер мусить існувати.
  it("міграції містять тригер settle-after-credit на student_wallet_transactions", () => {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const dir = join(__dirname, "../../supabase/migrations");
    const all = readdirSync(dir).filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
    expect(/CREATE TRIGGER trg_wallet_settle_after_credit[\s\S]*ON public\.student_wallet_transactions/.test(all)).toBe(true);
  });

  // РОЗТЯЖКА №5: ручне «оплачено» не оминає гаманець — тригер мусить існувати.
  it("міграції містять тригер charge-on-manual-paid на lesson_details", () => {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const dir = join(__dirname, "../../supabase/migrations");
    const all = readdirSync(dir).filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
    expect(/CREATE TRIGGER trg_wallet_charge_on_manual_paid[\s\S]*ON public\.lesson_details/.test(all)).toBe(true);
  });

  // РОЗТЯЖКА №7: «виплачено 0» структурно неможливе — guard-тригер існує.
  it("guard-тригер no-zero-paid стоїть на lesson_details", () => {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const dir = join(__dirname, "../../supabase/migrations");
    const all = readdirSync(dir).filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
    expect(/CREATE TRIGGER trg_payout_guard_no_zero_paid[\s\S]{0,200}ON public\.lesson_details/.test(all)).toBe(true);
  });

  // РОЗТЯЖКА №6: предмети канонізуються на ЗАПИСІ у всіх трьох таблицях —
  // плутанина написань (регістр/пробіли/крапки) структурно неможлива.
  it("тригер канонізації предметів стоїть на lessons, student_rates, tutor_subject_rates", () => {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const dir = join(__dirname, "../../supabase/migrations");
    const all = readdirSync(dir).filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
    for (const t of ["lessons", "student_rates", "tutor_subject_rates"]) {
      expect(new RegExp(`CREATE TRIGGER trg_subject_canon[\\s\\S]{0,200}ON public\\.${t}`).test(all)).toBe(true);
    }
  });
});
