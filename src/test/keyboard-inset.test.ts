import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { computeKeyboard } from "@/lib/keyboardInset";

const base = { innerHeight: 844, baseline: 844, vvHeight: 844, vvTop: 0, scale: 1, editable: true };

describe("екранна клавіатура не накриває форму (13.11)", () => {
  it("iPhone: сторінка не зменшується, видима частина — так → відступ = висота клавіатури", () => {
    const s = computeKeyboard({ ...base, vvHeight: 508 });
    expect(s).toEqual({ open: true, inset: 336, visible: 508, top: 0 });
  });
  it("iPhone: браузер сам підсунув сторінку — низ форми все одно на межі клавіатури", () => {
    const s = computeKeyboard({ ...base, vvHeight: 508, vvTop: 200 });
    expect(s.inset).toBe(136);           // 844 − 508 − 200: низ видимої частини
    expect(s.top).toBe(200);
    expect(s.visible).toBe(508);
  });
  it("Android: зменшилась сама сторінка → відступу немає, але клавіатура «відкрита»", () => {
    const s = computeKeyboard({ ...base, innerHeight: 520, vvHeight: 520 });
    expect(s).toEqual({ open: true, inset: 0, visible: 520, top: 0 });
  });
  it("рядок адреси браузера (до ~110px) — не клавіатура", () => {
    expect(computeKeyboard({ ...base, vvHeight: 760 }).open).toBe(false);
    expect(computeKeyboard({ ...base, innerHeight: 750, vvHeight: 750 }).open).toBe(false);
  });
  it("без фокуса в полі і при збільшенні щипком — нічого не рухаємо", () => {
    expect(computeKeyboard({ ...base, vvHeight: 508, editable: false }).open).toBe(false);
    expect(computeKeyboard({ ...base, vvHeight: 422, scale: 2 }).open).toBe(false);
  });
  it("кожна форма застосунку знає про клавіатуру: класи стоять у базових компонентах", () => {
    expect(readFileSync("src/components/ui/dialog.tsx", "utf8")).toMatch(/"kb-sheet fixed/);
    expect(readFileSync("src/components/ui/alert-dialog.tsx", "utf8")).toMatch(/"kb-center fixed/);
    const sheet = readFileSync("src/components/ui/sheet.tsx", "utf8");
    expect(sheet).toMatch(/"kb-bottom inset-x-0 bottom-0/);
    expect(sheet.match(/kb-side/g)?.length).toBe(2);
    expect(readFileSync("src/main.tsx", "utf8")).toMatch(/installKeyboardInset\(\)/);
  });
  it("правила в стилях і прапорець для Android на місці", () => {
    const css = readFileSync("src/index.css", "utf8");
    expect(css).toMatch(/html\.kb-open \.kb-sheet \{\s*bottom: var\(--kb-inset\) !important;\s*max-height: calc\(var\(--vvh\) - 4px\) !important;/);
    expect(css).toMatch(/html\.kb-open \.kb-bottom \{/);
    expect(css).toMatch(/html\.kb-open \.kb-center \{/);
    expect(css).toMatch(/html\.kb-open \.kb-hide \{ display: none !important; \}/);
    expect(readFileSync("index.html", "utf8")).toMatch(/interactive-widget=resizes-content/);
  });
  it("нижня навігація і «+» не вискакують над клавіатуру", () => {
    expect(readFileSync("src/components/MobileBottomNav.tsx", "utf8").match(/kb-hide fixed bottom-0/g)?.length).toBe(2);
    expect(readFileSync("src/components/PageFAB.tsx", "utf8")).toMatch(/kb-hide fixed/);
    expect(readFileSync("src/components/AddFab.tsx", "utf8")).toMatch(/kb-hide fixed/);
  });
});
