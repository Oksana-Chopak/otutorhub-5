import { Browser } from "@capacitor/browser";
import { isNativeApp } from "@/lib/platform";

/**
 * BUG-6 (2026-07-25): open an external URL safely on every platform.
 * In the native WebView a raw `window.open`/`target="_blank"` can navigate the
 * app's WebView away with no back affordance (the user is trapped) — external
 * links must go through the system in-app browser sheet instead.
 * On web this stays a normal new tab.
 */
export async function openExternal(url: string): Promise<void> {
  if (!url) return;
  if (isNativeApp()) {
    await Browser.open({ url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
