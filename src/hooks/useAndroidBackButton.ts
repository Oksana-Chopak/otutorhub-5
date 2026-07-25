import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { App as CapApp } from "@capacitor/app";
import { toast } from "sonner";
import i18n from "@/i18n";
import { isNativeApp } from "@/lib/platform";

/**
 * BUG-4 (2026-07-25): hardware back-button handling for the Android build.
 * Without a listener, Capacitor's default finishes the Activity — «Назад»
 * from the dashboard (or from an open bottom sheet) instantly killed the app.
 *
 * Behaviour:
 * 1. An open overlay (Radix Dialog/AlertDialog/Sheet/Popover/Select, vaul
 *    Drawer) → close it by dispatching Escape (all of them close on Escape).
 * 2. A "root" screen or empty history → double-press-to-exit with a hint
 *    toast (standard Android pattern), so a stray tap never quits the app.
 * 3. Anywhere else → normal history back.
 */
const ROOT_PATHS = new Set(["/", "/auth", "/dashboard", "/student", "/onboarding"]);
const EXIT_WINDOW_MS = 2000;

function hasOpenOverlay(): boolean {
  return !!document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], ' +
      "[data-vaul-drawer][data-state=\"open\"], [data-radix-popper-content-wrapper]",
  );
}

export function useAndroidBackButton() {
  const location = useLocation();
  const navigate = useNavigate();
  const lastBackAt = useRef(0);
  // Keep latest values readable from the stable listener without re-subscribing.
  const latest = useRef({ pathname: location.pathname, navigate });
  latest.current = { pathname: location.pathname, navigate };

  useEffect(() => {
    if (!isNativeApp()) return;

    const sub = CapApp.addListener("backButton", ({ canGoBack }) => {
      if (hasOpenOverlay()) {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }),
        );
        return;
      }

      const { pathname } = latest.current;
      const atRoot = ROOT_PATHS.has(pathname) || !canGoBack;
      if (atRoot) {
        const now = Date.now();
        if (now - lastBackAt.current < EXIT_WINDOW_MS) {
          void CapApp.exitApp();
        } else {
          lastBackAt.current = now;
          toast(i18n.t("native.backExitHint"), { duration: EXIT_WINDOW_MS });
        }
        return;
      }

      window.history.back();
    });

    return () => {
      void sub.then((s) => s.remove());
    };
  }, []);
}
