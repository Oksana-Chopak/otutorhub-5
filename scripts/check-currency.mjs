// P1: сканер літеральних валют — ₴ € kr zł £ та $-сум у .tsx і в значеннях локалей.
// Мета: 0 літералів поза src/lib/currency.ts; всі суми через formatPrice().
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
const OK = new Set(["src/lib/currency.ts", "src/components/CurrencyComboBox.tsx", "src/lib/importStudents.ts"]); // канон + пікер-визначення + парсер імпорту (₴/грн у regex РОЗПІЗНАВАННЯ, не в рендері)
const hits = [];
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) { if (!/node_modules|test/.test(p)) walk(p); continue; }
    if (!/\.(tsx|ts)$/.test(p) || OK.has(p) || /\.test\./.test(p)) continue;
    const src = readFileSync(p, "utf8");
    src.split("\n").forEach((line, i) => {
      const tl = line.trim();
      if (tl.startsWith("//") || tl.startsWith("*") || tl.startsWith("/*")) return;   // коментарі
      if (/SYMBOL|from "@\/lib\/currency"/.test(line)) return; // Р: лише визначення канону, НЕ виклики — гейт не вірить собі на слово
      if (/[₴€£]|(?<=[\d}]\s?)kr\b|\bkr(?=\s?[\d{])|(?<=[\d}]\s?)zł\b|\bzł(?=\s?[\d{])/.test(line)) hits.push(`${p}:${i + 1}: ${tl.slice(0, 100)}`);
    });
  }
}
walk("src");
const byFile = {};
for (const h of hits) { const f = h.split(":")[0]; byFile[f] = (byFile[f] ?? 0) + 1; }
console.log("═ Літеральні валюти: " + hits.length + " рядків у " + Object.keys(byFile).length + " файлах ═");
Object.entries(byFile).sort((a, b) => b[1] - a[1]).forEach(([f, n]) => console.log(String(n).padStart(4), f));
console.log("─ перші 40 ─");
hits.slice(0, 40).forEach((h) => console.log(h));

// ── П3.19 (вердикт 31.08): аргументи теж перевіряються ─────────────────────
// formatPrice(..., "UAH") літералом — це та сама зашита валюта, лише поверхом
// вище: рядок покаже ₴ шведському учню. Частина викликів ЛЕГІТИМНА (підписка
// свідомо в гривні; фінанси менеджера — UAH до хаб-етапу П4), тому це ratchet:
// число може лише падати. Нове місце з "UAH" — обери валюту пари/рядка або
// свідомо підніми baseline тут із поясненням.
// 05.09 вечір: 42→43 усвідомлено — аудит розділив одну картку «Заборгованість»
// менеджера на дві («Учні винні» / «Винні репетиторам»), обидві на хабовій
// (single-currency UAH) моделі. Це не новий неохайний літерал, а той самий,
// що став двома. Кожен наступний +1 — лише з таким же поясненням тут.
// 05.09 ніч: 43→45 — save-офер Light у потоці скасування показує ціну плану
// двічі (підзаголовок + кнопка). Ціни підписки ЗАФІКСОВАНІ в гривні рішенням
// власниці 02.09 (pricing.ts) — тут UAH-літерал і є правилом, не недбалістю.
// 05.09 пізніше: 45→46 — превʼю імпорту учнів показує розібрану ціну; сам
// імпорт створює ставки в UAH за задумом v1 (укр. ринок), тож літерал чесний.
const MAX_UAH_ARGS = 46; // станом на 05.09
const uahArgHits = [];
function walkUah(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) { if (!/node_modules|test/.test(p)) walkUah(p); continue; }
    if (!/\.(tsx|ts)$/.test(p) || /\.test\./.test(p)) continue;
    const src = readFileSync(p, "utf8");
    src.split("\n").forEach((line, i) => {
      const tl = line.trim();
      if (tl.startsWith("//") || tl.startsWith("*") || tl.startsWith("/*")) return;
      if (/formatPrice\([^)]*,\s*["']UAH["']/.test(line)) uahArgHits.push(`${p}:${i + 1}: ${tl.slice(0, 100)}`);
    });
  }
}
walkUah("src");
console.log(`═ formatPrice(..., "UAH") літералом: ${uahArgHits.length} (ratchet ≤ ${MAX_UAH_ARGS}) ═`);
if (uahArgHits.length > MAX_UAH_ARGS) {
  console.error(`⛔ Нові зашиті "UAH" в аргументах (${uahArgHits.length} > ${MAX_UAH_ARGS}):`);
  uahArgHits.forEach((h) => console.error("   " + h));
}

process.exit(hits.length || uahArgHits.length > MAX_UAH_ARGS ? 1 : 0); // ГЕЙТ: нуль літеральних валют + UAH-ratchet лише вниз
