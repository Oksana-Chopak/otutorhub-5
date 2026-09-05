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
 * Скрипт друкує чотири списки. Exit 1, якщо є міграції нижче водяного знаку, що
 * ще не позначені як застосовані в docs/PROD-DB-SYNC.md.
 *
 * Четвертий список (доказ тілом) закриває сліпу пляму: перевипуск функції з тією
 * самою сигнатурою не міняє types.ts, тож раніше відповідь була «спитай журнал»,
 * а журнал відстає. Тепер тіло функції з міграції шукається серед застосованих
 * хеш-файлів Lovable і звіряється за ЗМІСТОМ (коментарі й переноси ігноруються).
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
//
// ⚠️ Аудит 03.09 — межа методу. types.ts описує ФОРМУ схеми, не її тіло. Якщо
// міграція ПЕРЕВИПУСКАЄ наявний обʼєкт (CREATE OR REPLACE в'ю чи функції з тією
// самою сигнатурою), маркер збігається ще ДО застосування — і скрипт каже
// «✅ live» про те, чого в проді немає. Саме так виглядав фікс подвоєння
// lessons_visible: сигнатура та сама, тіло інше.
// Тому такі міграції МУСЯТЬ нести
//   -- LIVE-MARKER-NONE: <як перевірити вручну>
// і скрипт позначає їх «❓ не доводиться з types.ts», а не «live». Маркер, який
// збігається у файлі ВИЩЕ водяного знаку (тобто ще не застосованому), також
// позначається як недоказовий — збіг там означає лише, що обʼєкт уже існував.
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
const pending = new Set(above);   // ще НЕ застосовані — збіг маркера нічого не доводить
for (const f of files) {
  const t = readFileSync(join(MIG, f), "utf8");
  for (const m of t.matchAll(/--\s*LIVE-MARKER-NONE:\s*(.+)$/gm)) {
    markers.push({ f, marker: m[1].trim(), state: "unprovable" });
  }
  for (const m of t.matchAll(/--\s*LIVE-MARKER:\s*(.+)$/gm)) {
    const hit = TYPES.includes(m[1].trim());
    markers.push({ f, marker: m[1].trim(), state: pending.has(f) ? "unprovable" : hit ? "live" : "no" });
  }
  for (const m of t.matchAll(/--\s*LIVE-MARKER-IN:\s*(\S+)\s*::\s*(.+)$/gm)) {
    const block = rowBlock(m[1].trim());
    const hit = block.includes(m[2].trim());
    markers.push({ f, marker: `${m[1].trim()} → ${m[2].trim()}`, state: pending.has(f) ? "unprovable" : hit ? "live" : "no" });
  }
}

console.log(`═ Водяний знак Lovable: ${watermark} (${hashes.at(-1) ?? "—"})`);
console.log(`\n▶ Вище водяного знаку (Lovable ЗАСТОСУЄ при наступному «виконай»): ${above.length}`);
for (const f of above) console.log(`   ${f}`);
console.log(`\n⚠ Нижче водяного знаку і НЕ позначені ✅ у docs/PROD-DB-SYNC.md (Lovable пропустить мовчки): ${belowUnknown.length}`);
for (const f of belowUnknown) console.log(`   ${f}`);
console.log(`\n◆ LIVE-MARKER перевірка проти types.ts: ${markers.length}`);
const badge = { live: "✅ live      ", no: "⛔ NOT live  ", unprovable: "❓ не доводиться" };
for (const m of markers) console.log(`   ${badge[m.state]}  ${m.f}  ← ${m.marker}`);
/* ── Доказ для перевипущених обʼєктів ───────────────────────────────────────
   Коли функцію перевипускають із тією самою сигнатурою, types.ts не міняється,
   тож LIVE-MARKER-NONE донедавна означав лише «спитай журнал». А журнал
   відстає: 05.09 він казав «⛔ чекає Run у Lovable», хоча Lovable застосував
   обидві функції ще о 09:50 — і аудиторка переказала журнал як факт.
   Тому доводимо інакше: шукаємо ТІЛО обʼєкта серед уже застосованих хеш-файлів
   Lovable. Збіг слово в слово = обʼєкт у проді саме такий. Розбіжність = у проді
   ІНША версія: найнебезпечніший стан, бо журнал у ньому каже «✅ live». */
/* Порівнюємо ЗМІСТ, не форматування: коментарі й переноси не міняють поведінку
   функції, а різняться завжди (SQL для власниці ущільнюється перед вставкою в
   чат). Без цього перевірка кричала б «інша версія» на кожну косметику. */
const normSql = (x) =>
  x.replace(/\/\*[\s\S]*?\*\//g, " ")   // блокові коментарі
   .replace(/--[^\n]*/g, " ")            // рядкові коментарі
   .replace(/\s+/g, " ")
   .trim();
const objectsIn = (text) => {
  const out = [];
  for (const m of text.matchAll(/CREATE\s+OR\s+REPLACE\s+(FUNCTION|VIEW)\s+public\.([a-z_0-9]+)/gi)) {
    const kind = m[1].toUpperCase();
    const end = kind === "FUNCTION"
      ? (text.indexOf("$$;", m.index) === -1 ? -1 : text.indexOf("$$;", m.index) + 3)
      : (text.indexOf(";", m.index) === -1 ? -1 : text.indexOf(";", m.index) + 1);
    if (end === -1) continue;
    out.push({ kind, name: m[2], body: normSql(text.slice(m.index, end)) });
  }
  return out;
};

const appliedHashes = hashes.filter((h) => h.slice(0, 14) <= watermark);
const appliedObjects = new Map();           // name → [{ file, body }] у порядку застосування
for (const h of appliedHashes)
  for (const o of objectsIn(readFileSync(join(MIG, h), "utf8")))
    appliedObjects.set(o.name, [...(appliedObjects.get(o.name) ?? []), { file: h, body: o.body }]);

const proofs = [];
for (const f of [...new Set(markers.filter((m) => m.state === "unprovable").map((m) => m.f))].sort()) {
  for (const obj of objectsIn(readFileSync(join(MIG, f), "utf8"))) {
    const seen = appliedObjects.get(obj.name) ?? [];
    const exact = [...seen].reverse().find((x) => x.body === obj.body);
    if (proofs.some((p) => p.f === f && p.name === obj.name)) continue;   // один рядок на обʼєкт
    proofs.push({ f, name: obj.name, exact: exact?.file ?? null, latest: seen.at(-1)?.file ?? null });
  }
}

if (proofs.length) {
  console.log(`\n◆ Доказ тілом у застосованих файлах Lovable: ${proofs.length}`);
  for (const p of proofs) {
    const from = `${p.f}  →  ${p.name}()`;
    if (p.exact) console.log(`   ✅ у проді саме це      ${from}\n        збіг зі змістом ${p.exact}`);
    else if (p.latest) console.log(`   ⚠ у проді ІНША ВЕРСІЯ  ${from}\n        остання застосована: ${p.latest} — ця міграція ще не доїхала`);
    else console.log(`   ❓ не знайдено          ${from}\n        жоден застосований файл Lovable його не містить`);
  }
}

const unprovable = markers.filter((m) => m.state === "unprovable");
const stillUnknown = unprovable.filter((m) => !proofs.some((p) => p.f === m.f && p.exact));
if (stillUnknown.length) {
  console.log(`\n❓ ${stillUnknown.length} маркер(ів) НЕ доводяться ні з types.ts, ні тілом.`);
  console.log(`   Лише для НИХ стан бери з журналу docs/PROD-DB-SYNC.md.`);
}

process.exit(belowUnknown.length ? 1 : 0);
