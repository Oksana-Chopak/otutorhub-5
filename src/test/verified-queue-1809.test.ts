import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  detailsOf,
  paidStudentIncome,
  paidTutorPayout,
  unpaidTutorPayout,
  unpaidStudentDebt,
} from "../../supabase/functions/_shared/digestMoney";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/**
 * Черга «заявлено, ще НЕ перевірено» з аудиту 18.09. Кожну знахідку спершу
 * доведено в коді 27.09, і лише тоді виправлено — саме тому тут є і поведінка,
 * і ратчети на конкретні умови, які були неправильні.
 */
const L = (d: Record<string, unknown> | null) => ({ lesson_details: d });

describe("тижневий дайджест: «Зароблено» = ОТРИМАНЕ", () => {
  const rows = [
    L({ student_price: 500, student_payment_status: "paid", tutor_payout: 300, tutor_payout_status: "paid" }),
    L({ student_price: 700, student_payment_status: "unpaid", tutor_payout: 400, tutor_payout_status: "unpaid" }),
    L({ student_price: 600, student_payment_status: "paid", tutor_payout: 350, tutor_payout_status: "unpaid" }),
  ];

  it("неоплачені уроки в «зароблено» НЕ входять — інакше тиждень удвічі прибутковіший", () => {
    expect(paidStudentIncome(rows)).toBe(1100); // 500 + 600, без 700
  });

  it("хабовий бачить СВОЮ виплату, а не ціну учня (виручку школи)", () => {
    expect(paidTutorPayout(rows)).toBe(300);
    expect(unpaidTutorPayout(rows)).toBe(750);
    expect(paidTutorPayout(rows)).not.toBe(paidStudentIncome(rows));
  });

  it("борг учнів рахується цінами тих рядків, які прийшли як неоплачені", () => {
    expect(unpaidStudentDebt([rows[1]])).toBe(700);
  });

  it("вкладений рядок приходить і обʼєктом, і масивом — обидва читаються", () => {
    const asArray = { lesson_details: [{ student_price: 100, student_payment_status: "paid" }] };
    expect(detailsOf(asArray as any)?.student_price).toBe(100);
    expect(paidStudentIncome([asArray as any])).toBe(100);
    expect(detailsOf(L(null) as any)).toBeNull();
    expect(paidStudentIncome([L(null)])).toBe(0);
  });

  it("порожнє й сміттєве не ламає суму", () => {
    expect(paidStudentIncome([])).toBe(0);
    expect(paidStudentIncome([L({ student_price: null, student_payment_status: "paid" })])).toBe(0);
  });

  it("функція дайджесту користується КАНОНОМ, а не власною сумою", () => {
    const d = read("supabase/functions/tutor-weekly-digest/index.ts");
    expect(d).toMatch(/from "\.\.\/_shared\/digestMoney\.ts"/);
    /* 01.10: формула більше не залежить від ОДНОГО прапорця на людину — кожен
       урок рахується за власним `source`. Інваріант той самий і навіть сильніший:
       ціна учня ніколи не стає «зароблено» хабового, а виплата ніколи не
       підміняє дохід самостійного. Змішаний репетитор (школа + свої учні) тепер
       теж рахується правильно. */
    expect(d).toMatch(/const ownLessons = wLessons\.filter\(\(l: any\) => l\.source === "independent"\);/);
    expect(d).toMatch(/const hubLessons = wLessons\.filter\(\(l: any\) => l\.source !== "independent"\);/);
    /* 21.11: ці дві половини більше не складаються в одне число — свої оплати йдуть у валютах
       своїх учнів, виплати школи — у валюті школи (учениця з ціною 14 € давала «28 ₴»). Інваріант
       той самий: ціна учня школи ніколи не стає «зароблено» хабового. */
    expect(d, "«зароблено» = свої оплати за свої уроки, по валютах пар")
      .toMatch(/const ownIncome = paidIncomeBag\(ownLessons\);/);
    expect(d, "виплати за хабові — окремим рядком")
      .toMatch(/const payoutsGot = paidTutorPayout\(hubLessons\);/);
    expect(d, "хабовому «очікують оплати» — його виплати, не борги учнів школі")
      .toMatch(/const pendingPayout = unpaidTutorPayout\(hubLessons\);/);
    expect(d, "борг учнів — лише зі СВОЇХ уроків, інакше це гроші школи")
      .toMatch(/const debtTotal = debtBag\(ownDebts\);/);
    expect(d, "підпис рядка мусить відрізнятись — це різні гроші")
      .toMatch(/Отримано виплат/);
  });

  it("читання «по всій платформі» — сторінками, і збій каже словами", () => {
    const d = read("supabase/functions/tutor-weekly-digest/index.ts");
    // 01.10: четверте — рядки налаштувань (персони). Доти воно йшло звичайним
    // `.select()` і обрізалось на ~1000 рядків без помилки.
    expect((d.match(/fetchAllRows</g) ?? []).length, "чотири платформених читання").toBe(4);
    expect((d.match(/\.order\("id"\)/g) ?? []).length,
      "кожне сторінкове читання мусить мати стабільний порядок").toBeGreaterThanOrEqual(3);
    expect(d).toMatch(/const moneyReadFailed = !!\(lastWeekRes\.error \|\| unpaidRes\.error \|\| cur\.failed\);/);
    expect(d, "нуль замість суми читався б як «усе закрито»")
      .toMatch(/if \(moneyReadFailed\) lines\.push/);
  });

  it("персона репетитора — з SOURCE уроку, а «не знаю» = ХАБОВИЙ", () => {
    const d = read("supabase/functions/tutor-weekly-digest/index.ts");
    expect(d, "hub_id персони не визначає — тригер штампує його будь-кому")
      .toMatch(/select\("tutor_id, independent_workspace"\)/);
    /* `!== false` означало «не знаю → самостійний» і віддавало хабовому
       репетитору виручку школи. Безпечний бік — ХАБОВИЙ, як у Фінансах. */
    expect(d).not.toMatch(/isIndependentTutorOf\.get\(userId\) !== false/);
    expect(d).toMatch(/isIndependentTutorOf\.get\(userId\) === true/);
  });
});

