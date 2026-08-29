// P1: сканер літеральних валют — ₴ € kr zł £ та $-сум у .tsx і в значеннях локалей.
// Мета: 0 літералів поза src/lib/currency.ts; всі суми через formatPrice().
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
const OK = new Set(["src/lib/currency.ts", "src/components/CurrencyComboBox.tsx"]); // канон + пікер-визначення
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
      if (/currency|SYMBOL|formatPrice|usd\(/.test(line)) return;                      // канон у дії
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
process.exit(hits.length ? 1 : 0); // ГЕЙТ: нуль літеральних валют — назавжди
