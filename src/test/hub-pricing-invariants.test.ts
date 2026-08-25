import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
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
    const dir = join(__dirname, "../../supabase/migrations");
    const all = readdirSync(dir).filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
    expect(/CREATE TRIGGER trg_wallet_settle_after_credit[\s\S]*ON public\.student_wallet_transactions/.test(all)).toBe(true);
  });

  // РОЗТЯЖКА №5: ручне «оплачено» не оминає гаманець — тригер мусить існувати.
  it("міграції містять тригер charge-on-manual-paid на lesson_details", () => {
    const dir = join(__dirname, "../../supabase/migrations");
    const all = readdirSync(dir).filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
    expect(/CREATE TRIGGER trg_wallet_charge_on_manual_paid[\s\S]*ON public\.lesson_details/.test(all)).toBe(true);
  });

  // РОЗТЯЖКА №8 (весь src): сирі date/time-інпути заборонені всюди, крім
  // родини DateTimeField і лендінг-демо (окремий візуальний світ).
  it("жодних сирих date/time-інпутів поза DateTimeField", () => {
    const allow = new Set(["DateTimeField.tsx", "LandingTryDemo.tsx"]);
    const bad: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const fp = join(dir, f);
        if (statSync(fp).isDirectory()) { walk(fp); continue; }
        if (!f.endsWith(".tsx") || allow.has(f)) continue;
        const src = readFileSync(fp, "utf8");
        if (/type="date"|type="time"|datetime-local/.test(src)) bad.push(f);
      }
    };
    walk(join(__dirname, "../../src"));
    expect(bad).toEqual([]);
  });

  // РОЗТЯЖКА №9: NotificationBell монтується ЛИШЕ в AppLayout.
  it("NotificationBell лише в AppLayout", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const fp = join(dir, f);
        if (statSync(fp).isDirectory()) { walk(fp); continue; }
        if (!f.endsWith(".tsx") || f === "AppLayout.tsx" || f === "NotificationBell.tsx") continue;
        if (/<NotificationBell/.test(readFileSync(fp, "utf8"))) offenders.push(f);
      }
    };
    walk(join(__dirname, "../../src"));
    expect(offenders).toEqual([]);
  });

  // РОЗТЯЖКА №12: BUILD_TAG синхронний у lib, index.html і дайджесті.
  it("BUILD_TAG єдиний у трьох місцях", () => {
    const lib = readFileSync(join(__dirname, "../lib/buildInfo.ts"), "utf8");
    const tag = /BUILD_TAG = "([^"]+)"/.exec(lib)?.[1];
    expect(tag).toBeTruthy();
    const html = readFileSync(join(__dirname, "../../index.html"), "utf8");
    expect(html.includes(`content="${tag}"`)).toBe(true);
    const digest = readFileSync(join(__dirname, "../../supabase/functions/tutor-daily-digest/index.ts"), "utf8");
    expect(digest.includes(`"${tag}"`)).toBe(true);
  });

  // РОЗТЯЖКА №11: insert у lessons — лише санкціоновані форми (канон):
  // LessonCreate (інлайн Розкладу) і QuickLessonDialog. Третій писар = збірка падає.
  it("lessons.insert лише у двох канонічних формах", () => {
    const allow = new Set([
      "SchedulePage.tsx",      // багата все-рольова форма (канон-ціль злиття)
      "QuickLessonDialog.tsx", // швидка форма репетитора (+ групи) — вливається за планом
      "OnboardingFlowB.tsx",   // майстер першого уроку (first-run, санкціоновано)
      "groupLessons.ts",       // ліб-писар групових уроків (правильний патерн)
    ]);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const fp = join(dir, f);
        if (statSync(fp).isDirectory()) { walk(fp); continue; }
        if (!/\.(ts|tsx)$/.test(f) || allow.has(f) || fp.includes("test")) continue;
        if (/from\("lessons"\)[\s\S]{0,40}\.insert\(/.test(readFileSync(fp, "utf8"))) offenders.push(f);
      }
    };
    walk(join(__dirname, "../../src"));
    expect(offenders).toEqual([]);
  });

  // РОЗТЯЖКА №10: статус уроку пише ЛИШЕ src/lib/lessonActions.ts.
  it("status-writer єдиний (lessonActions)", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const fp = join(dir, f);
        if (statSync(fp).isDirectory()) { walk(fp); continue; }
        if (!/\.(ts|tsx)$/.test(f) || f === "lessonActions.ts" || fp.includes("test")) continue;
        if (/from\("lessons"\)\.update\(\{ status/.test(readFileSync(fp, "utf8"))) offenders.push(f);
      }
    };
    walk(join(__dirname, "../../src"));
    expect(offenders).toEqual([]);
  });

  // РОЗТЯЖКА №7: «виплачено 0» структурно неможливе — guard-тригер існує.
  it("guard-тригер no-zero-paid стоїть на lesson_details", () => {
    const dir = join(__dirname, "../../supabase/migrations");
    const all = readdirSync(dir).filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
    expect(/CREATE TRIGGER trg_payout_guard_no_zero_paid[\s\S]{0,200}ON public\.lesson_details/.test(all)).toBe(true);
  });

  // РОЗТЯЖКА №6: предмети канонізуються на ЗАПИСІ у всіх трьох таблицях —
  // плутанина написань (регістр/пробіли/крапки) структурно неможлива.
  it("тригер канонізації предметів стоїть на lessons, student_rates, tutor_subject_rates", () => {
    const dir = join(__dirname, "../../supabase/migrations");
    const all = readdirSync(dir).filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
    for (const t of ["lessons", "student_rates", "tutor_subject_rates"]) {
      expect(new RegExp(`CREATE TRIGGER trg_subject_canon[\\s\\S]{0,200}ON public\\.${t}`).test(all)).toBe(true);
    }
  });
});
