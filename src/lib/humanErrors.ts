/**
 * Сирий текст бази людині нічого не каже (13.11, робот «кожна кнопка»).
 *
 * У застосунку ~30 місць показують `error.message` як є: «duplicate key value violates unique
 * constraint …», «new row violates row-level security policy …». Власниця бачила це двічі за
 * день. Тут одна сітка на всі повідомлення про помилку: відомі технічні тексти замінюються
 * людськими — що сталося і що робити. Невідомий текст лишається як є (краще чесний сирий
 * текст, ніж вигадане пояснення).
 */
import i18n from "@/i18n";
import { toast } from "sonner";

const RULES: [RegExp, string][] = [
  [/unique_visible_slot/i, "humanErrors.slotTaken"],
  [/duplicate key value|23505/i, "humanErrors.duplicate"],
  [/row-level security|permission denied|42501|insufficient_privilege/i, "humanErrors.noAccess"],
  [/violates foreign key|23503/i, "humanErrors.linked"],
  [/violates not-null|23502|violates check constraint|23514/i, "humanErrors.invalid"],
  [/jwt expired|invalid jwt|refresh token/i, "humanErrors.session"],
  [/failed to fetch|networkerror|load failed|network request failed/i, "humanErrors.network"],
];

export function humanizeError(text: unknown): unknown {
  if (typeof text !== "string" || text.length < 8) return text;
  for (const [re, key] of RULES) if (re.test(text)) return i18n.t(key);
  return text;
}

/** Обгортає `toast.error` один раз на старті застосунку. */
export function installHumanErrors(): void {
  const orig = toast.error.bind(toast);
  (toast as { error: typeof toast.error }).error = ((message: unknown, data?: { description?: unknown }) => {
    const m = humanizeError(message);
    const d = data && typeof data.description === "string" ? { ...data, description: humanizeError(data.description) } : data;
    // однаковий заголовок і опис після заміни — опис зайвий
    const dd = d && (d as { description?: unknown }).description === m ? { ...d, description: undefined } : d;
    return orig(m as Parameters<typeof toast.error>[0], dd as Parameters<typeof toast.error>[1]);
  }) as typeof toast.error;
}
