import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/**
 * Важіль 1 (аудит шляхів 24.09): «Після уроку — один аркуш, а не полювання по
 * екрану», з чергою до наступного незакритого уроку.
 */
describe("аркуш «після уроку» з чергою (важіль 1)", () => {
  const sheet = () => read("src/components/AfterLessonSheet.tsx");

  it("конспект і домашка стоять ПЕРШИМИ — це те, що пишуть одразу після уроку", () => {
    const s = sheet();
    const iSummary = s.indexOf('id="al-summary"');
    const iHomework = s.indexOf('id="al-homework"');
    const iPaid = s.indexOf('aria-pressed={paid}');
    expect(iSummary).toBeGreaterThan(0);
    expect(iHomework).toBeGreaterThan(iSummary);
    expect(iPaid, "оплата — після матеріалів").toBeGreaterThan(iHomework);
  });

  it("статус і гроші пишуться КАНОНІЧНИМИ шляхами, без власної логіки", () => {
    const s = sheet();
    expect(s, "«проведено» — той самий useLessonStatus, що на картці уроку").toMatch(/flowComplete\(lesson as never/);
    expect(s, "деталі — лише через update_lesson_details_safe").toMatch(/updateLessonDetailsSafe\(lesson\.id, patch as never\)/);
    expect(s, "жодного прямого запису в lesson_details").not.toMatch(/\.from\("lesson_details"\)[\s\S]{0,80}\.update\(/);
  });

  it("черга йде далі сама, а свято — лише в кінці і лише після збереження", () => {
    const s = sheet();
    expect(s).toMatch(/const next = \(celebrate: boolean\) => \{/);
    expect(s).toMatch(/if \(index \+ 1 < lessons\.length\) \{\s*\n\s*setIndex\(index \+ 1\);/);
    expect(s, "конфеті — після відповіді бази, у самому кінці черги")
      .toMatch(/if \(celebrate\) \{ haptic\.success\(\); burstConfetti\(\)/);
  });

  it("хабовому репетитору оплату учня не показуємо (гроші отримує школа)", () => {
    const s = sheet();
    expect(s).toMatch(/canMarkPaid && price > 0/);
    const d = read("src/pages/DashboardPage.tsx");
    // Право рахується централізовано (roleCapabilities), а не голим прапорцем:
    // «позначити оплату учня» = те саме право, що поповнити його гаманець.
    expect(d).toMatch(/canMarkPaid=\{canSee\("markStudentPayment", flags\)\}/);
    expect(read("src/lib/roleCapabilities.ts")).toMatch(/"markStudentPayment",/);
  });

  it("груповий урок: аркуш не вдає, що має спільні гроші й матеріали", () => {
    const s = sheet();
    expect(s).toMatch(/const isGroup = !lesson\?\.student_id;/);
    expect(s).toMatch(/afterLesson\.groupNote/);
  });

  it("кнопка не залипає: кожен await у try\\/finally (ратчет async-hygiene)", () => {
    const s = sheet();
    expect(s).toMatch(/setBusy\(true\);[\s\S]{0,900}?finally \{\s*\n\s*setBusy\(false\);/);
  });

  it("дві різні потреби — два різні шляхи: швидкий пакет і черга з конспектом", () => {
    const day = read("src/components/DayBlock.tsx");
    expect(day, "«закрити все» лишається").toMatch(/dayBlock\.closeAll/);
    expect(day, "і поруч — черга з конспектом").toMatch(/afterLesson\.openQueue/);
    const d = read("src/pages/DashboardPage.tsx");
    expect(d).toMatch(/<AfterLessonSheet/);
    expect(d, "черга = ті самі уроки, що й у пакетному закритті дня")
      .toMatch(/const afterLessonQueue: QueueLesson\[\]/);
    expect(d, "кнопка не зʼявляється, коли черга порожня")
      .toMatch(/onOpenQueue=\{afterLessonQueue\.length > 0 \? \(\) => setQueueOpen\(true\) : undefined\}/);
  });
});
