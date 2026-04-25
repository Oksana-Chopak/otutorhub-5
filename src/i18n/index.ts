import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { uk } from "./locales/uk";
import { en } from "./locales/en";

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      uk: { translation: uk },
      en: { translation: en },
    },
    fallbackLng: "uk",
    supportedLngs: ["uk", "en"],
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "otutorhub_lang",
      caches: ["localStorage"],
    },
  });

export default i18n;
