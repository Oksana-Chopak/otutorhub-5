import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { uk } from "./locales/uk";
import { en } from "./locales/en";
import { sv } from "./locales/sv";

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      uk: { translation: uk },
      en: { translation: en },
      sv: { translation: sv },
    },
    fallbackLng: "uk",
    supportedLngs: ["uk", "en", "sv"],
    interpolation: { escapeValue: false },
    lng: (() => {
      // Use stored preference, otherwise default to Ukrainian regardless of browser locale
      const stored = typeof localStorage !== "undefined"
        ? localStorage.getItem("otutorhub_lang")
        : null;
      return stored && ["uk", "en", "sv"].includes(stored) ? stored : "uk";
    })(),
    detection: {
      order: ["localStorage"],
      lookupLocalStorage: "otutorhub_lang",
      caches: ["localStorage"],
    },
  });

export default i18n;
