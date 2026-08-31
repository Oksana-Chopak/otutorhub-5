import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import resourcesToBackend from "i18next-resources-to-backend";

// A1: переклади (~585 kB min, 92% вхідного чанка) більше не в бандлі.
// Кожна мова — окремий чанк; вантажиться лише обрана (+uk як fallback для en/sv).
// Бізнес-причина: час до першого екрана на мобільному ~вдвічі менший.
const lazyLocales = resourcesToBackend(async (lng: string) => {
  const mod = (await import(`./locales/${lng}.ts`)) as Record<string, unknown>;
  return mod[lng] ?? mod.default;
});

export const i18nReady = i18n
  .use(LanguageDetector)
  .use(lazyLocales)
  .use(initReactI18next)
  .init({
    fallbackLng: "uk",
    supportedLngs: ["uk", "en", "sv"],
    interpolation: { escapeValue: false },
    // Компоненти чекають чанк мови через Suspense (fallback уже є в App).
    react: { useSuspense: true },
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

// C4 (WCAG 3.1.1, рівень A): мова документа слідує за мовою інтерфейсу —
// скрінрідер читає шведський текст шведською, а не українською фонетикою.
const syncDocumentLang = (l: string) => {
  if (typeof document !== "undefined") document.documentElement.lang = l;
};
i18n.on("languageChanged", syncDocumentLang);
void i18nReady.then(() => syncDocumentLang(i18n.resolvedLanguage ?? i18n.language ?? "uk"));

export default i18n;
