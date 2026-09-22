/**
 * source-stamp — штамп ФРОНТЕНДУ, що не залежить від git.
 *
 * Хеш вмісту всього, з чого збирається застосунок (src/, public/, index.html,
 * конфіги). Той самий код → той самий штамп, де б його не зібрали: у Lovable
 * (де git у збірці може й не бути), у CI, у сесії агента. vite.config.ts кладе
 * його у /version.json і в <meta name="build-stamp">; робот у CI рахує штамп
 * з checkout-у main і порівнює з тим, що віддає прод — «доїхало / не доїхало»
 * без здогадок і без ручного BUILD_TAG.
 *
 *   node scripts/source-stamp.mjs   → друкує штамп (8 hex)
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INPUTS = ["src", "public", "index.html", "package.json", "vite.config.ts", "tailwind.config.ts", "postcss.config.js", "tsconfig.json", "tsconfig.app.json", "components.json"];

function walk(p, acc) {
  if (!existsSync(p)) return acc;
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const e of readdirSync(p).sort()) walk(join(p, e), acc);
  } else acc.push(p);
  return acc;
}

export function sourceStamp(root = ROOT) {
  const files = INPUTS.flatMap((i) => walk(join(root, i), [])).filter((f) => !/\.(test|spec)\.(ts|tsx)$/.test(f) && !/\.DS_Store$/.test(f));
  const h = createHash("sha256");
  for (const f of files) {
    h.update(relative(root, f).split("\\").join("/"));
    h.update("\0");
    h.update(readFileSync(f));
    h.update("\0");
  }
  return h.digest("hex").slice(0, 8);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(sourceStamp());
}
