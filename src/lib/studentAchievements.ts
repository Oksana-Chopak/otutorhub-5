/**
 * Student achievements catalog — mirrors the tutor BADGE_DEFS format.
 *
 * Unlike tutor badges (stored in the `tutor_badges` table), student achievements
 * are COMPUTED CLIENT-SIDE from data the student can already read (their own
 * lessons + assigned homework) — no backend/table is required. Each definition
 * carries an `evaluate(stats)` accrual function returning earned + progress.
 *
 * DATA NOTE on `first_homework` (📚): the source table only stores the
 * tutor-*assigned* homework text (`lesson_details.homework`). There is NO
 * homework-submission signal in the schema (no submitted/done flag; attachments
 * are generic). Owner-confirmed (option A): this achievement is bound to
 * "received a first homework" (a lesson with non-empty assigned homework),
 * not literal "submitted".
 */

export interface StudentAchievementStats {
  /** Lessons with status 'completed' for this student. */
  completedLessons: number;
  /** Lessons (any status) that have non-empty assigned homework. */
  lessonsWithHomework: number;
  /** Completed lessons that started before 09:00 local time. */
  earlyBirdLessons: number;
  /** Longest run of consecutive ISO weeks each containing ≥1 completed lesson. */
  maxConsecutiveWeeks: number;
}

export interface StudentAchievementResult {
  earned: boolean;
  /** Current value toward the target (for a progress bar). */
  current: number;
  /** Target value; when 1 the achievement is binary (no progress bar shown). */
  target: number;
}

export interface StudentAchievementDef {
  key: string;
  emoji: string;
  /** i18n keys (resolved in the component so language switching works). */
  nameKey: string;
  descKey: string;
  evaluate: (s: StudentAchievementStats) => StudentAchievementResult;
}

const binary = (value: number): StudentAchievementResult => ({
  earned: value >= 1,
  current: Math.min(value, 1),
  target: 1,
});

const threshold = (value: number, target: number): StudentAchievementResult => ({
  earned: value >= target,
  current: Math.min(value, target),
  target,
});

export const STUDENT_ACHIEVEMENT_DEFS: Record<string, StudentAchievementDef> = {
  first_lesson: {
    key: "first_lesson",
    emoji: "🎯",
    nameKey: "studentAchievements.firstLesson",
    descKey: "studentAchievements.firstLessonDesc",
    evaluate: (s) => binary(s.completedLessons),
  },
  first_homework: {
    key: "first_homework",
    emoji: "📚",
    nameKey: "studentAchievements.firstHomework",
    descKey: "studentAchievements.firstHomeworkDesc",
    evaluate: (s) => binary(s.lessonsWithHomework),
  },
  ten_lessons: {
    key: "ten_lessons",
    emoji: "⭐",
    nameKey: "studentAchievements.tenLessons",
    descKey: "studentAchievements.tenLessonsDesc",
    evaluate: (s) => threshold(s.completedLessons, 10),
  },
  fifty_lessons: {
    key: "fifty_lessons",
    emoji: "🏆",
    nameKey: "studentAchievements.fiftyLessons",
    descKey: "studentAchievements.fiftyLessonsDesc",
    evaluate: (s) => threshold(s.completedLessons, 50),
  },
  week_streak: {
    key: "week_streak",
    emoji: "🔥",
    nameKey: "studentAchievements.weekStreak",
    descKey: "studentAchievements.weekStreakDesc",
    evaluate: (s) => threshold(s.maxConsecutiveWeeks, 4),
  },
  early_bird: {
    key: "early_bird",
    emoji: "🌅",
    nameKey: "studentAchievements.earlyBird",
    descKey: "studentAchievements.earlyBirdDesc",
    evaluate: (s) => binary(s.earlyBirdLessons),
  },
};

export const ALL_STUDENT_ACHIEVEMENTS = Object.values(STUDENT_ACHIEVEMENT_DEFS);

/**
 * Longest run of consecutive ISO weeks among the given dates. Each date is
 * collapsed to its week's Monday (local); a run continues while the next
 * distinct week's Monday is exactly 7 days later.
 */
export function maxConsecutiveWeeks(dates: Date[]): number {
  if (dates.length === 0) return 0;
  const DAY = 86_400_000;
  const mondays = new Set<number>();
  for (const d of dates) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    // getDay(): 0=Sun..6=Sat → days since Monday
    const sinceMonday = (day.getDay() + 6) % 7;
    const monday = day.getTime() - sinceMonday * DAY;
    mondays.add(monday);
  }
  const sorted = Array.from(mondays).sort((a, b) => a - b);
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] === 7 * DAY) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 1;
    }
  }
  return best;
}

export function computeStudentAchievements(stats: StudentAchievementStats) {
  return ALL_STUDENT_ACHIEVEMENTS.map((def) => ({ def, ...def.evaluate(stats) }));
}

export type StudentAchievementWithStatus = ReturnType<typeof computeStudentAchievements>[number];
