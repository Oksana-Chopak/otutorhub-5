import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "glob";

/**
 * C-хвиля, гейти доступності (ratchet — числа можуть ЛИШЕ падати):
 *
 *  1. «Гейт імені»: поле вводу без aria-label / aria-labelledby / id — для
 *     скрінрідера це просто «поле вводу». Було 85, стало 0.
 *  2. «Гейт цілі дотику»: інтерактивний елемент із явною висотою < 44px і без
 *     класу .tap-44 (той розширює ЗОНУ натискання, не змінюючи вигляд).
 *     Було 42, стало 0.
 *  3. «Гейт клавіатури»: div/span/tr/li з onClick без tabIndex/onKeyDown —
 *     мишею працює, клавіатурою ні. Було 16, стало 0.
 *
 * Свідомі виключення: примітиви в src/components/ui (імʼя дає той, хто їх
 * використовує), приховані `className="hidden"` інпути (їх тисне видима
 * кнопка), бекдропи `inset-0` (їх закриває Escape) і обгортки, що лише
 * глушать спливання події.
 */

const NAMED_BASELINE = 0;
const TOUCH_BASELINE = 0;
const KEYBOARD_BASELINE = 0;

const files = globSync("src/**/*.tsx", { ignore: ["src/test/**", "src/components/ui/**"] });

/** Межі відкривального JSX-тега з урахуванням лапок, шаблонів і вкладених { }. */
function openingTags(src: string, tags: string[]): Array<{ tag: string; start: number; attrs: string }> {
  const out: Array<{ tag: string; start: number; attrs: string }> = [];
  const re = new RegExp(`<(${tags.join("|")})\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = re.lastIndex;
    let depth = 0;
    let quote: string | null = null;
    let tick = false;
    while (i < src.length) {
      const c = src[i];
      if (quote) {
        if (c === "\\") { i += 2; continue; }
        if (c === quote) quote = null;
      } else if (tick) {
        if (c === "\\") { i += 2; continue; }
        if (c === "`") tick = false;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === "`") tick = true;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
      i++;
    }
    out.push({ tag: m[1], start: m.index, attrs: src.slice(re.lastIndex, i) });
  }
  return out;
}

const TW_H: Record<string, number> = { "h-3": 12, "h-3.5": 14, "h-4": 16, "h-5": 20, "h-6": 24, "h-7": 28, "h-8": 32, "h-9": 36, "h-10": 40, "h-11": 44, "h-12": 48, "h-14": 56 };

function explicitHeight(attrsRaw: string): number | null {
  const cut = attrsRaw.indexOf("=>");
  const attrs = cut > 0 ? attrsRaw.slice(0, cut) : attrsRaw;
  const inline = /\bheight\s*:\s*(\d+)/.exec(attrs);
  if (inline) return Number(inline[1]);
  const px = /(?<![\w-])h-\[(\d+)px\]/.exec(attrs);
  if (px) return Number(px[1]);
  for (const [k, v] of Object.entries(TW_H)) {
    if (new RegExp(`(?<![\\w-])${k.replace(".", "\\.")}(?![\\w.[-])`).test(attrs)) return v;
  }
  return null;
}

function scan() {
  const unnamed: string[] = [];
  const small: string[] = [];
  const noKeyboard: string[] = [];
  for (const f of files) {
    const s = readFileSync(f, "utf-8");
    const lineOf = (i: number) => s.slice(0, i).split("\n").length;

    for (const { start, attrs } of openingTags(s, ["input", "textarea", "select", "Input", "Textarea", "SelectTrigger"])) {
      if (/aria-label\b|aria-labelledby\b|\bid=/.test(attrs)) continue;
      if (/className="hidden"/.test(attrs)) continue;
      const head = s.slice(Math.max(0, start - 400), start);
      if (/<label\b[^>]*>(?:(?!<\/label>)[\s\S])*$/.test(head)) continue; // інпут усередині <label>
      unnamed.push(`${f}:${lineOf(start)}`);
    }

    for (const { start, attrs } of openingTags(s, ["button", "a", "Button"])) {
      if (attrs.includes("tap-44")) continue;
      const h = explicitHeight(attrs);
      if (h !== null && h < 44) small.push(`${f}:${lineOf(start)} (${h}px)`);
    }

    for (const { start, attrs } of openingTags(s, ["div", "span", "tr", "li", "td"])) {
      if (!attrs.includes("onClick")) continue;
      if (attrs.includes("tabIndex") || attrs.includes("onKeyDown")) continue;
      if (attrs.includes("stopPropagation") && !/onClick=\{\(\) =>/.test(attrs)) continue;
      if (/inset-0|inset: 0|onClickCapture/.test(attrs)) continue;
      noKeyboard.push(`${f}:${lineOf(start)}`);
    }
  }
  return { unnamed, small, noKeyboard };
}

describe("a11y ratchet (імена полів · цілі дотику · клавіатура)", () => {
  const r = scan();

  it(`полів без програмного імені — не більше ${NAMED_BASELINE}`, () => {
    if (r.unnamed.length > NAMED_BASELINE) console.error("Без імені:\n" + r.unnamed.join("\n"));
    expect(r.unnamed.length).toBeLessThanOrEqual(NAMED_BASELINE);
  });

  it(`цілей дотику < 44px без .tap-44 — не більше ${TOUCH_BASELINE}`, () => {
    if (r.small.length > TOUCH_BASELINE) console.error("Дрібні цілі:\n" + r.small.join("\n"));
    expect(r.small.length).toBeLessThanOrEqual(TOUCH_BASELINE);
  });

  it(`клікабельних без клавіатури — не більше ${KEYBOARD_BASELINE}`, () => {
    if (r.noKeyboard.length > KEYBOARD_BASELINE) console.error("Без клавіатури:\n" + r.noKeyboard.join("\n"));
    expect(r.noKeyboard.length).toBeLessThanOrEqual(KEYBOARD_BASELINE);
  });
});
