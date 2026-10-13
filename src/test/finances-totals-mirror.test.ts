/**
 * M2: finances_period_totals (SQL) мусить ДОСЛІВНО дзеркалити isBillableLesson,
 * paidIncome, paidExpense, grossMarkupPct із src/lib/financials.ts.
 *
 * Бази в тестах нема, тому це tripwire на ТЕКСТ: кожне правило з TS має свій
 * незамінний відбиток у SQL. Хтось змінить одну сторону — тест упаде і скаже,
 * яку саме. Разом із клієнтським паритетом (dbTotals vs масив без обрізання)
 * це дві незалежні сітки під одним числом.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const migDir = join(root, "supabase/migrations");
/* Аудит 03.09: фільтр по імені файла не бачив ані копію, яку створює Lovable
   при застосуванні, ані пізнішу міграцію, що перевипускає функцію. Беремо
   ОСТАННІЙ за таймстемпом файл, у якому функція взагалі оголошена. */
const sqlFile = readdirSync(migDir)
  .filter((f) => f.endsWith(".sql"))
  .filter((f) => readFileSync(join(migDir, f), "utf8").includes("FUNCTION public.finances_period_totals"))
  .sort().at(-1)!;
const sql = readFileSync(join(migDir, sqlFile), "utf8");
const viewFile = readdirSync(migDir)
  .filter((f) => f.endsWith(".sql"))
  .filter((f) => readFileSync(join(migDir, f), "utf8").includes("CREATE VIEW public.lessons_visible"))
  .sort().at(-1)!;
const viewSql = readFileSync(join(migDir, viewFile), "utf8");

/* Негативні перевірки мусять дивитись на КОД, а не на коментарі: у коментарі
   міграції цитується стара помилкова конструкція — саме щоб її було видно. */
const stripSqlComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*--.*$/gm, " ");
const sqlCode = stripSqlComments(sql);
const viewCode = stripSqlComments(viewSql);
const ts = readFileSync(join(root, "src/lib/financials.ts"), "utf8");
const page = readFileSync(join(root, "src/pages/FinancesPage.tsx"), "utf8");

describe("finances_period_totals дзеркалить financials.ts", () => {
  it("SQL читає lessons_visible як SECURITY INVOKER (маскування успадковане, не переписане)", () => {
    expect(sqlCode).toMatch(/SECURITY INVOKER/);
    expect(sqlCode).toMatch(/FROM public\.lessons_visible/);
    expect(sqlCode).not.toMatch(/SECURITY DEFINER/);
  });

  /* ⛔ Аудит 03.09: функція читала БАЗОВУ lesson_participants, де грошові
     колонки відкликані у authenticated (20260720000000) — тобто падала з
     42501 у кожного, а клієнтський фолбек мовчки повертав підрахунок із 500
     обрізаних рядків. Гроші мусять читатися з маскованого в'ю. */
  it("групові гроші — з lesson_participants_visible, а не з базової таблиці", () => {
    expect(sqlCode).toMatch(/FROM public\.lesson_participants_visible/);
    /* Точна умова: грошові колонки не читаються з БАЗОВОЇ таблиці. Сама
       lessons_visible приєднує lesson_participants заради валюти — це
       дозволено, currency в GRANT є. */
    expect(sqlCode).not.toMatch(/lp\.student_price/);
    expect(sqlCode).not.toMatch(/lp\.student_payment_status/);
  });

  /* ⛔ Аудит 03.09: LEFT JOIN student_rates по (tutor_id, student_id) множив
     КОЖЕН урок на кількість предметів пари — унікальність там по
     (tutor_id, student_id, subject). Дохід і борг подвоювались. */
  it("lessons_visible бере ставку рівно однією (LATERAL … LIMIT 1)", () => {
    expect(viewCode).toMatch(/LEFT JOIN LATERAL/);
    expect(viewCode).toMatch(/FROM public\.student_rates r/);
    expect(viewCode).toMatch(/LIMIT 1/);
    expect(viewCode).not.toMatch(/LEFT JOIN public\.student_rates sr\s*\n\s*ON /);
  });

  it("isBillableLesson: cancelled → лише з is_cancellation_fee і price>0", () => {
    expect(ts).toMatch(/is_cancellation_fee === true && Number\(l\.student_price \?\? 0\) > 0/);
    expect(sql).toMatch(/status = 'cancelled' THEN r\.is_cancellation_fee IS TRUE AND coalesce\(r\.student_price,0\) > 0/);
  });

  it("isBillableLesson: pending → ніколи; completed → завжди", () => {
    expect(ts).toMatch(/status === "pending"\) return false/);
    expect(ts).toMatch(/status === "completed"\) return true/);
    expect(sql).toMatch(/status = 'pending'\s+THEN false/);
    expect(sql).toMatch(/status = 'completed' THEN true/);
  });

  it("isBillableLesson: інакше — минулий АБО оплата; tutor_payout_status рахується лише для НЕгрупових", () => {
    expect(ts).toMatch(/l\.student_payment_status === "paid" \|\| \(!l\.is_group && l\.tutor_payout_status === "paid"\)/);
    expect(sql).toMatch(/r\.starts_at < now\(\)/);
    expect(sql).toMatch(/r\.student_payment_status = 'paid'/);
    expect(sql).toMatch(/NOT r\.is_group AND r\.tutor_payout_status = 'paid'/);
  });

  it("paidIncome / paidExpense: ті самі фільтри; витрати — не групи", () => {
    expect(ts).toMatch(/filter\(\(l\) => l\.student_payment_status === "paid"\)/);
    expect(ts).toMatch(/filter\(\(l\) => l\.tutor_payout_status === "paid"\)/);
    expect(sql).toMatch(/sum\(student_price\) FILTER \(WHERE student_payment_status = 'paid'\)/);
    expect(sql).toMatch(/sum\(tutor_payout\)\s+FILTER \(WHERE NOT is_group AND tutor_payout_status = 'paid'\)/);
  });

  it("grossMarkupPct: лише рядки з price>0 AND payout>0 — в обох", () => {
    expect(ts).toMatch(/Number\(l\.student_price \?\? 0\) > 0 && Number\(l\.tutor_payout \?\? 0\) > 0/);
    expect(sql).toMatch(/coalesce\(student_price,0\) > 0 AND coalesce\(tutor_payout,0\) > 0/);
  });

  it("клієнт: RPC-число використовується з фолбеком, а розбіжність із масивом ПОКАЗУЄТЬСЯ", () => {
    expect(page).toMatch(/finances_period_totals/);
    expect(page).toMatch(/dbTotals \? dbTotals\.paid_income : arrIncome/);
    expect(page).toMatch(/totalsParity === false/);
    expect(page).toMatch(/finances\.totalsParityMismatch/);
  });
});

