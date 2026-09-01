import { readFileSync, writeFileSync } from "node:fs";
import { globSync } from "glob";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
execSync("npx esbuild src/i18n/locales/uk.ts --bundle --format=cjs --outfile=/tmp/uk.cjs --log-level=error");
const uk = require("/tmp/uk.cjs").uk;
const flat = new Set();
(function walk(o, p) { for (const k of Object.keys(o)) { const v = o[k]; const key = p ? p + "." + k : k; if (v && typeof v === "object") walk(v, key); else flat.add(key); } })(uk, "");
const files = globSync("src/**/*.{ts,tsx}", { ignore: ["src/test/**", "src/i18n/**"] });
const missing = new Map();
for (const f of files) {
  const s = readFileSync(f, "utf-8");
  for (const m of s.matchAll(/\bt\(\s*["'`]([A-Za-z0-9_.]+)["'`]/g)) {
    const k = m[1];
    const has = flat.has(k)
      || ["_one","_few","_many","_other","_zero"].some(sfx => flat.has(k + sfx))
      || [...flat].some(x => x.startsWith(k + "."));
    if (!has) {
      const ln = s.slice(0, m.index).split("\n").length;
      if (!missing.has(k)) missing.set(k, []);
      missing.get(k).push(`${f}:${ln}`);
    }
  }
}
console.log("ключів, використаних у коді, але відсутніх у uk.ts:", missing.size);
for (const [k, at] of missing) console.log(`  ${k}  ←  ${at.join(", ")}`);
