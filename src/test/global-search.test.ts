import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/**
 * Важіль 7 (аудит шляхів 24.09): «Пошук усього з одного поля» — і пошук не
 * «знаходить сторінку», а ВИКОНУЄ намір: поруч із людиною стоять дії.
 */
describe("пошук-намір (важіль 7)", () => {
  const gs = () => read("src/components/GlobalSearch.tsx");

  it("скоуп визначає база (RLS), а не фільтр за роллю в клієнті", () => {
    const s = gs();
    expect(s).toMatch(/\.from\("profiles"\)/);
    expect(s, "жодного власного «хто мої люди» — інакше зʼявиться друга правда")
      .not.toMatch(/isManager \? .*tutor_id|eq\("tutor_id", user/);
    expect(s).toMatch(/RLS на `profiles`/);
  });

  it("борг рахується СПІЛЬНИМ предикатом і одним запитом на відкриття", () => {
    const s = gs();
    expect(s).toMatch(/isStudentDebtLesson\(row as never\)/);
    expect(s, "не запит на кожну літеру").toMatch(/if \(open\) \{ void loadDebts\(\)/);
    expect(s, "набір тексту — із затримкою").toMatch(/const timer = setTimeout\(async/);
    expect(s, "затримка 250 мс").toMatch(/\}, 250\);/);
  });

  it("дії поруч — канонічні компоненти й наявні маршрути", () => {
    const s = gs();
    expect(s, "нагадування — той самий RemindDebtButton").toMatch(/<RemindDebtButton/);
    expect(s).toMatch(/\/schedule\?create=1&student=\$\{p\.id\}/);
    expect(s).toMatch(/\/finances\?record=1/);
    expect(s, "матеріали — через roleCapabilities, бо в хабового сторінки учня немає")
      .toMatch(/studentMaterialsPath\(flags, p\.id\)/);
  });

  it("пошук є на обох поверхнях хедера і відкривається ⌘K", () => {
    const layout = read("src/components/AppLayout.tsx");
    expect((layout.match(/<GlobalSearch \/>/g) ?? []).length).toBe(2);
    expect(gs()).toMatch(/e\.metaKey \|\| e\.ctrlKey\) && e\.key\.toLowerCase\(\) === "k"/);
  });

  it("учень і сторонній пошуку не бачать (він про учнів і гроші)", () => {
    expect(gs()).toMatch(/const enabled = !!user && \(roles\.includes\("tutor"\) \|\| roles\.includes\("manager"\)\);/);
    expect(gs()).toMatch(/if \(!enabled\) return null;/);
  });

  it("ціль дотику 44px, поле з іменем, порожні стани словами", () => {
    const s = gs();
    expect(s).toMatch(/h-11 w-11/);
    expect(s).toMatch(/aria-label=\{t\("search\.title"\)\}/);
    expect(s).toMatch(/search\.nothing/);
    expect(s).toMatch(/search\.hint/);
  });
});
