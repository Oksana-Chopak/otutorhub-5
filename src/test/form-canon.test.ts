import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * КАНОН ФОРМ (хвиля 14.11, скарга власниці: «форма в застарілому дизайні і неприйнятна»).
 *
 * Розтяжки тримають три речі, які вже ламались:
 *   1. у робочих екранах більше немає спливного списку Radix — він «блимав і зникав» (14.11),
 *      а в аркуші був 40px заввишки з текстом 14px; вибір — рідний `NativeSelect` або кнопки;
 *   2. переведені форми стоять на спільній оболонці `FormSheet` і полях з `form/canon`, а не
 *      збирають діалог щоразу власноруч;
 *   3. білий напис на бірюзовій заливці (2.3:1) і вшитий білий фон під текст із токенів
 *      (у темній темі — світлий напис на білому) не повертаються.
 */
const SRC = join(process.cwd(), "src");
const read = (p: string) => readFileSync(join(SRC, p), "utf-8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "test" && name !== "tests") walk(p, out); }
    else if (name.endsWith(".tsx")) out.push(p);
  }
  return out;
}
const files = walk(SRC);
const rel = (p: string) => p.slice(SRC.length + 1);

describe("канон форм: поля, оболонка, вибір без спливного списку", () => {
  it("спливний список Radix лишився тільки в адмінці платформи", () => {
    // Сторінки суперадміна (журнал, маркетинг, заявки на Pro, метрики пейволу) — службові
    // екрани на компʼютері; усе, чим користуються школа, репетитор і учень, — без Radix Select.
    const allowed = new Set([
      "pages/AuditLogPage.tsx", "pages/MarketingPage.tsx",
      "pages/SubscriptionRequestsPage.tsx", "pages/PaywallMetricsPage.tsx",
    ]);
    const users = files
      .filter((f) => !rel(f).startsWith("components/ui/"))
      .filter((f) => /from "@\/components\/ui\/select"/.test(readFileSync(f, "utf-8")))
      .map(rel)
      .filter((f) => !allowed.has(f));
    expect(users, "нова форма бере NativeSelect / ChoiceChips з components/form/canon").toEqual([]);
  });

  it("переведені форми стоять на спільній оболонці FormSheet", () => {
    for (const f of [
      "components/StudentLessonActions.tsx", "components/TutorChangeRequestsCard.tsx",
      "components/SchoolRequestCard.tsx", "components/SubscriptionRequestDialog.tsx",
      "components/ContactEditDialog.tsx", "components/AvailabilityManager.tsx",
    ]) {
      const s = read(f);
      expect(s, `${f}: оболонка`).toMatch(/<FormSheet\b/);
      expect(s, `${f}: власноруч зібраний діалог`).not.toMatch(/<DialogContent\b|<DialogFooter\b/);
      expect(s, `${f}: старий підпис`).not.toMatch(/<Label\b/);
    }
    expect(read("pages/ChatsPage.tsx")).toMatch(/<FormSheet\b[\s\S]{0,400}testId="new-chat"/);
  });

  it("оболонка стоїть на базовому DialogContent — правила екранної клавіатури діють самі", () => {
    const s = read("components/form/FormSheet.tsx");
    expect(s).toMatch(/from "@\/components\/ui\/dialog"/);
    expect(s).toMatch(/<DialogContent\b/);
    expect(s).not.toMatch(/position:\s*"fixed"|\bfixed\b[^"]*bottom-0/);
  });

  it("поле канону: 48px, текст 16px (iOS не зумить форму), рамка 1.5px", () => {
    const s = read("components/form/canon.tsx");
    const field = s.match(/export const FIELD_CLASS =\s*"([^"]+)"/)?.[1] ?? "";
    expect(field).toMatch(/\bh-12\b/);
    expect(field).toMatch(/text-\[16px\]/);
    expect(field).toMatch(/border-\[1\.5px\]/);
    // кольори — лише з токенів обох тем
    expect(field).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    expect(s).toMatch(/min-h-\[44px\]/); // кнопки вибору — ціль дотику
  });

  it("фільтри розкладу: короткі набори — кнопками, люди — рідним вибором", () => {
    const s = read("components/ScheduleFiltersSheet.tsx");
    expect(s).toMatch(/<ChoiceChips\b/);
    expect(s).toMatch(/<NativeSelect\b/);
    expect(s).not.toMatch(/h-10 text-sm/);
  });

  it("копія уроку: шість виборів — рідні, а три «статуси» підписані по-різному", () => {
    const s = read("pages/SchedulePage.tsx");
    for (const id of ["copy-tutor", "copy-student", "copy-status", "copy-student-pay", "copy-tutor-pay", "repeat"]) {
      expect(s, id).toMatch(new RegExp(`<NativeSelect[^>]*\\bid="${id}"`));
    }
    expect(s).toMatch(/schedule\.copyLessonStatus/);
    expect(s).toMatch(/schedule\.copyStudentPayStatus/);
    expect(s).toMatch(/schedule\.copyPayoutStatus/);
    // груповий урок «Копіювати» не пропонує: копія відкривала форму одного учня без учня
    expect(s).toMatch(/const canCopy =\s*!!lesson\.student_id &&/);
  });

  it("запит на інший час: не «на той самий» і не в минуле", () => {
    const s = read("components/StudentLessonActions.tsx");
    expect(s).toMatch(/studentLessonActions\.sameTime/);
    expect(s).toMatch(/<DateTimeField[^>]*\bmin=\{/);
    expect(read("components/TutorChangeRequestsCard.tsx")).toMatch(/<DateTimeField[^>]*\bmin=\{/);
  });

  it("білого напису на бірюзовій заливці немає (2.3:1) — на бірюзі напис темний", () => {
    const bad: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf-8").split("\n").forEach((line, i) => {
        if (/text-white/.test(line) && /bg-\[var\(--teal\)\]|bg-\[#2BBFAA\]/.test(line)) bad.push(`${rel(f)}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it("вшитий білий фон під текст із токенів не росте (у темній темі це світлий напис на білому)", () => {
    // Залишок — свідомий: білий «острівець» із власним темним написом (кнопка копіювання в
    // запрошенні, анкета пошуку репетитора — її темна тема в черзі) і бренд-графіка.
    let n = 0;
    for (const f of files) {
      for (const line of readFileSync(f, "utf-8").split("\n")) {
        if (!/background/.test(line) || !/"#fff"/.test(line)) continue;
        if (/color: "#fff"/.test(line) && !/background[^,}]*"#fff"/.test(line)) continue;
        n++;
      }
    }
    expect(n).toBeLessThanOrEqual(14);
  });
});
