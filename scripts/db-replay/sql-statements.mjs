/**
 * sql-statements — постатейне порівняння SQL (06.10).
 *
 * Навіщо: Lovable застосовує вставлений власницею SQL своїм хеш-файлом
 * `YYYYMMDDHHMMSS_<uuid>.sql` і пише туди ТОЙ САМИЙ текст (29.09, 02.10 — слово в
 * слово, лише без наших коментарів і, бува, з доданим `SET search_path`). Тож
 * «чи ця міграція в проді» можна ДОВЕСТИ змістом: кожен її statement, що лишає
 * слід у базі, є серед statements застосованих хеш-файлів. Без цього після
 * кожної вставки main червонів, доки хтось не допише ✅ у журнал (02.10).
 *
 * Що ігноруємо, бо воно не лишає сліду в базі або не міняє поведінки:
 *   • коментарі (рядкові/блокові, і всередині тіл функцій);
 *   • пробіли й переноси;
 *   • `COMMENT ON …` (вставка для власниці їх не несе);
 *   • `DO $$ … $$` — вбудовані самоперевірки: вони або пройшли під час
 *     застосування, або Lovable показав помилку; у базі їх немає;
 *   • `SET search_path = …` у заголовку функції — Lovable дописує його сам.
 */

/** Прибирає рядкові та блокові коментарі, поважаючи '…' і "…". */
export function stripComments(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    const two = text.slice(i, i + 2);
    if (two === "--") { const e = text.indexOf("\n", i); i = e === -1 ? n : e; out += " "; continue; }
    if (two === "/*") { const e = text.indexOf("*/", i + 2); i = e === -1 ? n : e + 2; out += " "; continue; }
    if (ch === "'") {
      let j = i + 1;
      while (j < n) { if (text[j] === "'" && text[j + 1] === "'") { j += 2; continue; } if (text[j] === "'") break; j++; }
      out += text.slice(i, j + 1); i = j + 1; continue;
    }
    if (ch === '"') { const e = text.indexOf('"', i + 1); const j = e === -1 ? n - 1 : e; out += text.slice(i, j + 1); i = j + 1; continue; }
    out += ch; i++;
  }
  return out;
}

/** Розбиває SQL на statements, поважаючи '…', "…", $tag$…$tag$ і коментарі. */
export function splitStatements(sql) {
  const out = [];
  let cur = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const two = sql.slice(i, i + 2);
    if (two === "--") { const end = sql.indexOf("\n", i); i = end === -1 ? n : end + 1; cur += " "; continue; }
    if (two === "/*") { const end = sql.indexOf("*/", i + 2); i = end === -1 ? n : end + 2; cur += " "; continue; }
    if (ch === "'") {
      let j = i + 1;
      while (j < n) { if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; } if (sql[j] === "'") break; j++; }
      cur += sql.slice(i, j + 1); i = j + 1; continue;
    }
    if (ch === '"') { const end = sql.indexOf('"', i + 1); const j = end === -1 ? n - 1 : end; cur += sql.slice(i, j + 1); i = j + 1; continue; }
    if (ch === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        const j = end === -1 ? n : end + tag.length;
        const body = sql.slice(i + tag.length, end === -1 ? n : end);
        cur += tag + stripComments(body) + (end === -1 ? "" : tag);
        i = j; continue;
      }
    }
    if (ch === ";") { const s = cur.replace(/\s+/g, " ").trim(); if (s) out.push(s); cur = ""; i++; continue; }
    cur += ch; i++;
  }
  const tail = cur.replace(/\s+/g, " ").trim();
  if (tail) out.push(tail);
  return out;
}

/** Канонічна форма statement для порівняння. */
export function normalizeStatement(s) {
  return s
    .replace(/\bSET\s+search_path\s*(?:=|TO)\s*[^ ]+(?:\s*,\s*[^ ]+)*/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*([(),=;])\s*/g, "$1")
    .trim();
}

/** Statement лишає слід у базі (не коментар і не самоперевірка). */
export function isPersistentStatement(s) {
  return !/^(COMMENT ON |DO\s*\$)/i.test(s);
}

/** Канонічні statements файла, що лишають слід у базі. */
export function persistentStatements(sql) {
  return splitStatements(sql).filter(isPersistentStatement).map(normalizeStatement);
}

/**
 * Індекс застосованих statements: канонічний statement → хеш-файли Lovable, де він є.
 * `entries` — [{ file, sql }] у будь-якому порядку.
 */
export function indexAppliedStatements(entries) {
  const index = new Map();
  for (const { file, sql } of entries)
    for (const s of persistentStatements(sql)) {
      const list = index.get(s) ?? [];
      if (!list.includes(file)) list.push(file);
      index.set(s, list);
    }
  return index;
}

/**
 * Доказ: кожен statement `ours` є в хеш-файлі, який `accept(file)` визнає доречним.
 * Повертає { proven, missing, files } — files: з яких хеш-файлів зібрано доказ.
 *
 * Навіщо `accept`: GRANT чи REVOKE, що повторюються з міграції в міграцію, є і в
 * СТАРИХ хеш-файлах — без обмеження «перевидання прав» вважалось би живим ще до
 * вставки (а саме після «security findings» Lovable воно й потрібне). Тому ворота
 * приймають лише хеш-файли, не старші за нашу міграцію (з люфтом на добу: 29.09 файл
 * прав названо 12:00, а Lovable записав його хеш об 11:46 — таймстемп у назві
 * обирається наперед).
 */
export function proveByContent(ours, applied, accept = () => true) {
  const missing = [];
  const files = new Set();
  for (const s of ours) {
    const f = (applied.get(s) ?? []).filter(accept).sort().at(-1);
    if (f) files.add(f); else missing.push(s);
  }
  return { proven: ours.length > 0 && missing.length === 0, missing, files: [...files].sort() };
}

/** Хеш-файл Lovable доречний для міграції `ours`, якщо він не старший за неї мінус доба. */
export function acceptsHashFor(oursFile) {
  const ts = oursFile.slice(0, 14);
  // YYYYMMDDHHMMSS → мінус 1 день (через Date, щоб не рахувати місяці вручну)
  const d = new Date(Date.UTC(+ts.slice(0, 4), +ts.slice(4, 6) - 1, +ts.slice(6, 8), +ts.slice(8, 10), +ts.slice(10, 12), +ts.slice(12, 14)));
  d.setUTCDate(d.getUTCDate() - 1);
  const floor = d.toISOString().replace(/\D/g, "").slice(0, 14);
  return (hashFile) => hashFile.slice(0, 14) >= floor;
}
