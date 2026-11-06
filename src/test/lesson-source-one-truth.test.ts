import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname ?? __dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const DLG = read("src/components/QuickLessonDialog.tsx");

/**
 * `source` УРОКУ — ОДНЕ ДЖЕРЕЛО ПРАВДИ (06.11).
 *
 * Власниця як менеджер завела учня, прикріпила репетитора, заповнила форму — і
 * отримала «new row violates row-level security policy for table "lessons"».
 * Урок не створився. Причина: у цьому файлі `source` виводився ДВІЧІ й
 * по-різному. Груповий — `variant === "independent" ? … : "hub"` (менеджер →
 * hub, правильно). Індивідуальний — `isHubVariant ? "hub" : "independent"`,
 * тобто менеджер писав `independent`, а політика вставки менеджера вимагає
 * `source = 'hub' OR source IS NULL`.
 *
 * `source` незмінний після вставки (20260902170000), тож помилка тут не
 * лагодиться пізніше — урок або створюється правильно, або не створюється.
 */
describe("source уроку виводиться один раз", () => {
  it("є рівно одне визначення і воно вживається в ОБОХ payload", () => {
    expect((DLG.match(/const lessonSource\b/g) ?? []).length, "одне визначення").toBe(1);
    expect((DLG.match(/source: lessonSource,/g) ?? []).length, "груповий і індивідуальний payload").toBe(2);
  });

  it("жодного власного виведення source не лишилось", () => {
    expect(DLG, "старе індивідуальне").not.toMatch(/source:\s*isHubVariant\s*\?/);
    expect(DLG, "і старе групове").not.toMatch(/source:\s*variant\s*===/);
  });

  it("менеджер — не «самостійний»: ціну з форми прикріплює лише самостійний урок", () => {
    // Хабовий урок (і той, що створює менеджер) бере ціну й виплату з тригера
    // за знімком ставок. До 06.11 тут стояло `!isHubVariant`, і менеджер
    // лічився самостійним — та сама плутанина, що й у source.
    expect(DLG, "жодного нового сирого прапора ролі — рішення з того ж lessonSource (ратчет P8)")
      .toMatch(/createdRows\?\.length && lessonSource === "independent"\)/);
    expect(DLG, "старої умови немає").not.toMatch(/createdRows\?\.length && !isHubVariant\)/);
  });

  it("перевірка не вакуумна: у формі справді ДВА шляхи вставки уроку", () => {
    // Груповий урок іде через createGroupLesson (там своя перевірка прав),
    // індивідуальний — прямим insert. Два різні шляхи, один `source`.
    expect(DLG, "груповий шлях").toContain("await createGroupLesson({");
    expect(DLG, "індивідуальний шлях").toContain('from("lessons")');
    expect(DLG, "і три персони, між якими й виникла плутанина").toMatch(/variant\?:\s*"independent"\s*\|\s*"hub"\s*\|\s*"manager"/);
  });

  it("клас покритий і в базі — сценарій прогону, а не лише текст файла", () => {
    // Робот на проді цього не ловив і не зловить: він лише читає екрани.
    const sc = "scripts/db-replay/scenarios/74-manager-creates-individual-lesson.sql";
    expect(existsSync(join(ROOT, sc))).toBe(true);
    const s = read(sc);
    expect(s, "менеджер вставляє урок із source=hub").toContain("'hub', 'scheduled'");
    expect(s, "і той самий із independent мусить бути відбитий").toContain("insufficient_privilege");
  });
});
