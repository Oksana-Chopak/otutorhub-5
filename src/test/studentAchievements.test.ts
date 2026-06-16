import { describe, it, expect } from "vitest";
import {
  maxConsecutiveWeeks,
  computeStudentAchievements,
  STUDENT_ACHIEVEMENT_DEFS,
} from "@/lib/studentAchievements";

// 2026-01-05 is a Monday.
const mon = (offsetWeeks: number) => new Date(2026, 0, 5 + offsetWeeks * 7);

describe("maxConsecutiveWeeks", () => {
  it("0 for no dates", () => {
    expect(maxConsecutiveWeeks([])).toBe(0);
  });
  it("1 for a single date", () => {
    expect(maxConsecutiveWeeks([mon(0)])).toBe(1);
  });
  it("collapses dates in the same week to 1", () => {
    expect(maxConsecutiveWeeks([new Date(2026, 0, 5), new Date(2026, 0, 7), new Date(2026, 0, 11)])).toBe(1);
  });
  it("counts 4 consecutive weeks", () => {
    expect(maxConsecutiveWeeks([mon(0), mon(1), mon(2), mon(3)])).toBe(4);
  });
  it("resets the run on a gap", () => {
    expect(maxConsecutiveWeeks([mon(0), mon(2), mon(3)])).toBe(2);
  });
  it("is order-independent", () => {
    expect(maxConsecutiveWeeks([mon(3), mon(0), mon(2), mon(1)])).toBe(4);
  });
});

describe("computeStudentAchievements", () => {
  const byKey = (stats: Parameters<typeof computeStudentAchievements>[0]) =>
    Object.fromEntries(computeStudentAchievements(stats).map((a) => [a.def.key, a]));

  it("first_lesson is binary on completed lessons", () => {
    expect(byKey({ completedLessons: 0, lessonsWithHomework: 0, earlyBirdLessons: 0, maxConsecutiveWeeks: 0 }).first_lesson.earned).toBe(false);
    expect(byKey({ completedLessons: 1, lessonsWithHomework: 0, earlyBirdLessons: 0, maxConsecutiveWeeks: 0 }).first_lesson.earned).toBe(true);
  });

  it("ten/fifty lessons report threshold + progress", () => {
    const a = byKey({ completedLessons: 10, lessonsWithHomework: 0, earlyBirdLessons: 0, maxConsecutiveWeeks: 1 });
    expect(a.ten_lessons.earned).toBe(true);
    expect(a.ten_lessons.current).toBe(10);
    expect(a.ten_lessons.target).toBe(10);
    expect(a.fifty_lessons.earned).toBe(false);
    expect(a.fifty_lessons.current).toBe(10);
    expect(a.fifty_lessons.target).toBe(50);
  });

  it("week_streak needs 4 consecutive weeks", () => {
    expect(byKey({ completedLessons: 4, lessonsWithHomework: 0, earlyBirdLessons: 0, maxConsecutiveWeeks: 3 }).week_streak.earned).toBe(false);
    expect(byKey({ completedLessons: 4, lessonsWithHomework: 0, earlyBirdLessons: 0, maxConsecutiveWeeks: 4 }).week_streak.earned).toBe(true);
  });

  it("first_homework + early_bird are binary", () => {
    const a = byKey({ completedLessons: 0, lessonsWithHomework: 1, earlyBirdLessons: 1, maxConsecutiveWeeks: 0 });
    expect(a.first_homework.earned).toBe(true);
    expect(a.early_bird.earned).toBe(true);
  });

  it("homework10 reports threshold + progress on assigned homework", () => {
    const a = byKey({ completedLessons: 0, lessonsWithHomework: 10, earlyBirdLessons: 0, maxConsecutiveWeeks: 0 });
    expect(a.homework10.earned).toBe(true);
    expect(a.homework10.current).toBe(10);
    expect(a.homework10.target).toBe(10);
    const b = byKey({ completedLessons: 0, lessonsWithHomework: 7, earlyBirdLessons: 0, maxConsecutiveWeeks: 0 });
    expect(b.homework10.earned).toBe(false);
    expect(b.homework10.current).toBe(7);
  });

  it("every def carries a teal or gold tier", () => {
    for (const def of Object.values(STUDENT_ACHIEVEMENT_DEFS)) {
      expect(["teal", "gold"]).toContain(def.tier);
    }
  });

  it("covers exactly the 8 catalog achievements", () => {
    expect(Object.keys(STUDENT_ACHIEVEMENT_DEFS)).toHaveLength(8);
  });

  it("scholar is a gold meta badge that tracks the teal set", () => {
    const tealCount = Object.values(STUDENT_ACHIEVEMENT_DEFS).filter(
      (d) => d.tier === "teal",
    ).length;
    expect(STUDENT_ACHIEVEMENT_DEFS.scholar.tier).toBe("gold");

    // No teal badge earned → scholar locked, progress 0 / tealCount.
    const none = byKey({ completedLessons: 0, lessonsWithHomework: 0, earlyBirdLessons: 0, maxConsecutiveWeeks: 0 });
    expect(none.scholar.earned).toBe(false);
    expect(none.scholar.current).toBe(0);
    expect(none.scholar.target).toBe(tealCount);

    // All teal thresholds met → scholar earned. Highest teal target is the
    // homework10/ten_lessons threshold (10) plus a 4-week streak + early bird.
    const all = byKey({ completedLessons: 10, lessonsWithHomework: 10, earlyBirdLessons: 1, maxConsecutiveWeeks: 4 });
    expect(all.scholar.earned).toBe(true);
    expect(all.scholar.current).toBe(tealCount);
    expect(all.scholar.target).toBe(tealCount);

    // Partial progress: only first_lesson + first_homework earned.
    const partial = byKey({ completedLessons: 1, lessonsWithHomework: 1, earlyBirdLessons: 0, maxConsecutiveWeeks: 1 });
    expect(partial.scholar.earned).toBe(false);
    expect(partial.scholar.current).toBe(2);
  });
});
