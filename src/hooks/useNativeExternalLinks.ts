import { useEffect } from "react";
import { Browser } from "@capacitor/browser";
import { isNativeApp } from "@/lib/platform";

/**
 * BUG-6 (2026-07-25), part 2: in the native WebView, plain
 * `<a target="_blank">` anchors (chat attachments, Fireflies links, t.me,
 * lesson materials, …) can navigate the WebView away with no back button —
 * the user is trapped. One capture-phase listener routes EVERY external
 * http(s) anchor through the system in-app browser sheet instead, so the
 * ~12 existing anchor call sites don't each need editing (and future ones
 * are covered automatically). No-op on web.
 */
export function useNativeExternalLinks() {
  useEffect(() => {
    if (!isNativeApp()) return;

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.('a[target="_blank"]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.href;
      if (!href || !/^https?:/i.test(href)) return;
      e.preventDefault();
      e.stopPropagation();
      void Browser.open({ url: href });
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
}
