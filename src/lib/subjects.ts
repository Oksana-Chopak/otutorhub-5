// Канонічний список предметів школи. Зберігаються як рядки в tutor_details.subjects.
export const SUBJECT_OPTIONS = [
  "Математика (німецька програма)",
  "Математика (польська програма)",
  "Англійська мова",
  "Шведська мова",
  "Польська мова",
  "Німецька мова",
] as const;

export type Subject = typeof SUBJECT_OPTIONS[number];
