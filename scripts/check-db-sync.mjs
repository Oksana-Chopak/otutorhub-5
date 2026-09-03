#!/usr/bin/env node
/**
 * check-db-sync — що з міграцій РЕАЛЬНО в проді.
 *
 * Під капотом: файл у supabase/migrations/ — це лише текст. У прод він потрапляє,
 * коли власниця вставить його в чат Lovable. Після застосування Lovable:
 *   (а) записує власний хеш-файл  YYYYMMDDHHMMSS_<uuid>.sql  (водяний знак),
 *   (б) перегенеровує src/integrations/supabase/types.ts із ЖИВОЇ бази.
 * Отже:
 *   • міграція з таймстемпом НИЖЧЕ останнього хеш-файлу — Lovable її мовчки
 *     пропустить (ordering trap, CLAUDE.md);
 *   • колонка/функція є в проді ⇔ вона є у types.ts.
 *
 * Скрипт друкує три списки. Exit 1, якщо є міграції нижче водяного знаку, що
 * ще не позначені як застосовані в docs/PROD-DB-SYNC.md.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = join(ROOT, "supabase/migrations");
const TYPES = readFileSync(join(ROOT, "src/integrations/supabase/types.ts"), "utf8");
const LEDGER = join(ROOT, "docs/PROD-DB-SYNC.md");
const ledger = existsSync(LEDGER) ? readFileSync(LEDGER, "utf8") : "";

const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const isLovableHash = (f) => /^\d{14}_[0-9a-f]{8}-[0-9a-f]{4}-/.test(f);
const hashes = files.filter(isLovableHash);
const watermark = hashes.length ? hashes[hashes.length - 1].slice(0, 14) : "00000000000000";

const appliedInLedger = new Set(
  [...ledger.matchAll(/^\|\s*`?(\d{14}[^`|\s]*)`?\s*\|[^|]*\|[^|]*\|\s*✅/gm)].map((m) => m[1]),
);
// Рядок журналу `< YYYYMMDDHHMMSS` = усе нижче цього знаку є історією (застосовано).
const historyBelow = ledger.match(/^\|\s*`<\s*(\d{14})[^`]*`[^|]*\|[^|]*\|[^|]*\|\s*✅/m)?.[1] ?? "00000000000000";

const above = [], belowUnknown = [];
for (const f of files) {
  if (isLovableHash(f)) continue;
  const ts = f.slice(0, 14);
  const known = [...appliedInLedger].some((k) => f.startsWith(k));
  if (ts > watermark) above.push(f);
  else if (!known && ts >= historyBelow) belowUnknown.push(f);
}

// Маркери «живе в проді» для міграцій, що заявляють їх у коментарі:
//   -- LIVE-MARKER: <рядок, який має з'явитись у types.ts>
//   -- LIVE-MARKER-IN: <назва Row у types.ts> :: <фрагмент усередині цього Row>
//   (для колонок у в'ю/таблицях, де сам фрагмент не унікальний по файлу)
const markers = [];
const rowBlock = (name) => {
  const i = TYPES.indexOf(`      ${name}: {`);
  if (i === -1) return "";
  let depth = 0, j = i;
  for (; j < TYPES.length; j++) {
    if (TYPES[j] === "{") depth++;
    else if (TYPES[j] === "}" && --depth === 0) break;
  }
  return TYPES.slice(i, j);
};
for (const f of files) {
  const t = readFileSync(join(MIG, f), "utf8");
  for (const m of t.matchAll(/--\s*LIVE-MARKER:\s*(.+)$/gm)) {
    markers.push({ f, marker: m[1].trim(), live: TYPES.includes(m[1].trim()) });
  }
  for (const m of t.matchAll(/--\s*LIVE-MARKER-IN:\s*(\S+)\s*::\s*(.+)$/gm)) {
    const block = rowBlock(m[1].trim());
    markers.push({ f, marker: `${m[1].trim()} → ${m[2].trim()}`, live: block.includes(m[2].trim()) });
  }
}

console.log(`═ Водяний знак Lovable: ${watermark} (${hashes.at(-1) ?? "—"})`);
console.log(`\n▶ Вище водяного знаку (Lovable ЗАСТОСУЄ при наступному «виконай»): ${above.length}`);
for (const f of above) console.log(`   ${f}`);
console.log(`\n⚠ Нижче водяного знаку і НЕ позначені ✅ у docs/PROD-DB-SYNC.md (Lovable пропустить мовчки): ${belowUnknown.length}`);
for (const f of belowUnknown) console.log(`   ${f}`);
console.log(`\n◆ LIVE-MARKER перевірка проти types.ts: ${markers.length}`);
for (const m of markers) console.log(`   ${m.live ? "✅ live " : "⛔ NOT live"}  ${m.f}  ← ${m.marker}`);

process.exit(belowUnknown.length ? 1 : 0);
