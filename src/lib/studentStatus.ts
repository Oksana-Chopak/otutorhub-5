import i18n from "@/i18n";

/**
 * Shared helper for student "traffic light" status across pages.
 *
 * 🟢 ok       — all paid, recent activity
 * 🟡 debt     — has unpaid completed lessons
 * 🔴 inactive — no activity for >21 days
 * ⚪ new      — never had a lesson
 */
export type StudentStatus = "ok" | "debt" | "inactive" | "new";

export interface StudentStatusInput {
  unpaid_count: number;
  unpaid_total: number;
  last_lesson_at: string | null;
}

export const INACTIVE_DAYS = 21;

export function computeStudentStatus(
  s: StudentStatusInput
): { status: StudentStatus; label: string } {
  if (s.unpaid_count > 0) {
    return {
      status: "debt",
      label: i18n.t("studentStatus.debt", { amount: `${s.unpaid_total} ₴`, count: s.unpaid_count }),
    };
  }
  if (!s.last_lesson_at) {
    return { status: "new", label: i18n.t("studentStatus.noLessons") };
  }
  const ageMs = Date.now() - new Date(s.last_lesson_at).getTime();
  if (ageMs > INACTIVE_DAYS * 24 * 60 * 60 * 1000) {
    const days = Math.round(ageMs / (24 * 60 * 60 * 1000));
    return { status: "inactive", label: i18n.t("studentStatus.inactive", { days }) };
  }
  return { status: "ok", label: i18n.t("studentStatus.ok") };
}

export const studentStatusDotClass: Record<StudentStatus, string> = {
  ok: "bg-success",
  debt: "bg-warning",
  inactive: "bg-destructive",
  new: "bg-muted-foreground/40",
};
