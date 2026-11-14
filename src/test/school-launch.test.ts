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

describe("діри після першого проходу (11.11, другий пакет)", () => {
  it("накладка уроків: єдина форма уроку попереджає, але не блокує", () => {
    const q = read("src/components/QuickLessonDialog.tsx");
    expect(q).toMatch(/const \[overlap, setOverlap\]/);
    expect(q).toMatch(/\.neq\("status", "cancelled"\)/);
    expect(q).toMatch(/t\("quickLessonDialog\.overlapWarning"/);
    expect(q, "збій читання не лякає накладкою, якої може не бути").toMatch(/if \(error\) \{ setOverlap\(null\); return; \}/);
  });

  it("підказки предметів — предмети своєї школи, а не вшитий список школи власниці платформи", () => {
    const ms = read("src/components/SubjectMultiSelect.tsx");
    expect(ms).toMatch(/useSchoolSubjects\(\)/);
    expect(ms).not.toMatch(/\bSUBJECT_OPTIONS\b/);
    expect(read("src/pages/PeoplePage.tsx")).not.toMatch(/\bSUBJECT_OPTIONS\b/);
  });

  it("прибуток на дашборді рахує груповий урок цілком (оплати учасників − виплата) або ніяк", () => {
    const d = read("src/pages/DashboardPage.tsx");
    expect(d).toMatch(/const paid = groupPaidIncome\.get\(l\.id\);\s*\n\s*if \(paid === undefined\) return \[\];/);
    expect(d).toMatch(/\[profitLessons, periodStart, nowMs\]/);
  });

  it("заявка «керую школою» йде в наявну скриньку звернень, без нового каналу", () => {
    const c = read("src/components/SchoolRequestCard.tsx");
    expect(c).toMatch(/from\("feedback_submissions"\)\.insert\(/);
    expect(c).toMatch(/category: "school_request"/);
    expect(read("src/pages/ProfilePage.tsx")).toMatch(/\{isIndependent && <SchoolRequestCard \/>\}/);
  });

  it("учень з акаунтом потрапляє у школу лише за власною згодою", () => {
    const sql = read("supabase/migrations/20261111170000_hub_join_invite.sql");
    expect(sql, "таблиця закрита — лише функції").toMatch(/REVOKE ALL ON public\.hub_join_invites FROM PUBLIC, anon, authenticated/);
    const accept = sql.slice(sql.indexOf("FUNCTION public.resolve_hub_invite"));
    expect(accept, "членство ставить лише сама людина").toMatch(/WHERE id = _id AND user_id = auth\.uid\(\) AND status = 'pending'/);
    const invite = sql.slice(sql.indexOf("FUNCTION public.hub_invite_existing_student"), sql.indexOf("FUNCTION public.my_hub_invites"));
    expect(invite, "запрошення членства НЕ створює").not.toMatch(/INSERT INTO public\.hub_members/);
    expect(invite).toMatch(/rate_limit_check\('hub_invite'/);
    expect(read("src/pages/PeoplePage.tsx")).toMatch(/hub_invite_existing_student/);
    const dash = read("src/pages/student/StudentDashboardPage.tsx");
    expect(dash.match(/<SchoolInviteCard \/>/g)?.length, "видно і на онбордингу, і на дашборді").toBe(2);
  });
});

describe("віральність у шляху школи (11.11, третій пакет)", () => {
  it("сторінка оплати дитини і листи ведуть на лендінг зі слідом, звідки прийшли", () => {
    expect(read("src/pages/PayLinkPage.tsx")).toMatch(/href="\/\?from=pay"/);
    expect(read("supabase/functions/_shared/transactional-email-templates/student-invite.tsx")).toMatch(/\?from=invite/);
    expect(read("supabase/functions/_shared/transactional-email-templates/payment-reminder.tsx")).toMatch(/\?from=reminder/);
    expect(read("src/components/landing/LandingHero.tsx"), "закритий список джерел, не вільний текст").toMatch(/\["pay", "invite", "reminder", "school"\]\.includes\(from\)/);
  });

  it("публічна сторінка школи: лише з волі менеджера, без імен і цін, стелі в базі", () => {
    const sql = read("supabase/migrations/20261111190000_school_public_page.sql");
    expect(sql).toMatch(/public_enabled boolean NOT NULL DEFAULT false/);
    const pub = sql.slice(sql.indexOf("FUNCTION public.hub_public_page("), sql.indexOf("FUNCTION public.hub_public_lead("));
    expect(pub).toMatch(/AND h\.public_enabled/);
    expect(pub, "жодних імен, цін чи людей").not.toMatch(/first_name|last_name|price|rate_per_lesson|profiles/);
    const lead = sql.slice(sql.indexOf("FUNCTION public.hub_public_lead("));
    expect(lead, "два виміри стелі: адреса і школа").toMatch(/rate_limit_check\('hub_lead_ip'[\s\S]*rate_limit_check\('hub_lead_hub'/);
    expect(lead, "анонім не пише в профілі й не створює акаунтів").not.toMatch(/INSERT INTO public\.(profiles|profile_contacts|user_roles|hub_members)/);
    expect(sql, "таблиця заявок закрита — лише функції").toMatch(/REVOKE ALL ON public\.hub_leads FROM PUBLIC, anon, authenticated/);
    expect(read("src/App.tsx")).toMatch(/path="\/s\/:slug" element=\{<SchoolPublicPage \/>\}/);
    expect(read("supabase/functions/_shared/ownerAlerts.ts")).toMatch(/"hub_lead"/);
  });

  it("платформні екрани в профілі менеджера школи не показуються", () => {
    const p = read("src/pages/ProfilePage.tsx");
    for (const to of ["/subscription-requests", "/feedback-inbox", "/marketing", "/paywall-metrics"]) {
      const line = p.split("\n").find((l) => l.includes(`to: "${to}"`))!;
      const i = p.indexOf(line);
      expect(p.slice(Math.max(0, i - 160), i + line.length), to).toMatch(/isSuperadmin/);
    }
  });

  it("13.11: менеджер обирає репетитора лише зі своєї школи, а відмову бази бачить словами", () => {
    const src = readFileSync("src/components/QuickLessonDialog.tsx", "utf8");
    expect(src).toMatch(/rpc\("caller_hub_id"\)/);
    expect(src).toMatch(/\.eq\("hub_id", hubId/);
    expect(src).toMatch(/quickLessonDialog\.tutorNotInSchool/);
  });

  it("13.11: щойно доданий учень школи видно у формі уроку менеджера, і звідти його призначають", () => {
    const form = readFileSync("src/components/QuickLessonDialog.tsx", "utf8");
    expect(form).toMatch(/from\("hub_members"\)/);
    expect(form).toMatch(/\/people\?assign=\$\{u\.id\}&tutor=\$\{selTutorId\}&back=lesson/);
    const people = readFileSync("src/pages/PeoplePage.tsx", "utf8");
    expect(people).toMatch(/searchParams\.get\("assign"\)/);
    expect(people).toMatch(/backToLessonRef\.current/);
  });

  /* 14.11, скарга власниці: у формі «Додати репетитора до учня» списки предмета й валюти
     «блимали й зникали», а сама форма була в старому дизайні. Форма пари — найчастіша дія
     менеджера нової школи, тому в ній немає ЖОДНОГО спливного списку: репетитор і валюта —
     рідний вибір телефона, предмет — кнопками в один дотик. */
  it("14.11: форма пари «учень — репетитор» — у новому каноні й без спливних списків", () => {
    const people = readFileSync("src/pages/PeoplePage.tsx", "utf8");
    const from = people.indexOf("{/* Add tutor to student dialog */}");
    const to = people.indexOf("<PersonEditSheet", from);
    expect(from).toBeGreaterThan(0);
    const form = people.slice(from, to);
    expect(form).not.toMatch(/<Select\b|<SelectTrigger|<Label\b/);
    expect(form).toMatch(/<select\s+id="add-tutor-tutor"/);
    expect(form).toMatch(/data-subject-chip/);
    expect(form).toMatch(/minHeight: 48/);          // предмет-кнопка — повноцінна зона дотику
    expect(form).toMatch(/height: 58/);             // поле репетитора — як у формі уроку
    // гроші: ціну учня не підставляємо зі ставки репетитора (інваріант маржі)
    expect(form).not.toMatch(/price:\s*String\(tutorRate/);
    // форма «Нова людина» — теж без старих підписів і з перемикачем ролі на токенах теми
    const add = people.slice(people.indexOf("PERSON BOTTOM SHEET"), people.indexOf("<Sheet open={!!selectedPerson}"));
    expect(add.length).toBeGreaterThan(500);
    expect(add).not.toMatch(/<Label\b/);
    expect(add).not.toMatch(/bg-\[#F5F4F0\]|background: active \? "#fff"/);
  });
});
