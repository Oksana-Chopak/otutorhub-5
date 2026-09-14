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
      /* 14.09, скарга першого живого користувача: «при регистрации выбирал
         английский… а перевело на сайт и снова украинский».
         Причина: лист підтвердження відкривають з ПОШТИ, а це часто інший
         браузер (застосунок пошти має власний webview). Там localStorage
         порожній, тож інтерфейс стартував з українською — і хук синхронізації
         потім записував цю українську в profiles.preferred_language як «вибір
         людини». Тобто англійська не просто губилась на екрані: вона
         затиралась НАЗАВЖДИ, разом із мовою серверних нагадувань.
         Тепер мова їде в самому посиланні (?lng=…), і будь-який лист, який ми
         шлемо, відкривається тією мовою, яку людина обрала. Параметр
         одразу лягає в localStorage, тож далі все як раніше. */
      const fromUrl = (() => {
        if (typeof window === "undefined") return null;
        try {
          const v = new URLSearchParams(window.location.search).get("lng");
          return v && ["uk", "en", "sv"].includes(v) ? v : null;
        } catch { return null; }
      })();
      if (fromUrl) {
        try { localStorage.setItem("otutorhub_lang", fromUrl); } catch { /* приватний режим */ }
        return fromUrl;
      }
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
