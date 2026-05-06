/**
 * URL safety helpers.
 *
 * Prevents stored XSS via `javascript:`/`data:`/`vbscript:` URIs that would
 * otherwise execute when rendered in <a href> elements.
 */

/**
 * Normalize a user-entered URL to a safe https/http URL, or return null if
 * it cannot be safely accepted. Bare hostnames are upgraded to https://.
 */
export function sanitizeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = String(value).trim();
  if (!v) return null;
  // Reject anything containing a non-http(s) scheme prefix.
  // Match leading scheme like "javascript:", "data:", "vbscript:", "file:", etc.
  const schemeMatch = v.match(/^([a-zA-Z][a-zA-Z0-9+.\-]*):/);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "http" && scheme !== "https") return null;
    return v;
  }
  // No scheme — assume https://
  return `https://${v}`;
}

/** Returns the URL if it is a safe http(s) URL, otherwise "#". */
export function safeHref(value: string | null | undefined): string {
  if (!value) return "#";
  return /^https?:\/\//i.test(String(value).trim()) ? String(value).trim() : "#";
}
