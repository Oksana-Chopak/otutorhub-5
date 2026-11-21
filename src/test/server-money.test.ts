/**
 * ГРОШІ В СЕРВЕРНИХ ПОВІДОМЛЕННЯХ (21.11, скарга власниці).
 *
 * «Мені в Telegram приходять борги від нової учениці 28 гривень, тоді як вона оплачує 14 євро
 * за урок.» Ранковий дайджест складав ціни уроків і дописував «₴»; валюта ж живе на ПАРІ
 * (`student_rates.currency`). Той самий дефект мали тижневий дайджест, нагадування про оплату
 * з кнопки (текст ішов батькам), лист-нагадування, штраф за скасування, підсумки заробітку.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Money, money, fmtNum, sym, pickCurrency, loadCurrencies, PAYOUT_CURRENCY } from "../../supabase/functions/_shared/money";

const read = (p: string) => readFileSync(p, "utf8");
const rate = (o: Partial<{ tutor_id: string; student_id: string; subject: string | null; currency: string | null; archived_at: string | null; created_at: string | null }>) =>
  ({ tutor_id: "t", student_id: "s", subject: null, currency: "UAH", archived_at: null, created_at: "2026-01-01", ...o });

/** Службовий клієнт-двійник: віддає ціни пар сторінками, як справжній API. */
function fakeSb(rows: ReturnType<typeof rate>[], fail = false) {
  return {
    from: () => {
      let ids: string[] = [];
      const q: any = {
        select: () => q,
        in: (_c: string, v: string[]) => { ids = v; return q; },
        order: () => q,
        range: async (a: number, b: number) => fail
          ? { data: null, error: { message: "мережа" } }
          : { data: rows.filter((r) => ids.includes(r.tutor_id)).slice(a, b + 1), error: null },
      };
      return q;
    },
  };
}

describe("випадок власниці: учениця платить 14 € за урок", () => {
  it("два неоплачені уроки — це «28 €», а не «28 ₴»", async () => {
    const lessons = [
      { tutor_id: "petro", student_id: "nova", subject: "Німецька", price: 14 },
      { tutor_id: "petro", student_id: "nova", subject: "Німецька", price: 14 },
    ];
    const cur = await loadCurrencies(fakeSb([rate({ tutor_id: "petro", student_id: "nova", subject: "Німецька", currency: "EUR" })]), lessons);
    const debt = new Money();
    for (const l of lessons) debt.add(l.price, cur.of(l));
    expect(cur.failed).toBe(false);
    expect(debt.text()).toBe("28 €");
  });

  it("школа з гривневими учнями і однією євровою: суми НЕ складаються в одне число", async () => {
    const cur = await loadCurrencies(fakeSb([
      rate({ tutor_id: "petro", student_id: "nina", currency: "UAH" }),
      rate({ tutor_id: "petro", student_id: "nova", currency: "EUR" }),
    ]), [{ tutor_id: "petro", student_id: "nina" }, { tutor_id: "petro", student_id: "nova" }]);
    const total = new Money();
    total.add(600, cur.of({ tutor_id: "petro", student_id: "nina" }));
    total.add(600, cur.of({ tutor_id: "petro", student_id: "nina" }));
    total.add(28, cur.of({ tutor_id: "petro", student_id: "nova" }));
    expect(total.text()).toBe("1 200 ₴ + 28 €");
    expect(total.currencies.sort()).toEqual(["EUR", "UAH"]);
  });

  it("валюти не прочитались — це «не знаю», а не мовчазна гривня", async () => {
    const cur = await loadCurrencies(fakeSb([], true), [{ tutor_id: "petro", student_id: "nova" }]);
    expect(cur.failed).toBe(true);
  });
});

