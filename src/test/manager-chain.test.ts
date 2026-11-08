/**
 * ЛАНЦЮГ МЕНЕДЖЕРА — той самий у клієнті й у базі (08.11).
 *
 * Питання власниці: «чи тепер я можу створити ученицю, прикріплену до
 * репетитора, і чи не виникне знову помилок?». Робот на проді на це не
 * відповідає — він лише ЧИТАЄ екрани. Відповідь дає сценарій 76: він
 * проганяє ВЕСЬ ланцюг під JWT менеджера, тими самими запитами, що їх шле
 * застосунок.
 *
 * Цей тест стереже, щоб ланцюг у коді й ланцюг у сценарії не розʼїхались:
 * якщо завтра у форму додадуть ще один запис (скажімо, членство в школі),
 * сценарій мусить дізнатись про це тут, а не від власниці.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname ?? __dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const SC_PATH = "scripts/db-replay/scenarios/76-manager-full-chain.sql";

describe("менеджер: створити ученицю → прикріпити репетитора → поставити урок", () => {
  it("сценарій існує — інакше цей клас знову нічим не ловити", () => {
    expect(existsSync(join(ROOT, SC_PATH)), `${SC_PATH} зник`).toBe(true);
  });

  it("усе, що пише форма «Додати людину», сценарій теж пише", () => {
    const page = read("src/pages/PeoplePage.tsx");
    const sc = read(SC_PATH);
    // Таблиці, у які форма ВСТАВЛЯЄ при додаванні людини.
    const written = new Set(
      [...page.matchAll(/from\("(\w+)"\)\s*\.?\s*\n?\s*\.(insert|upsert)\(/g)].map((m) => m[1]),
    );
    for (const table of ["profiles", "profile_contacts", "user_roles", "student_details", "student_rates"]) {
      expect(written.has(table), `форма пише в ${table}`).toBe(true);
      expect(sc, `сценарій теж пише в ${table}`).toMatch(new RegExp(`INSERT INTO public\\.${table}\\b`));
    }
  });

  it("сценарій біжить під JWT менеджера, а не як postgres", () => {
    // Клас 24.09: сценарій під postgres не бачить ні RLS, ні тригерів, які
    // дивляться на auth.uid() — і доводить не те.
    const sc = read(SC_PATH);
    expect(sc).toMatch(/set_config\('request\.jwt\.claims'[\s\S]*?'sub', mgr/);
    expect(sc).toMatch(/set_config\('role', 'authenticated', true\)/);
  });

  it("учениця — ghost без рядка в auth.users, як у житті", () => {
    const sc = read(SC_PATH);
    expect(sc, "у фікстурі auth.users лише менеджер і репетитор").toMatch(/INSERT INTO auth\.users[\s\S]{0,200}tutor76/);
    expect(sc, "а учениця створюється самим менеджером").toMatch(/INSERT INTO public\.profiles[\s\S]{0,120}is_pending\)/);
  });

  it("перевіряє не лише «вставилось», а й гроші та видимість", () => {
    const sc = read(SC_PATH);
    expect(sc, "ціна пари зі знімка ставок").toContain("ПРОВАЛ (7)");
    expect(sc, "учениця й урок видимі менеджерові").toContain("ПРОВАЛ (8)");
    expect(sc, "видимість ціни — через санкціоновану маску").toContain("lessons_visible");
  });

  it("урок іде з source='hub' — те саме, що тепер шле клієнт", () => {
    expect(read(SC_PATH)).toContain("'hub', 'scheduled'");
    expect(read("src/components/QuickLessonDialog.tsx")).toMatch(/const lessonSource\b/);
  });
});
