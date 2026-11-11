/**
 * ПЕРША ЗОВНІШНЯ ШКОЛА (11.11) — розтяжки на те, що знайшов живий прохід.
 *
 * Прохід «власниця школи зареєструвалась → її підключили → вона додає репетитора,
 * учнів, урок, групу → усі реєструються» зупинявся в шести місцях: чотири в базі
 * (їх тримає сценарій 77-school-launch.sql, що біжить під справжніми ролями) і ще
 * кілька в інтерфейсі — глухі кути, яких жоден сценарій бази не бачить. Поведінку
 * інтерфейсу доводить `scripts/local-stack/school-walk.mjs` (справжній браузер проти
 * справжньої бази); ці розтяжки стережуть, щоб правки не повернулись тихо, і
 * перевіряють НАМІР, а не форму рядка (урок 06.11).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname ?? __dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const MIG = "supabase/migrations/20261111120000_school_launch.sql";
const SC = "scripts/db-replay/scenarios/77-school-launch.sql";
/** код без коментарів — щоб пояснення в коментарі не рахувалось за сам код */
const code = (src: string) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("база: сценарій і міграція першої школи", () => {
  it("сценарій і живий прохід існують", () => {
    for (const p of [SC, MIG, "scripts/local-stack/school-walk.mjs", "scripts/local-stack/gateway.mjs"]) {
      expect(existsSync(join(ROOT, p)), `${p} зник`).toBe(true);
    }
  });

  it("сценарій робить записи під ролями людей і реєструє власниць шкіл як на сайті", () => {
    const sc = read(SC);
    expect(sc).toMatch(/set_config\('role', 'authenticated', true\)/);
    // власниця школи реєструється САМА → independent_workspace = true: саме це ламало уроки
    expect(sc).toMatch(/'independent_workspace', _role = 'tutor'/);
    // перевірка «старого id немає ніде» йде по ВСІХ uuid-колонках, не по списку таблиць
    expect(sc).toMatch(/information_schema\.columns[\s\S]{0,400}data_type = 'uuid'/);
    for (const n of ["(1)", "(2)", "(3)", "(4)", "(5)", "(6)", "(7)", "(8)", "(9)"]) {
      expect(sc, `сценарій друкує ✅ ${n}`).toContain(`✅ ${n}`);
    }
  });

  it("злиття запрошеного профілю не має жорсткого списку таблиць", () => {
    const m = read(MIG);
    const core = m.slice(m.indexOf("FUNCTION public.merge_pending_profile_core"), m.indexOf("FUNCTION public.merge_pending_profile(_real_id"));
    expect(core).toMatch(/FROM public\.person_ref_columns\(\)/);
    // збій злиття не лишається невидимим WARNING
    expect(m.slice(m.indexOf("FUNCTION public.merge_pending_profile(_real_id"))).toMatch(/INSERT INTO public\.error_log/);
  });

  it("суперадмін дивиться крізь лінзу: предикати шкіл більше не «true для суперадміна»", () => {
    const m = read(MIG);
    for (const fn of ["is_hub_scoped", "is_hub_member"]) {
      const body = m.slice(m.indexOf(`FUNCTION public.${fn}(`), m.indexOf("$$;", m.indexOf(`FUNCTION public.${fn}(`)));
      expect(body, `${fn} питає лінзу`).toMatch(/admin_lens_allows/);
      expect(body, `${fn}: голого «OR is_superadmin()» немає`).not.toMatch(/OR public\.is_superadmin\(\)\s*\n/);
    }
  });
});

