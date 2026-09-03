// Human-readable labels for tutor-referral-request enum values that come from the
// "find a tutor" quiz (preferred_level / preferred_times / preferred_days / for-whom).
// Without this, the manager's request cards show raw values like "advanced" or
// "weekend_evening".
//
// H2 (аудит 02.09): раніше підписи були українськими ЛІТЕРАЛАМИ в коді — менеджер
// зі шведським інтерфейсом бачив «Будні, вечір». Тепер це ключі i18n
// (`requestLabels.<value>`); невідоме значення — humanize-фолбек.
import i18n from "@/i18n";

const KNOWN = new Set([
  "beginner", "intermediate", "advanced",
  "weekday_morning", "weekday_day", "weekday_evening",
  "weekend_morning", "weekend_day", "weekend_evening", "flexible",
  "self", "child", "other",
]);

function humanize(v: string): string {
  return v.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Map one or more comma/space-separated enum values to a readable string. */
export function prettyRequestValue(v?: string | null): string {
  if (!v) return "";
  return v
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((part) => (KNOWN.has(part) ? i18n.t(`requestLabels.${part}`) : humanize(part)))
    .join(", ");
}
