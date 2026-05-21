import { useCallback, useMemo, useState } from "react";

export type LessonStatusFilter = "all" | "scheduled" | "completed" | "cancelled";
export type LessonSourceFilter = "all" | "hub" | "independent";
export type LessonPeriodFilter = "all" | "upcoming" | "past" | "month" | "week";

export interface ScheduleFilterableLesson {
  status: string;
  tutor_id: string;
  student_id: string;
  source?: string | null;
  starts_at: string;
}

/**
 * Centralized state + derivations for SchedulePage filters.
 * Keeps the page component free from duplicated filter logic between
 * the desktop inline panel and the mobile bottom sheet.
 */
export function useScheduleFilters() {
  const [status, setStatus] = useState<LessonStatusFilter>("all");
  const [tutor, setTutor] = useState<string>("all");
  const [student, setStudent] = useState<string>("all");
  const [source, setSource] = useState<LessonSourceFilter>("all");
  const [period, setPeriod] = useState<LessonPeriodFilter>("all");

  const activeCount =
    (status !== "all" ? 1 : 0) +
    (tutor !== "all" ? 1 : 0) +
    (student !== "all" ? 1 : 0) +
    (source !== "all" ? 1 : 0) +
    (period !== "all" ? 1 : 0);

  const isActive = activeCount > 0;

  const reset = useCallback(() => {
    setStatus("all");
    setTutor("all");
    setStudent("all");
    setSource("all");
    setPeriod("all");
  }, []);

  const apply = useCallback(
    <T extends ScheduleFilterableLesson>(lessons: T[]): T[] => {
      const now = Date.now();
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const weekStart = new Date();
      const day = (weekStart.getDay() + 6) % 7;
      weekStart.setDate(weekStart.getDate() - day);
      weekStart.setHours(0, 0, 0, 0);

      return lessons.filter((l) => {
        if (status !== "all" && l.status !== status) return false;
        if (tutor !== "all" && l.tutor_id !== tutor) return false;
        if (student !== "all" && l.student_id !== student) return false;
        if (source !== "all" && (l.source ?? "hub") !== source) return false;
        const ts = new Date(l.starts_at).getTime();
        if (period === "upcoming" && ts < now - 60 * 60 * 1000) return false;
        if (period === "past" && ts >= now) return false;
        if (period === "month" && ts < monthStart.getTime()) return false;
        if (period === "week" && ts < weekStart.getTime()) return false;
        return true;
      });
    },
    [status, tutor, student, source, period],
  );

  return useMemo(
    () => ({
      status,
      setStatus,
      tutor,
      setTutor,
      student,
      setStudent,
      source,
      setSource,
      period,
      setPeriod,
      activeCount,
      isActive,
      reset,
      apply,
    }),
    [status, tutor, student, source, period, activeCount, isActive, reset, apply],
  );
}

export type ScheduleFiltersState = ReturnType<typeof useScheduleFilters>;
