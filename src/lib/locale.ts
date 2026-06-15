import i18n from "@/i18n";

/**
 * BCP-47 locale for Intl / toLocale* formatting, derived from the active UI
 * language. Use this instead of a hardcoded "uk-UA" so Swedish/English users
 * see dates and numbers in their own locale.
 */
export function getLocale(): string {
  const lang = (i18n.language || "uk").split("-")[0];
  return lang === "sv" ? "sv-SE" : lang === "en" ? "en-GB" : "uk-UA";
}
