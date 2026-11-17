import { uk as dfUk, sv as dfSv, enGB as dfEn } from "date-fns/locale";
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

/** Локаль date-fns за мовою застосунку (17.11: дати в запитах на перенесення й заявках були
    завжди українською, навіть в англійському та шведському інтерфейсі). */
export function dateFnsLocale() {
  const lang = (i18n.language || "uk").split("-")[0];
  return lang === "sv" ? dfSv : lang === "en" ? dfEn : dfUk;
}
