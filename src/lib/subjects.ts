// Канонічний список предметів школи. Зберігаються як рядки в tutor_details.subjects.
export const SUBJECT_OPTIONS = [
  i18n.t("subjects.mathGerman"),
  i18n.t("subjects.mathPolish"),
  i18n.t("subjects.english"),
  i18n.t("subjects.swedish"),
  i18n.t("subjects.polish"),
  i18n.t("subjects.german"),
] as const;

export type Subject = typeof SUBJECT_OPTIONS[number];
