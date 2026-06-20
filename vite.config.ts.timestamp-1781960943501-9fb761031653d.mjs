// vite.config.ts
import { defineConfig } from "file:///sessions/focused-busy-faraday/mnt/otutorhub-5/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/focused-busy-faraday/mnt/otutorhub-5/node_modules/@vitejs/plugin-react-swc/index.js";
import path from "path";
import { componentTagger } from "file:///sessions/focused-busy-faraday/mnt/otutorhub-5/node_modules/lovable-tagger/dist/index.js";
var __vite_injected_original_dirname = "/sessions/focused-busy-faraday/mnt/otutorhub-5";
var vite_config_default = defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false
    }
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "./src")
    }
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
          if (id.includes("i18next")) return "i18n";
          if (id.includes("react-router")) return "react-vendor";
          if (id.includes("/react-dom/") || id.includes("/react/") || id.includes("/scheduler/")) return "react-vendor";
          if (id.includes("vaul") || id.includes("cmdk") || id.includes("sonner") || id.includes("embla-carousel") || id.includes("class-variance-authority") || id.includes("/clsx/") || id.includes("tailwind-merge"))
            return "ui-misc";
        }
      }
    }
  }
}));
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvZm9jdXNlZC1idXN5LWZhcmFkYXkvbW50L290dXRvcmh1Yi01XCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvc2Vzc2lvbnMvZm9jdXNlZC1idXN5LWZhcmFkYXkvbW50L290dXRvcmh1Yi01L3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9zZXNzaW9ucy9mb2N1c2VkLWJ1c3ktZmFyYWRheS9tbnQvb3R1dG9yaHViLTUvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiO1xuaW1wb3J0IHJlYWN0IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1yZWFjdC1zd2NcIjtcbmltcG9ydCBwYXRoIGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBjb21wb25lbnRUYWdnZXIgfSBmcm9tIFwibG92YWJsZS10YWdnZXJcIjtcblxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZygoeyBtb2RlIH0pID0+ICh7XG4gIHNlcnZlcjoge1xuICAgIGhvc3Q6IFwiOjpcIixcbiAgICBwb3J0OiA4MDgwLFxuICAgIGhtcjoge1xuICAgICAgb3ZlcmxheTogZmFsc2UsXG4gICAgfSxcbiAgfSxcbiAgcGx1Z2luczogW3JlYWN0KCksIG1vZGUgPT09IFwiZGV2ZWxvcG1lbnRcIiAmJiBjb21wb25lbnRUYWdnZXIoKV0uZmlsdGVyKEJvb2xlYW4pLFxuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHtcbiAgICAgIFwiQFwiOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4vc3JjXCIpLFxuICAgIH0sXG4gIH0sXG4gIGJ1aWxkOiB7XG4gICAgdGFyZ2V0OiBcImVzMjAyMFwiLFxuICAgIGNzc0NvZGVTcGxpdDogdHJ1ZSxcbiAgICBzb3VyY2VtYXA6IGZhbHNlLFxuICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgIG91dHB1dDoge1xuICAgICAgICAvLyBTcGxpdCBoZWF2eSB2ZW5kb3IgZGVwcyBpbnRvIHRoZWlyIG93biBsb25nLWNhY2hlYWJsZSBjaHVua3MuXG4gICAgICAgIC8vIEZ1bmN0aW9uIGZvcm0gc28gdGhlIGxhcmdlIEByYWRpeC11aS8qIHNldCBpcyBzcGxpdCBvZmYgdGhlIGNyaXRpY2FsIHBhdGguXG4gICAgICAgIG1hbnVhbENodW5rcyhpZCkge1xuICAgICAgICAgIGlmICghaWQuaW5jbHVkZXMoXCJub2RlX21vZHVsZXNcIikpIHJldHVybjtcbiAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoXCJAcmFkaXgtdWlcIikpIHJldHVybiBcInJhZGl4LXVpXCI7XG4gICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKFwiQHN1cGFiYXNlXCIpKSByZXR1cm4gXCJzdXBhYmFzZVwiO1xuICAgICAgICAgIGlmIChpZC5pbmNsdWRlcyhcIkB0YW5zdGFja1wiKSkgcmV0dXJuIFwicXVlcnlcIjtcbiAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoXCJsdWNpZGUtcmVhY3RcIikpIHJldHVybiBcImljb25zXCI7XG4gICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKFwiaTE4bmV4dFwiKSkgcmV0dXJuIFwiaTE4blwiOyAvLyBpMThuZXh0ICsgcmVhY3QtaTE4bmV4dFxuICAgICAgICAgIGlmIChpZC5pbmNsdWRlcyhcInJlYWN0LXJvdXRlclwiKSkgcmV0dXJuIFwicmVhY3QtdmVuZG9yXCI7XG4gICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKFwiL3JlYWN0LWRvbS9cIikgfHwgaWQuaW5jbHVkZXMoXCIvcmVhY3QvXCIpIHx8IGlkLmluY2x1ZGVzKFwiL3NjaGVkdWxlci9cIikpIHJldHVybiBcInJlYWN0LXZlbmRvclwiO1xuICAgICAgICAgIGlmIChcbiAgICAgICAgICAgIGlkLmluY2x1ZGVzKFwidmF1bFwiKSB8fFxuICAgICAgICAgICAgaWQuaW5jbHVkZXMoXCJjbWRrXCIpIHx8XG4gICAgICAgICAgICBpZC5pbmNsdWRlcyhcInNvbm5lclwiKSB8fFxuICAgICAgICAgICAgaWQuaW5jbHVkZXMoXCJlbWJsYS1jYXJvdXNlbFwiKSB8fFxuICAgICAgICAgICAgaWQuaW5jbHVkZXMoXCJjbGFzcy12YXJpYW5jZS1hdXRob3JpdHlcIikgfHxcbiAgICAgICAgICAgIGlkLmluY2x1ZGVzKFwiL2Nsc3gvXCIpIHx8XG4gICAgICAgICAgICBpZC5pbmNsdWRlcyhcInRhaWx3aW5kLW1lcmdlXCIpXG4gICAgICAgICAgKVxuICAgICAgICAgICAgcmV0dXJuIFwidWktbWlzY1wiO1xuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9LFxufSkpO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUE0VCxTQUFTLG9CQUFvQjtBQUN6VixPQUFPLFdBQVc7QUFDbEIsT0FBTyxVQUFVO0FBQ2pCLFNBQVMsdUJBQXVCO0FBSGhDLElBQU0sbUNBQW1DO0FBTXpDLElBQU8sc0JBQVEsYUFBYSxDQUFDLEVBQUUsS0FBSyxPQUFPO0FBQUEsRUFDekMsUUFBUTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sS0FBSztBQUFBLE1BQ0gsU0FBUztBQUFBLElBQ1g7QUFBQSxFQUNGO0FBQUEsRUFDQSxTQUFTLENBQUMsTUFBTSxHQUFHLFNBQVMsaUJBQWlCLGdCQUFnQixDQUFDLEVBQUUsT0FBTyxPQUFPO0FBQUEsRUFDOUUsU0FBUztBQUFBLElBQ1AsT0FBTztBQUFBLE1BQ0wsS0FBSyxLQUFLLFFBQVEsa0NBQVcsT0FBTztBQUFBLElBQ3RDO0FBQUEsRUFDRjtBQUFBLEVBQ0EsT0FBTztBQUFBLElBQ0wsUUFBUTtBQUFBLElBQ1IsY0FBYztBQUFBLElBQ2QsV0FBVztBQUFBLElBQ1gsZUFBZTtBQUFBLE1BQ2IsUUFBUTtBQUFBO0FBQUE7QUFBQSxRQUdOLGFBQWEsSUFBSTtBQUNmLGNBQUksQ0FBQyxHQUFHLFNBQVMsY0FBYyxFQUFHO0FBQ2xDLGNBQUksR0FBRyxTQUFTLFdBQVcsRUFBRyxRQUFPO0FBQ3JDLGNBQUksR0FBRyxTQUFTLFdBQVcsRUFBRyxRQUFPO0FBQ3JDLGNBQUksR0FBRyxTQUFTLFdBQVcsRUFBRyxRQUFPO0FBQ3JDLGNBQUksR0FBRyxTQUFTLGNBQWMsRUFBRyxRQUFPO0FBQ3hDLGNBQUksR0FBRyxTQUFTLFNBQVMsRUFBRyxRQUFPO0FBQ25DLGNBQUksR0FBRyxTQUFTLGNBQWMsRUFBRyxRQUFPO0FBQ3hDLGNBQUksR0FBRyxTQUFTLGFBQWEsS0FBSyxHQUFHLFNBQVMsU0FBUyxLQUFLLEdBQUcsU0FBUyxhQUFhLEVBQUcsUUFBTztBQUMvRixjQUNFLEdBQUcsU0FBUyxNQUFNLEtBQ2xCLEdBQUcsU0FBUyxNQUFNLEtBQ2xCLEdBQUcsU0FBUyxRQUFRLEtBQ3BCLEdBQUcsU0FBUyxnQkFBZ0IsS0FDNUIsR0FBRyxTQUFTLDBCQUEwQixLQUN0QyxHQUFHLFNBQVMsUUFBUSxLQUNwQixHQUFHLFNBQVMsZ0JBQWdCO0FBRTVCLG1CQUFPO0FBQUEsUUFDWDtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNGLEVBQUU7IiwKICAibmFtZXMiOiBbXQp9Cg==
