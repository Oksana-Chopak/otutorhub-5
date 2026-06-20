import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
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
          if (id.includes("@radix-ui")) return "radix-ui";
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("@tanstack")) return "query";
          if (id.includes("lucide-react")) return "icons";
          if (id.includes("i18next")) return "i18n"; // i18next + react-i18next
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