describe("pickCurrency — дзеркало вʼю lessons_visible", () => {
  it("пари немає в цінах → гривня (так само вирішує застосунок)", () => {
    expect(pickCurrency([], { subject: "Англійська" })).toBe("UAH");
  });
  it("архівна ціна не рахується", () => {
    expect(pickCurrency([rate({ currency: "EUR", archived_at: "2026-10-01" }), rate({ currency: "UAH" })], {})).toBe("UAH");
    expect(pickCurrency([rate({ currency: "EUR", archived_at: "2026-10-01" })], {})).toBe("UAH");
  });
  it("кілька цін у пари: береться та, що на предмет уроку; інакше найновіша", () => {
    const rates = [
      rate({ subject: "Англійська", currency: "UAH", created_at: "2026-11-01" }),
      rate({ subject: "Німецька", currency: "EUR", created_at: "2026-09-01" }),
    ];
    expect(pickCurrency(rates, { subject: "Німецька" })).toBe("EUR");
    expect(pickCurrency(rates, { subject: "Англійська" })).toBe("UAH");
    expect(pickCurrency(rates, { subject: "Фізика" })).toBe("UAH");
  });
  it("код валюти — великими літерами, як у базі", () => {
    expect(pickCurrency([rate({ currency: "eur" })], {})).toBe("EUR");
  });
});

describe("форматування", () => {
  it("знак валюти; невідомий код показується як є, а не гривнею", () => {
    expect(sym("EUR")).toBe("€");
    expect(sym("UAH")).toBe("₴");
    expect(sym("SEK")).toBe("kr");
    expect(sym("CHF")).toBe("CHF");
    expect(sym(null)).toBe("₴");
  });
  it("числа: тисячі через пробіл, копійки лише коли вони є", () => {
    expect(fmtNum(10200)).toBe("10 200");
    expect(fmtNum(14)).toBe("14");
    expect(fmtNum(14.5)).toBe("14,5");
    expect(fmtNum(1234567.25)).toBe("1 234 567,25");
    expect(money(28, "EUR")).toBe("28 €");
    expect(money(4800, "UAH")).toBe("4 800 ₴");
  });
  it("Money: нулі не рахуються; порожня сума — «0 ₴»; вага для впорядкування", () => {
    const m = new Money().add(0, "EUR").add(null, "UAH");
    expect(m.any).toBe(false);
    expect(m.text()).toBe("0 ₴");
    m.add(100, "USD").add(50, "USD").add(300, "UAH");
    expect(m.text()).toBe("300 ₴ + 150 $");
    expect(m.of("usd")).toBe(150);
    expect(m.weight).toBe(450);
  });
  it("виплата репетиторові школи — у валюті школи, не у валюті учня", () => {
    expect(PAYOUT_CURRENCY).toBe("UAH");
    const ev = read("supabase/functions/tutor-evening-summary/index.ts");
    expect(ev).toMatch(/l\.source === "independent" \? \(curOfPair\.get\([^)]*\) \?\? "UAH"\) : PAYOUT_CURRENCY/);
  });
});

