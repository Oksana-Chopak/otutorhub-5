/**
 * H2: підказки предметів для швидкого додавання учня. Раніше — 10 українських
 * літералів у MyStudentsPage; шведський репетитор бачив «Фізика» у своєму UI.
 * Тепер ключі, підписи — `subjectCatalog.<key>` у трьох мовах. Це ЛИШЕ підказки
 * автодоповнення; що людина впише — те й зберігається (канонізація предметів
 * відбувається тригером при записі, див. CLAUDE.md → SUBJECTS).
 */
export const SUBJECT_SUGGESTIONS = [
  "english", "math", "ukrainian", "physics", "chemistry",
  "german", "biology", "cs", "history", "polish",
] as const;