/**
 * САМОЗВІРКА БОРГІВ — 13.10, скарга власниці. Вона переслала рядок бейджа
 * дослівно: «⚠️ Розбіжність із базою: у базі 850 ₴, у застосунку 500 ₴».
 *
 * Із цього рядка не можна зробити нічого. Бейдж показував СУМУ двох половин
 * («учні винні» + «школа винна репетиторам»), хоч `ok` рахувався по кожній
 * окремо з аудиту 05.09 — тобто перевірка знала відповідь і викидала її.
 * Гірше: вона кричала там, де порівнювала непорівнюване — бо
 * `manager_debts_summary()` не приймає репетитора, а клієнтські суми зважають
 * на фільтр «Репетитор», і бо клієнт читає лише останній рік зі стелею 500
 * рядків. Тривога, що спрацьовує на справному стані, вчить ігнорувати тривогу.
 */
describe("самозвірка боргів: бейдж називає половину і не кричить дарма", () => {
  const debtsFile = readdirSync(migDir)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => readFileSync(join(migDir, f), "utf8").includes("FUNCTION public.manager_debts_summary"))
    .sort().at(-1)!;
  const debtsSql = readFileSync(join(migDir, debtsFile), "utf8");

  it("SQL-функція НЕ приймає репетитора — тому фільтр мусить знімати бейдж", () => {
    // Доказ, що гард нижче потрібен, а не параноя: підпис без аргументів.
    expect(stripSqlComments(debtsSql)).toMatch(/FUNCTION public\.manager_debts_summary\(\)/);
    expect(page, "з вибраним репетитором клієнт — підмножина школи")
      .toMatch(/if \(tutorFilter !== "all"\) \{ setParity\(null\); return; \}/);
    expect(page, "інакше бейдж лишався б із числами попереднього стану")
      .toMatch(/\}, \[isManager, loading, tutorFilter, truncatedYear, pendingIncome, pendingExpense\]\);/);
  });

  it("кожна половина звіряється зі СВОЇМ числом, і сум більше немає", () => {
    expect(page).toMatch(/inOk: Math\.abs\(inDb - pendingIncome\) <= 1/);
    expect(page).toMatch(/outOk: Math\.abs\(outDb - pendingExpense\) <= 1/);
    expect(page, "саме ця сума й зʼїла відповідь").not.toMatch(/db: inDb \+ outDb/);
    expect(page, "одного прапорця «ok» на дві половини більше нема").not.toMatch(/parity\.ok\b/);
  });

  it("бейдж каже, ЯКА половина розійшлась", () => {
    expect(page).toMatch(/finances\.parityMismatchIn/);
    expect(page).toMatch(/finances\.parityMismatchOut/);
    expect(page, "сумарний рядок 850/500 більше не рендериться")
      .not.toMatch(/t\("finances\.parityMismatch"/);
    // Жовтим світиться та плитка, що розійшлась, а не обидві.
    expect(page).toMatch(/tone=\{parity && !parity\.inOk \? "warning" : pendingIncome > 0/);
    expect(page).toMatch(/tone=\{parity && !parity\.outOk \? "warning" : "neutral"\}/);
  });

  it("обрізаний масив — це «звірка неповна», а не «розбіжність»", () => {
    expect(page).toMatch(/partial: !!truncatedYear/);
    expect(page, "неповнота не малюється як дефект грошей")
      .toMatch(/if \(parity\.partial\) return \{ ok: true, lines: \[t\("finances\.parityPartial"\)\] \};/);
  });

  it("предикати боргу в SQL і TS лишаються тим самим правилом", () => {
    const code = stripSqlComments(debtsSql);
    // Борг учня: проведений (або скасований зі штрафом) + ціна > 0 + не оплачений.
    expect(code).toMatch(/l\.status = 'completed'\s*\n?\s*OR \(l\.status = 'cancelled' AND coalesce\(ld\.is_cancellation_fee,false\)\)/);
    expect(ts).toMatch(/if \(l\.status === "cancelled"\) return l\.is_cancellation_fee === true;/);
    // Виплата: лише проведене, ніколи групові рядки.
    expect(code).toMatch(/l\.status = 'completed' OR l\.starts_at <= now\(\)/);
    expect(code, "виплата рахується лише по негрупових уроках").toMatch(/l\.group_id IS NULL/);
    expect(ts).toMatch(/if \(l\.is_group\) return false;/);
  });
});

