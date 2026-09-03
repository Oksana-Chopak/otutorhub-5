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

// H2 (аудит 02.09): емодзі предмета — за i18n-КЛЮЧЕМ, не за українським рядком.
// Дві копії мапи (StudentOnboarding, LandingFindTutorQuizDialog) ключувались
// укр-літералами: для en/sv емодзі не знаходилось ніколи, а укр-ключ
// «Математика (німецька програма)» не збігався навіть із власним перекладом
// «Математика (нім. програма)» — тобто не працювало й українською.
const SUBJECT_EMOJI_BY_KEY: Record<string, string> = {
  mathGerman: "🧮", mathPolish: "🧮", english: "🇬🇧", swedish: "🇸🇪", polish: "🇵🇱", german: "🇩🇪",
};
const SUBJECT_KEYS = Object.keys(SUBJECT_EMOJI_BY_KEY);

/** Емодзі для назви предмета БУДЬ-ЯКОЮ поточною мовою (порівнюємо з перекладом ключа). */
export function subjectEmoji(label: string): string {
  const norm = label.trim().toLowerCase();
  for (const k of SUBJECT_KEYS) {
    if (i18n.t(`subjects.${k}`).trim().toLowerCase() === norm) return SUBJECT_EMOJI_BY_KEY[k];
  }
  return "📖";
}