describe("кожне серверне повідомлення із сумою бере валюту пари", () => {
  const fn = (name: string) => read(`supabase/functions/${name}`);

  it("ранковий дайджест: борги учнів — Money з валютою пари; виплати — у валюті школи", () => {
    const s = fn("tutor-daily-digest/index.ts");
    expect(s).toMatch(/const cur = await loadCurrencies\(sb, moneyRaw \?\? \[\]\)/);
    expect(s).toMatch(/const moneyFailed = !!\(moneyErr \|\| groupErr \|\| cur\.failed\)/);
    expect(s).toMatch(/sd\.add\(detailOf\(l\)\?\.student_price, cur\.of\(l\)\)/);
    expect(s).toMatch(/hubDebt\(l\.student_id\)\.add\(detailOf\(l\)\?\.student_price, cur\.of\(l\)\)/);
    expect(s).toMatch(/noteDebt\(l\.student_id, Number\(detailOf\(l\)\?\.student_price \?\? 0\), l\.source, cur\.of\(l\)\)/);
    expect(s).toMatch(/D\.owe\(money\(po, PAYOUT_CURRENCY\)\)/);
    // учасник групи — зі своєю валютою
    expect(s).toMatch(/lesson_participants\(student_id, student_price, student_payment_status, currency\)/);
  });

  it("тижневий дайджест: отримане й борги — по валютах; список боржників — про тих самих, що й підсумок", () => {
    const s = fn("tutor-weekly-digest/index.ts");
    expect(s).toMatch(/const cur = await loadCurrencies\(sb, \[\.\.\.\(lastWeekRes\.data \?\? \[\]\), \.\.\.\(unpaidRaw \?\? \[\]\)\]\)/);
    expect(s).toMatch(/debtByStudent\(ownDebts\)/);
    expect(s).not.toMatch(/unpaidStudentDebt\(/);
  });

  it("нагадування про оплату: ядро саме визначає валюту, коли її не передали (кнопка, бот)", () => {
    const s = fn("_shared/paymentReminder.ts");
    expect(s).toMatch(/fresh\.some\(\(l\) => !l\.currency\)\s*\? await loadCurrencies\(admin, /);
    expect(s).toMatch(/const curKnown = !curLoad\?\.failed/);
    expect(s).toMatch(/amountText: totalStr \|\| undefined/);
    expect(s).not.toMatch(/amount: total\b/);
  });

  it("лист-нагадування показує суму лише разом із валютою", () => {
    const s = fn("_shared/transactional-email-templates/payment-reminder.tsx");
    expect(s).toMatch(/\{amountText \? \(/);
    expect(s).not.toMatch(/\{amount\} /);
  });

  it("штраф за скасування і підсумки заробітку — теж у валюті пари", () => {
    expect(fn("notify-cancellation-fee/index.ts")).toMatch(/money\(Number\(body\.fee\), cur\.of\(/);
    const sn = fn("scheduled-notifications/index.ts");
    expect(sn).toMatch(/function tutorEarned\(lessons: any\[\], currencyOf: \(l: any\) => string\): Money/);
    expect(sn).not.toMatch(/toFixed\(0\)\} грн/);
  });

  it("нагадування за розкладом: валюта — тим самим каноном; борг пари — по валютах", () => {
    /* Крон брав БУДЬ-ЯКИЙ рядок цін пари (і архівний теж) і складав борг пари в одне число.
       Учень, якого перевели з гривні на євро, міг отримати суму зі старим знаком. */
    const s = read("supabase/functions/payment-reminders/index.ts");
    expect(s).toMatch(/pickCurrency\(ratesByPair\.get/);
    expect(s).toMatch(/"tutor_id, student_id, subject, currency, archived_at, created_at"/);
    expect(s, "учасник групи — у валюті свого рядка").toMatch(/p\.currency \? String\(p\.currency\)/);
    expect(s, "борг пари — Money, не число зі знаком").toMatch(/const sumLine = `\$\{T\.debtTotal\}: \$\{curUnknown \? String\(pair\.total\) : bag\.text\(\)\}`/);
    expect(s, "валюти не прочитались — знак не вигадується").toMatch(/ratesFailed\.has\(studentId\) \? null/);
    expect(s).not.toMatch(/curByPair/);
  });

  it("ворота валют дивляться і в серверні функції", () => {
    const g = read("scripts/check-currency.mjs");
    expect(g).toMatch(/walkEdge\("supabase\/functions"\)/);
    expect(g).toMatch(/hits\.length \|\| edgeHits\.length \|\|/);
  });
});

/* ── той самий клас у застосунку: школа з ученицею, що платить у євро ─────────────────────── */
import { profitByCurrency, sumByCurrency } from "@/lib/financials";
import { PAYOUT_CURRENCY as CLIENT_PAYOUT_CURRENCY } from "@/lib/currency";

describe("екрани школи: гроші учня — у валюті пари, виплата — у валюті школи", () => {
  it("прибуток по валютах: виплати віднімаються лише від валюти школи", () => {
    expect(profitByCurrency([["UAH", 12400], ["EUR", 28]], 4800, "UAH")).toEqual([["UAH", 7600], ["EUR", 28]]);
    // на стенді: отримано 14 €, виплат ще не було → «€14», а не «14 ₴»
    expect(profitByCurrency([["EUR", 14]], 0, "UAH")).toEqual([["EUR", 14]]);
    // школа, де всі платять у євро, а виплати в гривні: відʼємна гривня і євро окремо, не «−286 ₴»
    expect(profitByCurrency([["EUR", 14]], 300, "UAH")).toEqual([["UAH", -300], ["EUR", 14]]);
    expect(profitByCurrency([], 0, "UAH")).toEqual([]);
  });

  it("сума по валютах не зливає євро з гривнями", () => {
    const rows = [{ p: 600, c: "UAH" }, { p: 14, c: "EUR" }, { p: 350, c: "UAH" }, { p: 14, c: "EUR" }];
    expect(sumByCurrency(rows, (r) => r.p, (r) => r.c)).toEqual([["UAH", 950], ["EUR", 28]]);
  });

  it("клієнт і сервер тримають ту саму валюту виплат", () => {
    expect(CLIENT_PAYOUT_CURRENCY).toBe(PAYOUT_CURRENCY);
  });

  it("картка уроку підписує виплату валютою школи, а не учня (було «💼 €300»)", () => {
    const s = read("src/components/LessonCard.tsx");
    expect(s).toMatch(/<PayRow currency=\{PAYOUT_CURRENCY\} icon="💼" amount=\{lesson\.tutor_payout\}/);
    expect(s).toMatch(/<PayRow currency=\{lesson\.currency\} icon="🎓" amount=\{lesson\.student_price\}/);
  });

  it("«Фінанси» менеджера: отримано, борг учнів, очікувані й прибуток — по валютах; виплати — у валюті школи", () => {
    const s = read("src/pages/FinancesPage.tsx");
    expect(s).toMatch(/const paidPayoutLabel = formatPrice\(totalExpense, PAYOUT_CURRENCY\)/);
    expect(s).toMatch(/const duePayoutLabel = formatPrice\(pendingExpense, PAYOUT_CURRENCY\)/);
    expect(s).toMatch(/const profitByCur = profitByCurrency\(incomeByCur, totalExpense, PAYOUT_CURRENCY\)/);
    expect(s).toMatch(/label=\{t\("finances\.studentsOweLabel"\)\}\s*value=\{fmtCurList\(pendingByCur\)\}/);
    expect(s).toMatch(/value=\{fmtCurList\(expectedByCur\)\}/);
    expect(s).toMatch(/studentsOweBannerTitle", \{ sum: fmtCurList\(pendingByCur\) \}/);
    // старі «усе в гривні» підсумки не повертаються
    expect(s).not.toMatch(/formatPrice\(totalIncome, "UAH"\)/);
    expect(s).not.toMatch(/formatPrice\(profit, "UAH"\)/);
    expect(s).not.toMatch(/formatPrice\(pendingIncome, "UAH"\)/);
    expect(s).not.toMatch(/formatPrice\(expectedIncome, "UAH"\)/);
  });

  it("«Мій день» менеджера: прибуток не складає євро з гривнями; сповіщення про виплату — у валюті школи", () => {
    const s = read("src/pages/DashboardPage.tsx");
    expect(s).toMatch(/const managerProfitLabel = useMemo\(/);
    expect(s).not.toMatch(/\{formatPrice\(profit, "UAH"\)\}/);
    expect(s).toMatch(/const amount = formatPrice\(lesson\.tutor_payout, PAYOUT_CURRENCY, \{ decimals: 0 \}\)/);
  });

  it("аналітика школи порівнює оплату з виплатою лише там, де валюта одна", () => {
    /* Урок з оплатою 14 € і виплатою 300 ₴ давав «маржа −2042 %» і тижневий прибуток «14 − 300».
       Без курсу такі уроки з виплатами не порівняти — вони не входять, і екран каже це словами. */
    const s = read("src/pages/FinancesPage.tsx");
    expect(s).toMatch(/const schoolCurBillable = useMemo\(/);
    expect(s, "маржа по репетиторах").toMatch(/schoolCurBillable\.forEach\(\(l\) => \{\s*if \(!groups\[l\.tutor_id\]\)/);
    expect(s, "число націнки з бази складає всі валюти — лише коли інших валют немає")
      .toMatch(/dbTotals\.markup_income > 0 && analyticsForeignCurs\.length === 0/);
    expect(s, "тижневий графік").toMatch(/tutorScoped\.filter\(\(l\) => rowCurrency\(l\) === PAYOUT_CURRENCY\)/);
    expect(s).toMatch(/<ProfitSparkline cur=\{PAYOUT_CURRENCY\}/);
    expect(s, "екран каже словами, чого в аналітиці немає").toMatch(/finances\.analyticsForeignNote/);
    for (const loc of ["uk", "en", "sv"]) expect(read(`src/i18n/locales/${loc}.ts`)).toMatch(/analyticsForeignNote: "/);
  });

  it("прохід «учениця платить у євро» біжить у CI після кожного пушу", () => {
    expect(read(".github/workflows/walks.yml")).toMatch(/node scripts\/local-stack\/currency-walk\.mjs/);
  });
});
