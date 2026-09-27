import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { selectInChunks, IN_CHUNK } from "@/lib/chunkIn";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Дрібна черга аудиту 18.09: тексти, що казали неправду, і мертва бібліотека. */

describe("порожній стані «Людей» кажуть ПРАВДУ", () => {
  const p = () => read("src/pages/PeoplePage.tsx");

  it("три однакові копії стану згорнуто в ОДИН рендерер", () => {
    const s = p();
    expect((s.match(/renderEmptyTab\("/g) ?? []).length).toBe(3);
    expect((s.match(/t\("people\.nothingFound"\)/g) ?? []).length,
      "«нічого не знайдено» лишається рівно в одному місці — коли справді шукали").toBe(1);
  });

  it("«Нічого не знайдено» — лише коли шукали", () => {
    expect(p()).toMatch(/const searching = searchQuery\.trim\(\) !== "";[\s\S]{0,400}if \(searching\) \{/);
  });

  it("фільтр статусу має свій текст і свою дію", () => {
    const s = p();
    expect(s).toMatch(/const filtered = statusFilter !== "all";/);
    expect(s).toMatch(/people\.emptyFilter/);
    expect(s).toMatch(/onClick=\{\(\) => setStatusFilter\("all"\)\}/);
  });

  it("справді порожній список — теплий текст і СПРАВЖНЯ дія «додати»", () => {
    const s = p();
    for (const k of ["people.emptyTutors", "people.emptyStudents", "people.emptyManagers"]) {
      expect(s).toContain(k);
    }
    expect(s, "кнопка веде в ту саму форму, що FAB").toMatch(/openAddSheet\(copy\.role\)/);
    expect(s, "менеджерам кнопки не вигадуємо").toMatch(/managers: \{ text: t\("people\.emptyManagers"\), cta: null/);
  });

  it("порожній стан не порушує правило 13px і 44px", () => {
    const s = p();
    const block = s.slice(s.indexOf("const renderEmptyTab"), s.indexOf("const openChatWith"));
    expect(block).not.toMatch(/text-xs|text-\[1[0-2]px\]/);
    expect((block.match(/tap-44|h-11/g) ?? []).length, "усі три дії мають зону дотику").toBeGreaterThanOrEqual(3);
  });
});

describe("падіння можна процитувати підтримці", () => {
  const eb = () => read("src/components/ErrorBoundary.tsx");

  it("код показується людині й летить у журнал — інакше цитувати нікуди", () => {
    const s = eb();
    expect(s).toMatch(/return \{ hasError: true, error, ref: makeRef\(\) \};/);
    expect(s).toMatch(/errorBoundary\.refLabel/);
    expect(s).toMatch(/void logError\(error\.message, error\.stack, \{\s*\n\s*ref,/);
    expect(s, "у консолі теж мусить бути той самий код").toMatch(/\[ErrorBoundary \$\{ref\}\]/);
  });

  it("код не несе жодних даних людини — лише час і випадковість", () => {
    const s = eb();
    const fn = s.slice(s.indexOf("function makeRef"), s.indexOf("export class ErrorBoundary"));
    expect(fn).toMatch(/Date\.now\(\)/);
    expect(fn).toMatch(/Math\.random\(\)/);
    for (const forbidden of ["user", "email", "auth", "supabase"]) {
      expect(fn.toLowerCase(), `у коді помилки не має бути ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("після повернення на головну код скидається разом зі станом", () => {
    expect((eb().match(/error: null, ref: null/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("мертва бібліотека тостів прибрана", () => {
  it("файла немає — разом із 32 вшитими українськими рядками", () => {
    expect(existsSync(join(ROOT, "src/lib/toasts.ts")),
      "бібліотеку ніхто не викликав, а її докстринг наказував писати саме через неї").toBe(false);
  });

  it("мертвих імпортів не лишилось", () => {
    for (const f of ["src/pages/SchedulePage.tsx", "src/pages/MyStudentsPage.tsx"]) {
      expect(read(f)).not.toMatch(/from "@\/lib\/toasts"/);
    }
  });
});

describe("довгі .in(…) — шматками", () => {
  it("розбиває список і збирає всі рядки", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const seen: number[] = [];
    const res = await selectInChunks<{ id: string }>(ids, (chunk) => {
      seen.push(chunk.length);
      return Promise.resolve({ data: chunk.map((id) => ({ id })), error: null });
    });
    expect(seen).toEqual([100, 100, 50]);
    expect(res.data).toHaveLength(250);
    expect(res.chunks).toBe(3);
    expect(res.error).toBeNull();
  });

  it("порожній список не робить ЖОДНОГО запиту", async () => {
    let calls = 0;
    const res = await selectInChunks<{ id: string }>([], () => { calls += 1; return Promise.resolve({ data: [], error: null }); });
    expect(calls).toBe(0);
    expect(res.chunks).toBe(0);
  });

  it("повертає ПЕРШУ помилку, але не ковтає вже прочитані рядки", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `id-${i}`);
    let n = 0;
    const res = await selectInChunks<{ id: string }, { message: string }>(ids, (chunk) => {
      n += 1;
      return n === 2
        ? Promise.resolve({ data: null, error: { message: "перший збій" } })
        : Promise.resolve({ data: chunk.map((id) => ({ id })), error: null });
    });
    expect(res.error?.message).toBe("перший збій");
    expect(res.data).toHaveLength(100);
  });

  it("чати читають вкладення й реакції шматками — там довжина списку не обмежена", () => {
    const c = read("src/pages/ChatsPage.tsx");
    expect((c.match(/selectInChunks</g) ?? []).length).toBe(2);
    expect(c, "у треді з «показати ще» летіли б сотні UUID в одній адресі")
      .not.toMatch(/\.in\("message_id", msgs\.map\(\(m\) => m\.id\)\)/);
    expect(IN_CHUNK).toBeLessThanOrEqual(100);
  });
});
