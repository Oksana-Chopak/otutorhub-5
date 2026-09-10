/**
 * Естафета «лендінг → застосунок» (10.09).
 *
 * Обіцянка на лендінгу — «створиш акаунт, і цей список уже буде всередині» —
 * до 10.09 виконувалась лише на /my-students, куди новий репетитор не
 * потрапляє, а віджет «Спробуй прямо зараз» писав tutorhub.demo, якого ніхто
 * не читав. Лист підтвердження відкривають з іншого пристрою — localStorage
 * там порожній. Ці тести тримають три речі: (1) старий віджет перекладається в
 * рядок, який розуміє той самий парсер, що й імпорт; (2) порядок джерел і
 * «стерти лише після успіху»; (3) список їде в метаданих реєстрації, а
 * онбординг зустрічає ним новачка на першому екрані.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { updateUser: vi.fn(() => Promise.resolve({ data: null, error: null })) }, rpc: vi.fn(() => Promise.resolve({})) },
}));
vi.mock("@/lib/analytics", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/metaPixel", () => ({ metaTrack: vi.fn() }));

import {
  demoToDraftLine, peekLandingHandoff, consumeLandingHandoff, landingDraftForSignup,
  saveLandingDraft, claimHandoffShown, LANDING_DRAFT_MAX,
} from "@/lib/landingFunnel";
import { parseStudentLine } from "@/lib/importStudents";
import { supabase } from "@/integrations/supabase/client";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const src = (f: string) => readFileSync(join(root, f), "utf8");

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe("старий віджет «Спробуй прямо зараз» → рядок імпорту", () => {
  it("учень + зустріч + оплата стають одним рядком, який парсер читає без втрат", () => {
    // 2026-09-14 — понеділок
    const line = demoToDraftLine({
      student: { name: "Анна Іваненко", subject: "Англійська", price: 500 },
      lesson: { studentName: "Анна Іваненко", date: "2026-09-14", time: "16:00" },
      payment: { studentName: "Анна Іваненко", amount: null, lessons: 4 },
    });
    expect(line).toBe("Анна Іваненко — Англійська — 500 — пн 16:00 — prepay 4 lessons");
    const r = parseStudentLine(line!)!;
    expect(r.firstName).toBe("Анна");
    expect(r.lastName).toBe("Іваненко");
    expect(r.subject?.toLowerCase()).toBe("англійська");
    expect(r.price).toBe(500);
    expect(r.schedule).toEqual([{ weekday: 1, time: "16:00" }]);
    expect(r.prepayLessons).toBe(4);
    expect(r.error).toBeFalsy();
  });
  it("оплата грошима, а не уроками — сума з одиницею; імʼя береться з будь-якої вкладки", () => {
    const line = demoToDraftLine({ payment: { studentName: "Марко", amount: 1500, lessons: null } });
    expect(line).toBe("Марко — prepay 1500 uah");
    expect(parseStudentLine(line!)?.prepayAmount).toBe(1500);
  });
  it("порожній віджет — нічого", () => {
    expect(demoToDraftLine(null)).toBeNull();
    expect(demoToDraftLine({ student: { name: "  " } })).toBeNull();
  });
});

describe("джерела естафети та їх порядок", () => {
  it("калькулятор > старий віджет > метадані акаунта", () => {
    const user = { user_metadata: { landing_draft: "Оля — 350" } };
    expect(peekLandingHandoff(user)).toEqual({ text: "Оля — 350", source: "account" });
    localStorage.setItem("tutorhub.demo", JSON.stringify({ student: { name: "Петро", subject: "фізика", price: 400 } }));
    expect(peekLandingHandoff(user)?.source).toBe("demo");
    saveLandingDraft("Марія — 600 — борг 1200");
    expect(peekLandingHandoff(user)).toEqual({ text: "Марія — 600 — борг 1200", source: "draft" });
  });
  it("метадані з позначкою «вже перенесено» не пропонуються вдруге", () => {
    expect(peekLandingHandoff({ user_metadata: { landing_draft: "Оля — 350", landing_draft_done: true } })).toBeNull();
  });
  it("стирається лише ПІСЛЯ успішного імпорту — і з усіх джерел одразу", () => {
    saveLandingDraft("Марія — 600");
    localStorage.setItem("tutorhub.demo", JSON.stringify({ student: { name: "Петро" } }));
    const user = { user_metadata: { landing_draft: "Оля — 350" } };
    consumeLandingHandoff(user);
    expect(peekLandingHandoff({ user_metadata: {} })).toBeNull();
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ data: { landing_draft: null, landing_draft_done: true } });
  });
  it("показ раз на сесію: закрив — не нав'язуємось до наступного заходу", () => {
    expect(claimHandoffShown()).toBe(true);
    expect(claimHandoffShown()).toBe(false);
  });
  it("у реєстрацію їде той самий текст, обрізаний стелею метаданих", () => {
    saveLandingDraft("Марія — 600");
    expect(landingDraftForSignup()).toBe("Марія — 600");
    saveLandingDraft("x".repeat(LANDING_DRAFT_MAX + 50));
    expect(landingDraftForSignup()?.length).toBe(LANDING_DRAFT_MAX);
    localStorage.clear();
    expect(landingDraftForSignup()).toBeNull();
  });
});

describe("естафета зашита там, де людина справді опиняється", () => {
  it("реєстрація кладе список у user_metadata (працює з будь-якого пристрою)", () => {
    const auth = src("src/pages/AuthPage.tsx");
    expect(auth).toMatch(/landingDraftForSignup\(\)/);
    expect(auth).toMatch(/landing_draft: landingDraft/);
  });
  it("онбординг відкриває імпорт з естафети першим екраном і стирає її лише після імпорту", () => {
    const ob = src("src/components/OnboardingFlowB.tsx");
    expect(ob).toMatch(/peekLandingHandoff\(user\)/);
    expect(ob).toMatch(/<ImportStudentsSheet[\s\S]*initialText=\{handoff\}/);
    expect(ob).toMatch(/consumeLandingHandoff\(user\)/);
    // перенесений борг = відповідь на крок «гроші», інакше борг подвоївся б
    expect(ob).toMatch(/l\.carried_over === true/);
  });
  it("«Мої учні» — той самий шлях, без окремої копії логіки", () => {
    const ms = src("src/pages/MyStudentsPage.tsx");
    expect(ms).toMatch(/peekLandingHandoff\(user\)/);
    expect(ms).toMatch(/consumeLandingHandoff\(user\)/);
    expect(ms).not.toMatch(/takeLandingDraft\(/);
  });
});
