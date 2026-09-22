/// <reference types="vite/client" />

/** Хеш коміту, вшитий у збірку (vite.config.ts → buildStamp). «unknown» — якщо збирали без git. */
declare const __BUILD_SHA__: string;
/** Хеш ДЖЕРЕЛ збірки (scripts/source-stamp.mjs) — не залежить від git; ним робот звіряє прод із main. */
declare const __BUILD_STAMP__: string;
