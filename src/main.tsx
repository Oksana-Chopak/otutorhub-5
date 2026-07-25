import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./i18n";
import { isNativeApp } from "@/lib/platform";

// BUG-7 (2026-07-25), native only: cap the viewport scale so iOS WKWebView
// doesn't auto-zoom on inputs < 16px (the app's DS uses 15px inputs). Web is
// untouched — pinch-zoom stays available in browsers for accessibility.
if (isNativeApp()) {
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute(
      "content",
      "width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0",
    );
}

createRoot(document.getElementById("root")!).render(<App />);
