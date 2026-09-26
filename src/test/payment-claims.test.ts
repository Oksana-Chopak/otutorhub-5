import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/**
 * Важіль 4 (аудит шляхів 24.09, рішення власниці «заявка + підтвердження»).
 * Головна межа: кнопка учня НЕ рухає гроші, а підтвердження йде КАНОНІЧНИМ
 * шляхом — тим самим, яким працює форма оплати.
 */
describe("«Я оплатив» — заявка, а не оплата (важіль 4)", () => {
  const mig = () => read("supabase/migrations/20260926170000_payment_claims.sql");

  it("учень не може записати гроші: прямі INSERT/UPDATE відкликані", () => {
    const m = mig();
    expect(m).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.payment_claims FROM authenticated, anon/);
    expect(m, "вбудована перевірка, щоб «застосовано» щось означало")
      .toMatch(/прямий INSERT відкритий — учень зміг би підтвердити собі заявку/);
  });

  it("підтвердження = канонічний шлях грошей (wallet_topup), без другої логіки", () => {
    const m = mig();
    expect(m).toMatch(/public\.wallet_topup\(_claim\.tutor_id, _claim\.student_id, 0, _claim\.amount/);
    expect(m, "кредит гаманця сам закриває неоплачені уроки — це і є «звичайна позначка оплати»")
      .toMatch(/trg_wallet_settle_after_credit/);
  });

  it("заявку створює лише сам учень і лише до СВОГО репетитора", () => {
    const m = mig();
    expect(m).toMatch(/_me\s+uuid := auth\.uid\(\)/);
    expect(m).toMatch(/Not your tutor/);
    expect(m, "анти-спам: одна «в очікуванні» на пару").toMatch(/payment_claims_one_pending/);
    expect(m, "анти-спам: стеля на добу").toMatch(/_today >= 10/);
  });

  it("гроші школи записує менеджер: заявка йде йому, а не хабовому репетитору", () => {
    const m = mig();
    expect(m).toMatch(/FROM public\.hub_managers hm WHERE hm\.hub_id = _hub/);
    expect(m).toMatch(/_me = _claim\.tutor_id OR public\.is_hub_manager_of\(_claim\.tutor_id\)/);
  });

  it("обидві половини є в інтерфейсі, і кнопка учня не позначає оплату сама", () => {
    const btn = read("src/components/IPaidButton.tsx");
    expect(btn).toMatch(/create_payment_claim/);
    expect(btn, "жодного оновлення lesson_details з боку учня")
      .not.toMatch(/lesson_details|student_payment_status/);
    expect(btn, "друга заявка не надсилається — показуємо, що перша в дорозі").toMatch(/iPaid\.waiting/);
    const card = read("src/components/PaymentClaimsCard.tsx");
    expect(card).toMatch(/resolve_payment_claim/);
    expect(card, "святкуємо лише збережене (15.09): конфеті після відповіді бази")
      .toMatch(/setClaims\(\(prev\) => prev\.filter[\s\S]{0,200}burstConfetti\(\)/);
    expect(card, "картки немає, коли заявок немає").toMatch(/if \(claims\.length === 0\) return null;/);
  });

  it("сторінка учня показує кнопку поруч із реквізитами, з підставленою сумою боргу", () => {
    const page = read("src/pages/student/StudentPaymentsPage.tsx");
    expect(page).toMatch(/<IPaidButton/);
    expect(page).toMatch(/amountDue=\{dueByTutor\[tp\.tutor_id\] \?\? 0\}/);
    expect(page, "борг рахується за моделлю 04.09 (isOwedRow), не «усе неоплачене»")
      .toMatch(/rows\.filter\(isOwedRow\)/);
  });

  it("дашборд: картка заявок є в незалежного і в менеджера, нотатки лишились під бульбашками", () => {
    const d = read("src/pages/DashboardPage.tsx");
    expect((d.match(/<PaymentClaimsCard \/>/g) ?? []).length).toBe(2);
    // 🔒 інваріант: нотатки ОДРАЗУ під бульбашками — картка заявок стоїть ПІСЛЯ них
    expect(d).toMatch(/<TutorNotesCard \/>\s*\n\s*\{\/\* Важіль 4[\s\S]{0,300}?<PaymentClaimsCard \/>/);
  });

  it("сценарій бази є, відкочує себе і перевіряє обидві відмови", () => {
    const scen = read("scripts/db-replay/scenarios/90-payment-claims.sql");
    expect(scen).toMatch(/ROLLBACK;\s*$/);
    expect(scen).toMatch(/учень підтвердив собі оплату сам/);
    expect(scen).toMatch(/хабовий репетитор записав гроші школи/);
  });
});
