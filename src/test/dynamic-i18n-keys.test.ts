/**
 * 47: динамічні ключі t(`group.${expr}`) — check-i18n їх не бачить,
 * бо сканує лише літерали. Тут перевіряємо, що кожна сім'я повна В УСІХ
 * ТРЬОХ мовах: відсутній ключ дає порожній рядок або сирий ключ на екрані.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");
const locales = ["uk", "en", "sv"] as const;

function group(text: string, name: string): string | null {
  const m = new RegExp(`\\n\\s*${name}: \\{`).exec(text);
  if (!m) return null;
  let depth = 1, i = m.index + m[0].length;
  const start = i;
  while (depth > 0 && i < text.length) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") depth--;
    i++;
  }
  return text.slice(start, i - 1);
}

describe("динамічні ключі i18n", () => {
  // Члени сімей читаємо З КОДУ, а не вгадуємо: інакше тест перевіряє мою
  // засновку, а не реальність (перша версія шукала languageSwitcher.uk,
  // тоді як labelKey там — "ukrainian").
  const switcher = readFileSync(join(src, "components/LanguageSwitcher.tsx"), "utf8");
  const switcherKeys = [...switcher.matchAll(/labelKey:\s*"(\w+)"/g)].map((m) => m[1]);

  const FAMILIES: Array<[string, string[]]> = [
    ["weekday", ["0", "1", "2", "3", "4", "5", "6"]],
    ["languageSwitcher", switcherKeys],
  ];

  it.each(locales)("%s: усі динамічні сім'ї повні", (loc) => {
    const text = readFileSync(join(src, `i18n/locales/${loc}.ts`), "utf8");
    const missing: string[] = [];
    for (const [name, members] of FAMILIES) {
      const body = group(text, name);
      if (body === null) { missing.push(`${name} (групи нема)`); continue; }
      for (const k of members) {
        if (!new RegExp(`(^|\\s)"?${k}"?:`, "m").test(body)) missing.push(`${name}.${k}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("кожен t(`group.${expr}`) у коді має або defaultValue, або перелічену сім'ю", () => {
    // Сім'ї, чиї члени приходять з бази/рантайму, мусять мати defaultValue —
    // інакше невідоме значення покаже сирий ключ.
    const RUNTIME_SITES: Array<[string, string]> = [
      ["pages/AdminStatsPage.tsx", "adminCrm.evt_"],
      ["components/CurrencyComboBox.tsx", "currencyComboBox.name."],
    ];
    const offenders: string[] = [];
    for (const [rel, prefix] of RUNTIME_SITES) {
      const text = readFileSync(join(src, rel), "utf8");
      const idx = text.indexOf(prefix);
      if (idx === -1) continue;
      const around = text.slice(idx, idx + 260);
      if (!/defaultValue/.test(around)) offenders.push(`${rel}: ${prefix}`);
    }
    expect(offenders, "рантайм-ключ без defaultValue покаже сирий ключ").toEqual([]);
  });
});
