import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "glob";

/**
 * C1 (інструкція якості 31.08): контраст-гейт за зразком currency-гейта.
 * Рахує WCAG relative luminance для ключових токенів index.css і фейлить CI,
 * коли текстові токени < 4.5:1 (нетекстові — < 3:1). Плюс ratchet на
 * відомі низькоконтрастні літерали в src — число може лише падати.
 */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const css = readFileSync("src/index.css", "utf-8");
const WHITE: [number, number, number] = [255, 255, 255];
const BG: [number, number, number] = hexToRgb("#F5F4F0");

const hexToken = (name: string): [number, number, number] => {
  const m = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`токен ${name} не знайдено в index.css`);
  return hexToRgb(m[1]);
};
const hslToken = (name: string): [number, number, number] => {
  const m = css.match(new RegExp(`${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`));
  if (!m) throw new Error(`токен ${name} не знайдено в index.css`);
  return hslToRgb(Number(m[1]), Number(m[2]), Number(m[3]));
};

describe("контраст-гейт (WCAG AA)", () => {
  it("приглушений текст: --sub ≥ 4.5:1 на білому І на --ds-bg; --ds-muted ≥ 4.5:1 на білому", () => {
    for (const name of ["--sub", "--ds-sub"]) {
      const rgb = hexToken(name);
      expect(contrast(rgb, WHITE), `${name} на білому`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(rgb, BG), `${name} на #F5F4F0`).toBeGreaterThanOrEqual(4.5);
    }
    // --ds-muted живе на білих картках; на бежевому тлі текстом має йти --sub.
    expect(contrast(hexToken("--ds-muted"), WHITE), "--ds-muted на білому").toBeGreaterThanOrEqual(4.5);
  });

  it("фокус-кільце --ring ≥ 3:1 на білому (видно з клавіатури)", () => {
    expect(contrast(hslToken("--ring"), WHITE)).toBeGreaterThanOrEqual(3);
  });

  it("--warning-foreground ≥ 4.5:1 на --warning (текст бейджів читається)", () => {
    expect(contrast(hslToken("--warning-foreground"), hslToken("--warning"))).toBeGreaterThanOrEqual(4.5);
  });

  it("ratchet: відомі низькоконтрастні літерали не повертаються", () => {
    const files = globSync("src/**/*.{ts,tsx,css}", { ignore: ["src/test/**"] });
    let dead = 0; // #b0b4c8 (2.06:1) — замінено на #6f7489 хвилею C1; має лишатись 0
    let tealText = 0; // #2BBFAA як КОЛІР ТЕКСТУ (2.30:1) — baseline, лише вниз
    for (const f of files) {
      const src = readFileSync(f, "utf-8");
      dead += (src.match(/#b0b4c8/gi) ?? []).length;
      tealText += (src.match(/text-\[#2BBFAA\]|color:\s*["']#2BBFAA["']/g) ?? []).length;
    }
    expect(dead, "#b0b4c8 повернувся — це 2.06:1").toBe(0);
    expect(tealText, "нових teal-текстів (2.30:1) бути не може").toBeLessThanOrEqual(13);
  });
});
