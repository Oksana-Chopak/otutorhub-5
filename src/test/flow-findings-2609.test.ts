import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/**
 * §4 аудиту шляхів 24.09 — «ще знахідки по ролях». Девʼять важелів (§3) закриті
 * 24–26.09; цей файл тримає ті знахідки з §4, які виправлено 26.09 увечері.
 * Кожен тест падає, якщо правку відкотити.
 */
describe("знахідки §4: щоденні шляхи (26.09)", () => {
  it("забутий урок попереднього дня видно: «закрити день» і черга беруть тиждень, не лише сьогодні", () => {
    const d = read("src/pages/DashboardPage.tsx");
    expect(d).toMatch(/const UNCLOSED_WINDOW_DAYS = 7;/);
    expect(d, "діалог закриття дня більше не фільтрує по todayLessons")
      .toMatch(/const closeDayRows: CloseDayRow\[\] = useMemo\(\s*\n\s*\(\) =>\s*\n\s*lessons/);
    expect(d, "черга «після уроку» — те саме джерело")
      .toMatch(/const afterLessonQueue: QueueLesson\[\] = useMemo\(\s*\n\s*\(\) =>\s*\n\s*lessons/);
    expect(d, "людина мусить знати, що в черзі є старіші уроки")
      .toMatch(/pendingOlder=\{closeDayRows\.some\(/);
    expect(read("src/components/CloseDayDialog.tsx"), "і сам діалог це підписує")
      .toMatch(/closeDayDialog\.hasOlder/);
    expect(read("src/components/DayBlock.tsx")).toMatch(/pendingOlder \? "dayBlock\.closeAllOlder" : "dayBlock\.closeAll"/);
  });

  it("у самостійного урок БЕЗ ЦІНИ — видима дія, а не тиша", () => {
    const lc = read("src/components/LessonCard.tsx");
    expect(lc).toMatch(/const priceMissing = !!onSetPrice && !lesson\.group_id && !hasAmount\(lesson\.student_price\);/);
    expect(lc, "групові не рахуємо: там гроші на учасниках").toMatch(/!lesson\.group_id/);
    expect(lc).toMatch(/lessonCard\.priceMissingTap/);
    const d = read("src/pages/DashboardPage.tsx");
    expect(d, "дія веде туди, де ціна справді задається — у форму учня")
      .toMatch(/\/my-students\?open=\$\{lesson\.student_id\}&price=1/);
    expect(read("src/pages/SchedulePage.tsx")).toMatch(/onSetPrice=/);
    expect(read("src/pages/MyStudentsPage.tsx"), "діп-лінк відкриває ФОРМУ, а не аркуш")
      .toMatch(/const wantPrice = searchParams\.get\("price"\) === "1"/);
  });

  it("у списку чатів «Нагадати» і «Створити урок» — справжні дії", () => {
    const c = read("src/pages/ChatsPage.tsx");
    expect(c, "рядок більше не <button>, інакше кнопка в кнопці").toMatch(/role="button"\s*\n\s*tabIndex=\{0\}/);
    expect(c, "клавіатура лишилась: Enter\\/Space відкривають тред").toMatch(/e\.key === "Enter" \|\| e\.key === " "/);
    expect(c, "нагадування — той самий канон, що на дашборді").toMatch(/<RemindDebtButton/);
    expect(c).toMatch(/navigate\(`\/schedule\?create=1&student=\$\{thread\.student_id\}`\)/);
  });

  it("смарт-картка в треді працює і в ПОРОЖНЬОМУ треді новенького", () => {
    const c = read("src/pages/ChatsPage.tsx");
    expect(c).not.toMatch(/selectedThread\.ctx\.kind === "new"\) && messages\.length > 0 && \(/);
    expect(c).toMatch(/ПОРОЖНЬОМУ треді/);
  });

  it("учень бачить ПІДПИСИ дій уроку на телефоні, а не дві однакові іконки", () => {
    const a = read("src/components/StudentLessonActions.tsx");
    expect(a).not.toMatch(/<span className="hidden sm:inline">\{t\("studentLessonActionsExtra\.(reschedule|cancel)/);
    expect((a.match(/whitespace-nowrap/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("учень має ДЕ ввімкнути пуші — тим самим компонентом, що й репетитор", () => {
    const card = read("src/components/PushSettingsCard.tsx");
    expect(card).toMatch(/export function PushSettingsCard/);
    expect(read("src/pages/student/StudentProfilePage.tsx")).toMatch(/<PushSettingsCard \/>/);
    expect(read("src/pages/ProfilePage.tsx"), "друга копія картки в профілі репетитора не лишилась")
      .not.toMatch(/function PushSettingsCard\(\) \{/);
  });

  it("менеджер: репетитор без предметів має де задати ставку", () => {
    const p = read("src/pages/PeoplePage.tsx");
    expect(p).toMatch(/!\(u\.subjects && u\.subjects\.length > 0\)/);
    expect(p).toMatch(/people\.noSubjectsSetRate/);
    expect(p, "аркуш людини більше не закривається при відкритті форми ставки")
      .toMatch(/setTutorRate\(\{ open: true, tutorId: u\.id, subject: null \}\);\s*\n\s*\}\}/);
  });

  it("урок можна скопіювати з дашборда (пункт меню більше не з'їдається)", () => {
    const d = read("src/pages/DashboardPage.tsx");
    expect((d.match(/canCopy\n/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(read("src/components/LessonCard.tsx")).toMatch(/onCopy && canCopy \?/);
  });

  it("тижнева сітка не має шрифтів нижче 13px (інваріант доступності)", () => {
    expect(read("src/components/WeekCalendar.tsx")).not.toMatch(/text-\[1[0-2]px\]/);
  });
});
