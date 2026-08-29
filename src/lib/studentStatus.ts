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
}

export function computeStudentStatus(
  s: StudentStatusInput
): { status: StudentStatus; label: string } {
  if (s.unpaid_count > 0) {
    return {
      status: "debt",
      label: i18n.t("studentStatus.debt", { amount: formatPrice(s.unpaid_total, s.currency ?? "UAH"), count: s.unpaid_count }),
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
