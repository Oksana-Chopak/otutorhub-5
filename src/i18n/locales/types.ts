import type { uk } from "./uk";

// Base shape derived from the Ukrainian locale (the source of truth for keys).
// Different languages use different CLDR plural categories (uk: one/few/many,
// en: one/other), so a locale may legitimately use a different set of plural
// suffix keys than uk. DeepPartialLocale makes every uk key optional AND lets a
// locale add its own plural-suffix variants (e.g. `${base}_other`) as strings.
// Real (non-plural) key types are still checked; completeness of non-plural keys
// is enforced by scripts/check-i18n.mjs (which ignores plural suffixes).
//
// NOTE: these types live in their own file (not uk.ts) so the i18n gate's
// text scanner over uk.ts never mistakes the type's generic identifiers for
// translation keys.
type DeepPartialLocale<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? DeepPartialLocale<T[K]>
      : T[K];
} & {
  [key: `${string}_one`]: string;
  [key: `${string}_two`]: string;
  [key: `${string}_few`]: string;
  [key: `${string}_many`]: string;
  [key: `${string}_other`]: string;
};

export type Translations = typeof uk;
export type LocaleTranslations = DeepPartialLocale<typeof uk>;
