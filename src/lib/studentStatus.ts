import i18n from "@/i18n";
import { formatPrice } from "@/lib/currency";

/**
 * Shared helper for student status across pages.
 *
 * 🟡 debt — has unpaid completed lessons
 * ⚪ new  — never had a lesson
 * 🟢 ok   — all paid
 *
 * Note: the "inactive" status was removed by the owner's decision — a student is
 * never shown as inactive based on time since the last lesson.
 */
export type StudentStatus = "ok" | "debt" | "new";

export interface StudentStatusInput {
  unpaid_count: number;
  unpaid_total: number;
  last_lesson_at: string | null;
  currency?: string | null;
  /** M3: {"UAH": 800, "SEK": 200} з get_people_aggregates — правда замість однієї підписаної суми. */
  unpaid_by_currency?: Record<string, number> | null;
}

/**
 * M3: сума боргу текстом. Якщо валют кілька — «800 ₴ + 200 kr», а не одна
 * цифра під випадковою валютою. Якщо jsonb ще не прийшов (стара БД) —
 * поводимось як раніше.
 */
function debtAmountText(s: StudentStatusInput): string {
  const byCur = s.unpaid_by_currency && typeof s.unpaid_by_currency === "object"
    ? Object.entries(s.unpaid_by_currency).filter(([, v]) => Number(v) > 0).sort((a, b) => Math.abs(Number(b[1])) - Math.abs(Number(a[1])))
    : [];
  if (byCur.length > 0) return byCur.map(([c, v]) => formatPrice(Number(v), c)).join(" + ");
  return formatPrice(s.unpaid_total, s.currency ?? "UAH");
}

export function computeStudentStatus(
  s: StudentStatusInput
): { status: StudentStatus; label: string } {
  if (s.unpaid_count > 0) {
    return {
      status: "debt",
      label: i18n.t("studentStatus.debt", { amount: debtAmountText(s), count: s.unpaid_count }),
    };
  }
  if (!s.last_lesson_at) {
    return { status: "new", label: i18n.t("studentStatus.noLessons") };
  }
  return { status: "ok", label: i18n.t("studentStatus.ok") };
}

export const studentStatusDotClass: Record<StudentStatus, string> = {
  ok: "bg-success",
  debt: "bg-warning",
  new: "bg-muted-foreground/40",
};
