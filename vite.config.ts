import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";
import { execSync } from "node:child_process";
import type { Plugin } from "vite";
import { sourceStamp } from "./scripts/source-stamp.mjs";

// ── Штамп збірки (22.09, «Сторож») ──────────────────────────────────────────
// У збірку САМ потрапляє хеш ДЖЕРЕЛ (scripts/source-stamp.mjs) — без ручного
// бампу BUILD_TAG (той не бампався з 07.09 через ~40 комітів, тож «свіжий чи ні»
// було не відрізнити) і без залежності від git (у збірці Lovable його може не
// бути). Поруч — хеш коміту, якщо git є, інакше «unknown». Куди: `__BUILD_SHA__`
// у коді, <meta name="build-stamp"> в index.html і /version.json поруч зі
// збіркою — робот у CI читає його з проду і каже словами, чи доїхав main.
function gitSha(): string {
  const env = process.env.VITE_BUILD_SHA || process.env.GITHUB_SHA;
  if (env) return env.slice(0, 8);
  try {
    return execSync("git rev-parse --short=8 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "unknown";
  } catch {
    return "unknown";
  }
}
const BUILD_STAMP = sourceStamp();
const BUILD_SHA = gitSha();
const BUILD_AT = new Date().toISOString();
function buildStamp(): Plugin {
  return {
    name: "otutorhub-build-stamp",
    transformIndexHtml(html) {
      return html.replace(
        /<meta name="build-stamp" content="[^"]*" \/>/,
        `<meta name="build-stamp" content="${BUILD_STAMP}" />`,
      );
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ stamp: BUILD_STAMP, sha: BUILD_SHA, builtAt: BUILD_AT }),
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __BUILD_STAMP__: JSON.stringify(BUILD_STAMP),
  },
  plugins: [react(), mode === "development" && componentTagger(), mcpPlugin(), buildStamp()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    target: "es2020",
    cssCodeSplit: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split heavy vendor deps into their own long-cacheable chunks.
        // Function form so the large @radix-ui/* set is split off the critical path.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("lucide-react")) return "icons";
          // Keep ALL React-dependent libraries in the React chunk. Splitting Radix / i18n /
          // react-query into separate chunks caused (or risks) production-only ESM init
          // cycles where React was `undefined` at module-eval (`createContext`/`forwardRef`
          // white screens — this took prod down once via Radix). @tanstack/react-query also
          // calls React.createContext at eval and wraps the whole app, so it MUST live here.
          if (id.includes("@radix-ui") || id.includes("i18next") || id.includes("@tanstack")) return "react-vendor";
          if (id.includes("react-router")) return "react-vendor";
          if (id.includes("/react-dom/") || id.includes("/react/") || id.includes("/scheduler/")) return "react-vendor";
          if (
            id.includes("vaul") ||
            id.includes("cmdk") ||
            id.includes("sonner") ||
            id.includes("embla-carousel") ||
            id.includes("class-variance-authority") ||
            id.includes("/clsx/") ||
            id.includes("tailwind-merge")
          )
            return "ui-misc";
        },
      },
    },
  },
}));