describe("інтерфейс: шлях власниці школи без глухих кутів", () => {
  const people = code(read("src/pages/PeoplePage.tsx"));

  it("учневі, який ще не зареєструвався, можна призначити репетитора", () => {
    const at = people.indexOf("onClick={openAssignTutor}");
    expect(at, "кнопка «Призначити репетитора» є").toBeGreaterThan(0);
    const guard = people.slice(people.lastIndexOf('{isManager && u.role === "student"', at), at);
    expect(guard, "дії учня не сховані за «уже зареєстрований»").not.toMatch(/!u\.is_pending/);
  });

  it("роль «менеджер» у формі «Нова людина» не пропонується (її видає лише платформа)", () => {
    const tabs = people.slice(people.indexOf('role="tablist"'), people.indexOf('role="tablist"') + 400);
    expect(tabs).not.toMatch(/"manager"/);
  });

  it("після додавання учня менеджера веде до призначення репетитора, а не у форму-тупик", () => {
    expect(people).toMatch(/onAssignTutor=\{isManager && invite\.role === "student"/);
    const dlg = code(read("src/components/InviteLinkDialog.tsx"));
    expect(dlg).toMatch(/onAssignTutor \?/);
    expect(dlg, "запрошення від школи називає школу").toMatch(/introTutorSchool/);
  });

  it("після прикріплення — місток у форму уроку з уже обраними репетитором і учнем", () => {
    expect(people).toMatch(/\/schedule\?create=1&student=\$\{sid\}&tutor=\$\{tid\}/);
    expect(code(read("src/pages/SchedulePage.tsx"))).toMatch(/initialTutorId=\{quickTutorId\}/);
  });

  it("форма уроку каже менеджеру правду про порожній стан — три різні причини", () => {
    const q = code(read("src/components/QuickLessonDialog.tsx"));
    for (const k of ["managerNoTutorsHint", "managerPickTutorHint", "managerNoPairsHint"]) {
      expect(q, k).toContain(`quickLessonDialog.${k}`);
    }
  });

  it("урок із посилання не народжується «зараз, до хвилини»", () => {
    const s = code(read("src/pages/SchedulePage.tsx"));
    expect(s).not.toMatch(/setQuickSlot\(new Date\(\)\)/);
  });

  /* 11.11, рішення власниці: виплата за групове заняття Є (ставка «за групове заняття»).
     Тож груповий урок без виплати каже «ставку не задано» так само, як індивідуальний,
     а дотик веде у ту саму форму ставки — одразу на поле групової. */
  it("груповий урок без виплати теж каже «ставку не задано», і кнопка веде в поле групової ставки", () => {
    const card = code(read("src/components/LessonCard.tsx"));
    const line = card.split("\n").find((l) => l.includes("const payoutMissing"))!;
    expect(line).not.toMatch(/group_id/);
    for (const p of ["src/pages/DashboardPage.tsx", "src/pages/SchedulePage.tsx"]) {
      const s = read(p);
      expect(s, p).toMatch(/subject: lesson\.group_id \? null : lesson\.subject \?\? null, group: !!lesson\.group_id/);
      expect(s, p).toMatch(/focusGroup=\{rateFor\?\.group\}/);
    }
    const dlg = read("src/components/TutorRateDialog.tsx");
    expect(dlg).toMatch(/const GROUP_RATE_COL = "group_rate_per_lesson"/);
    expect(dlg, "колонки ще немає в базі → поля немає, і ми її не пишемо").toMatch(/if \(groupRate !== null\) \{/);
    expect(dlg, "безпечне збереження діє і для групової").toMatch(/if \(gr\.error \|\| td\.error \|\| sr\.error\) setGroupRate\(null\)/);
  });

  it("виплата за групове — у «Фінансах» окремим рядком на урок, і в тих самих підсумках", () => {
    const fin = read("src/pages/FinancesPage.tsx");
    expect(fin).toMatch(/kind: "groupPayout" as const/);
    expect(fin, "доходи, борги учнів і аналітика цих рядків не бачать").toMatch(/lessons\.filter\(\(l\) => l\.kind !== "groupPayout" &&/);
    expect(fin).toMatch(/\[\.\.\.tutorScoped, \.\.\.groupPayoutScoped\]\.filter\(\(l\) => isPayoutDueLesson\(l, nowMs\)\)/);
    expect(fin).toMatch(/paidExpense\(periodBillable\) \+ paidExpense\(periodGroupPayouts\)/);
    const lib = read("src/lib/financials.ts");
    const pred = lib.slice(lib.indexOf("export const isPayoutDueLesson"), lib.indexOf("export function sumByCurrency"));
    expect(pred, "групові більше не відсікаються правилом — лише сумою").not.toMatch(/is_group/);
    const digest = read("supabase/functions/tutor-daily-digest/index.ts");
    const dp = digest.slice(digest.indexOf("const isPayoutDue = "), digest.indexOf("const unpaidLessons"));
    expect(dp).not.toMatch(/group_id/);
  });

  it("репетитор школи читає пари через вʼю з маскою, запис іде в таблицю", () => {
    const helper = read("src/lib/pairsRel.ts");
    expect(helper).toMatch(/const VIEW = "student_pairs_visible"/);
    expect(helper, "вʼю ще немає → таблиця, як раніше").toMatch(/\? VIEW : "student_rates"/);
    for (const p of ["src/components/QuickLessonDialog.tsx", "src/pages/SchedulePage.tsx", "src/pages/DashboardPage.tsx", "src/pages/ChatsPage.tsx", "src/pages/GroupsPage.tsx", "src/components/StudentMaterials.tsx"]) {
      const s = read(p);
      expect(s, p).toMatch(/pairsRel\(\)/);
      // усе, що лишилось на таблиці напряму, — запис
      for (const m of s.matchAll(/\.from\("student_rates"\)([\s\S]{0,40})/g)) {
        if (p.endsWith("DashboardPage.tsx") && /\.select\("student_id,arch/.test(m[1].replace(/\s+/g, ""))) continue; // лічильник самостійного
        expect(m[1], p).toMatch(/^\s*\.(upsert|update|insert|delete)\(/);
      }
    }
  });

  it("репетитор школи бачить назву СВОЄЇ школи, а не вшиту", () => {
    const d = code(read("src/pages/DashboardPage.tsx"));
    const chips = d.match(/t\("hubTutor\.hubChip", \{ name: [^}]+\}\)/g) ?? [];
    expect(chips.length).toBeGreaterThan(0);
    for (const c of chips) expect(c).toMatch(/myHub\?\.name/);
  });

  it("учень бачить «ціну не задано», а не «0 ₴»", () => {
    expect(code(read("src/pages/student/StudentPaymentsPage.tsx"))).toMatch(/> 0 \? formatPrice\(r\.student_price[\s\S]{0,80}priceNotSet/);
  });

  it("«Школи» в адмінці не залежать від edge-статистики", () => {
    const a = code(read("src/pages/AdminStatsPage.tsx"));
    const at = a.indexOf("<SchoolsCard />");
    const before = a.slice(Math.max(0, at - 260), at);
    expect(before).toMatch(/isAdmin && \(state === "ready" \|\| state === "error"\)/);
  });

  it("порожню школу веде картка запуску, а суперадміну над кожним екраном видно, на що він дивиться", () => {
    expect(code(read("src/pages/DashboardPage.tsx"))).toMatch(/<SchoolSetupCard \/>/);
    expect(code(read("src/components/AppLayout.tsx"))).toMatch(/<AdminLensBanner \/>/);
  });
});
