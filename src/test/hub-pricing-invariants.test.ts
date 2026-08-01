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
});