describe("MCP: інструмент оплат більше не порожній завжди", () => {
  it("статусу «pending» у домені немає — фільтр на «unpaid»", () => {
    for (const f of ["src/lib/mcp/tools/list-pending-payments.ts", "supabase/functions/mcp/index.ts"]) {
      expect(read(f), `${f} не має шукати статус, якого не існує`)
        .not.toMatch(/student_payment_status", "pending"/);
      expect(read(f)).toMatch(/student_payment_status", "unpaid"/);
    }
  });
});

describe("роль вирішує, що людина бачить (аудит 18.09)", () => {
  it("деталі уроку не ведуть хабового на сторінку, якої в нього немає", () => {
    const d = read("src/components/LessonDetailsDialog.tsx");
    expect(d, "умова tutor && !manager була true і для ХАБОВОГО")
      .not.toMatch(/const isTutorViewer = roles\.includes\("tutor"\) && !roles\.includes\("manager"\);/);
    expect(d).toMatch(/const isTutorViewer = canSee\("ownStudents", flags\);/);
  });

  it("«закрити день»: пакети шукаються по парах РЯДКІВ, не по парах глядача", () => {
    const c = read("src/components/CloseDayDialog.tsx");
    expect(c, "менеджер не є репетитором цих уроків — його пари порожні")
      .not.toMatch(/\.eq\("tutor_id", user\.id\)\s*\n\s*\.in\("student_id", ids\)/);
    expect(c).toMatch(/\.in\("tutor_id", tutorIds\)/);
    expect(c, "ключ — ПАРА: один учень може мати пакети в різних репетиторів")
      .toMatch(/m\[`\$\{b\.tutor_id\}:\$\{b\.student_id\}`\]/);
    expect(c).toMatch(/packMap\[`\$\{r\.tutor_id\}:\$\{r\.student_id\}`\]/);
  });

  it("менеджер вирішує про плату за скасування, а не читає записку про себе", () => {
    const t = read("src/components/TutorChangeRequestsCard.tsx");
    expect(t).toMatch(/const canDecideCharge = isIndependent \|\| isManager;/);
    // усі три місця, де раніше стояв лише isIndependent
    expect(t).toMatch(/\{canDecideCharge \? \(/);
    expect(t).toMatch(/if \(canDecideCharge\) \{/);
    expect(t).toMatch(/const feeApplied = active\.kind === "cancel" && canDecideCharge && chargeChoice !== "none";/);
    expect(t, "хабовому репетитору записка лишається — ціну задає не він")
      .toMatch(/hubCancelNote/);
  });
});

describe("екран виплат більше не штампує гривню", () => {
  const f = () => read("src/pages/FinancesPage.tsx");

  it("виплати — у валюті ШКОЛИ, одним числом (21.11: правило 27.09 «валюта пари» скасовано)", () => {
    /* 27.09 виплату підписували валютою пари. Для школи це неправда: ставка виплати валюти не має
       й задається у валюті школи, а валюта пари — це те, чим платить учень. Учениця з ціною 14 €
       давала «Винні репетиторам €900 + 250 ₴» замість 1 150 ₴. Константа одна на клієнт і сервер. */
    const s = f();
    expect(s).toMatch(/const paidPayoutLabel = formatPrice\(totalExpense, PAYOUT_CURRENCY\);/);
    expect(s).toMatch(/const duePayoutLabel = formatPrice\(pendingExpense, PAYOUT_CURRENCY\);/);
    expect(s).not.toMatch(/payoutCurs/);
  });

  it("жодного formatPrice(totalExpense|pendingExpense, \"UAH\") не лишилось — ні в хабового, ні в менеджера", () => {
    expect(f()).not.toMatch(/formatPrice\((totalExpense|pendingExpense), "UAH"\)/);
    expect(f(), "менеджерські плитки виплат беруть той самий підпис")
      .toMatch(/label=\{t\("finances\.payouts"\)\} value=\{paidPayoutLabel\}/);
  });

  it("ратчет зашитої гривні опущено — виграш не відкотиться", () => {
    expect(read("scripts/check-currency.mjs")).toMatch(/const MAX_UAH_ARGS = 37;/);
  });
});