/**
 * БОРГ БЕЗ ПЕРІОДУ — і на клієнті теж (інваріант 04.09, рішення власниці).
 *
 * `manager_debts_summary()` рахує дебіторку по ВСІЙ історії. Клієнт читав
 * гроші одним запитом із `starts_at >= now() - 365 днів` (M2, заради швидкості
 * оборотів) — і цим накладав період на величину, яка періоду не має. Дату уроку
 * ставить людина, тож зворотно датований урок (закритий минулий рік, перенесений
 * облік) просто зникав із «Учні винні», а бейдж самозвірки казав «у базі 850 ₴,
 * у застосунку 500 ₴» і не казав, чому. Фільтр місяця керує ОБОРОТАМИ; дебіторка
 * з нього не зникає — так само, як у `periodStudentDebts`, що навмисно НЕ
 * фільтрується по періоду.
 */
describe("борг без періоду: клієнт дочитує дебіторку поза річним вікном", () => {
  it("є окреме читання, що СТРОГО доповнює вікно оборотів", () => {
    expect(page, "вікно оборотів лишається як було").toMatch(/\.gte\("starts_at", oneYearAgo\)/);
    expect(page, "доповнення: старіше за межу І не оплачено")
      .toMatch(/\.lt\("starts_at", edge\)\s*\n\s*\.eq\("student_payment_status", "unpaid"\)/);
    expect(page, "групова половина боргу теж дочитується")
      .toMatch(/\.lt\("starts_at", edge\)\s*\n\s*\.eq\("status", "completed"\)/);
  });

  it("рядки Й ІМЕНА беруться зі злитих масивів — старий борг не приїжджає як «—»", () => {
    expect(page).toMatch(/const indivRaw = dedupeById\(/);
    expect(page).toMatch(/const groupRaw = dedupeById\(/);
    expect(page).toMatch(/const mapped: LessonRow\[\] = indivRaw\.map\(/);
    expect(page).toMatch(/const groupRows: LessonRow\[\] = groupRaw\.flatMap\(/);
    // Збір id для профілів — із тих самих масивів, інакше імені в боргу не буде.
    expect(page).toMatch(/indivRaw\.forEach\(\(l\) => \{\s*\n\s*if \(l\.student_id\) profileIds\.add/);
    expect(page).toMatch(/groupRaw\.forEach\(\(l\) => \{/);
    expect(page, "рядки більше не будуються з необʼєднаного масиву")
      .not.toMatch(/LessonRow\[\] = \(\(lessonsData \?\? \[\]\) as any\[\]\)/);
  });

  it("збій цих читань — чесний збій, а не «боргів немає»", () => {
    // Інваріант 22.09: збій читання грошей НІКОЛИ не стає «все закрито».
    expect(page).toMatch(/if \(lErr \|\| gErr \|\| txErr \|\| balErr \|\| rErr \|\| odErr \|\| ogErr\) \{/);
  });

  it("дебіторка на клієнті лишається без фільтра періоду", () => {
    // Сусідній інваріант, який і робить це читання осмисленим.
    expect(page).toMatch(/const periodStudentDebts = useMemo\(\s*\n\s*\(\) => tutorScoped\.filter\(\(l\) => isStudentDebtLesson\(l\)\),/);
  });
});
