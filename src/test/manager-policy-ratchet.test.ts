import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "glob";

/**
 * П3.20 (вердикт 31.08): обіцяний CI-гейт на «голий» has_role('manager')
 * у міграціях. Поки модель «школа = сутність» відкладена, КОЖНА нова
 * менеджерська політика без хаб-скоупа розширює борг зі 129 армів, який
 * потім доведеться зводити вручну (docs/SECURITY-ARMS.md).
 *
 * Ratchet: історія незмінна (застосовані файли не редагуються), тож число
 * може лише НЕ рости. Нова політика для менеджера має або скоупитись через
 * is_hub_* (коли модель приїде), або свідомо піднімати baseline У ЦЬОМУ
 * ФАЙЛІ з поясненням, чому без скоупа — інакше тест червоний.
 */
const BASELINE = 165; // станом на 05.09 (усі міграції до 20260905120000 включно)

describe("міграції: менеджерські політики без хаб-скоупа (ratchet)", () => {
  it(`«голих» has_role('manager') у CREATE POLICY не більше ніж ${BASELINE}`, () => {
    const files = globSync("supabase/migrations/*.sql").sort();
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf-8");
      for (const m of src.matchAll(/CREATE POLICY[\s\S]*?;/gi)) {
        const block = m[0];
        if (/has_role\s*\(\s*auth\.uid\(\)\s*,\s*'manager'/.test(block) && !block.includes("is_hub_")) {
          offenders.push(f);
        }
      }
    }
    expect(
      offenders.length,
      `нові неcкоуплені менеджерські політики: ${offenders.slice(BASELINE).join(", ")}`,
    ).toBeLessThanOrEqual(BASELINE);
  });
});
