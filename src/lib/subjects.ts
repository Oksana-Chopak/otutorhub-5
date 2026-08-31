import i18n from "@/i18n";
import { lazyArray } from "@/lib/lazyI18n";

// Канонічний список предметів школи. Зберігаються як рядки в tutor_details.subjects.
// A1: лінивий масив — переклад у момент звернення, не імпорту (див. lazyI18n.ts).
export const SUBJECT_OPTIONS: readonly string[] = lazyArray(() => [
  i18n.t("subjects.mathGerman"),
  i18n.t("subjects.mathPolish"),
  i18n.t("subjects.english"),
  i18n.t("subjects.swedish"),
  i18n.t("subjects.polish"),
  i18n.t("subjects.german"),
]);

export type Subject = string;
