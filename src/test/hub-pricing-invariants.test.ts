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
});
