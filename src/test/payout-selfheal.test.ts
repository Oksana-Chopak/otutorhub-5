/**
 * 13.09 — «пропала ставка у Петра Городного, бачу всі нулі».
 * База: ставки на місці, а чотири проведені уроки з 23.08 мають ПОРОЖНЮ виплату.
 * Клас помилки: виплата на хабовому уроці лишається NULL/0, хоча ставка є —
 * бо ланцюг автозаповнення не спрацював або клієнт дописав `Number(x) || 0`.
 *
 * Стережемо: (1) міграція самолікування — тригер на INSERT **і** UPDATE OF
 * tutor_payout, єдина функція вибору ставки, закрита від authenticated (маржа
 * школи), бекфіл лише хабових нескасованих невиплачених, ціну учня не чіпає;
 * (2) клієнт більше не пише «0, бо не знаю» у гроші.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const src = (f: string) => readFileSync(join(root, f), "utf8");

describe("міграція 20260913200000_payout_autofill_selfheal", () => {
  const mig = src("supabase/migrations/20260913200000_payout_autofill_selfheal.sql");

  it("одна функція вибору ставки, закрита від anon/authenticated", () => {
    expect(mig).toMatch(/CREATE OR REPLACE FUNCTION public\.pick_tutor_payout\(_tutor uuid, _subject text\)/);
    expect(mig).toMatch(/REVOKE EXECUTE ON FUNCTION public\.pick_tutor_payout\(uuid, text\) FROM PUBLIC, anon, authenticated/);
    expect(mig).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.pick_tutor_payout\(uuid, text\) TO [^;]*authenticated/);
    // ставка по предмету — без урахування регістру й пробілів (так само, як у гарді й бекфілі)
    expect(mig).toMatch(/lower\(btrim\(tsr\.subject\)\) = lower\(btrim\(COALESCE\(_subject, ''\)\)\)/);
  });

  it("автозаповнення спрацьовує і на INSERT, і коли виплата стала порожньою на UPDATE", () => {
    expect(mig).toMatch(/BEFORE INSERT OR UPDATE OF tutor_payout ON public\.lesson_details/);
    expect(mig).toMatch(/COALESCE\(NEW\.tutor_payout, 0\) = 0\s*\n\s*AND COALESCE\(NEW\.tutor_payout_status, 'unpaid'\) <> 'paid'/);
    // ціна учня — лише при створенні (0 в оновленні буває свідомим)
    expect(mig).toMatch(/IF TG_OP = 'INSERT' AND COALESCE\(NEW\.student_price, 0\) = 0/);
    // на оновленні незалежні уроки не чіпаємо
    expect(mig).toMatch(/TG_OP = 'INSERT' OR _source IS DISTINCT FROM 'independent'/);
  });

  it("разовий бекфіл: лише хабові, не скасовані, не виплачені, з порожньою виплатою і наявною ставкою; ціну не чіпає", () => {
    const bf = mig.slice(mig.indexOf("-- 4) Разовий бекфіл"));
    expect(bf).toMatch(/SET tutor_payout = public\.pick_tutor_payout\(l\.tutor_id, l\.subject\)/);
    expect(bf).toMatch(/\(l\.source = 'hub' OR l\.source IS NULL\)/);
    expect(bf).toMatch(/l\.status <> 'cancelled'/);
    expect(bf).toMatch(/COALESCE\(ld\.tutor_payout, 0\) = 0/);
    expect(bf).toMatch(/COALESCE\(ld\.tutor_payout_status, 'unpaid'\) <> 'paid'/);
    expect(bf).not.toMatch(/SET student_price/);
    expect(bf).toMatch(/RAISE NOTICE 'payout selfheal/);
  });

  it("ланцюг створення деталей перевипущено ідемпотентно; є LIVE-MARKER-NONE і рядок у журналі", () => {
    expect(mig).toMatch(/DROP TRIGGER IF EXISTS trg_lesson_details_autofill ON public\.lesson_details;/);
    expect(mig).toMatch(/DROP TRIGGER IF EXISTS trg_lessons_ensure_details ON public\.lessons;/);
    expect(mig).toMatch(/LIVE-MARKER-NONE/);
    expect(src("docs/PROD-DB-SYNC.md")).toMatch(/20260913200000_payout_autofill_selfheal/);
  });
});

describe("клієнт не пише «0, бо не знаю» у гроші уроку", () => {
  it("SchedulePage (створення/копія менеджером): ціна й виплата йдуть у патч лише коли > 0", () => {
    const sp = src("src/pages/SchedulePage.tsx");
    expect(sp).not.toMatch(/d\.tutor_payout = Number\(form\.tutor_payout\) \|\| 0/);
    expect(sp).not.toMatch(/d\.student_price = Number\(form\.student_price\) \|\| 0/);
    expect(sp).toMatch(/if \(payout > 0\) d\.tutor_payout = payout;/);
    expect(sp).toMatch(/if \(price > 0\) d\.student_price = price;/);
  });
  it("дайджест каже правду: «без суми виплати», а не «без ставки»", () => {
    const d = src("supabase/functions/tutor-daily-digest/index.ts");
    expect(d).toContain("без суми виплати");
    expect(d).not.toContain("без ставки виплати");
  });
});
