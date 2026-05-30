export type RewardTheme = "fruits" | "stars" | "medals" | "artifacts" | "nature";

export const REWARD_THEMES: Record<RewardTheme, string[]> = {
  fruits:    ["🍎", "🍊", "🍋", "🍇", "🍓", "🍑", "🥝", "🍒", "🍉", "🫐"],
  stars:     ["⭐", "🌟", "✨", "💫", "🌠", "☀️", "🌙", "💥", "🌟", "⚡"],
  medals:    ["🏅", "🥇", "🥈", "🥉", "🏆", "🎖️", "🎗️", "🎀", "🏵️", "🎯"],
  artifacts: ["🔮", "⚡", "🗝️", "🔑", "💎", "🪙", "🧿", "🪄", "🔭", "🧪"],
  nature:    ["🌿", "🌸", "🌺", "🍀", "🌻", "🦋", "🌈", "❄️", "🌊", "🌴"],
};

export const THEME_KEYS: RewardTheme[] = ["fruits", "stars", "medals", "artifacts", "nature"];

export function getRandomEmoji(theme: RewardTheme): string {
  const emojis = REWARD_THEMES[theme] ?? REWARD_THEMES.fruits;
  return emojis[Math.floor(Math.random() * emojis.length)];
}

// Level definitions for students
export interface StudentLevel {
  key: string;
  min: number;
  max: number;
}

export const STUDENT_LEVELS: StudentLevel[] = [
  { key: "novice",  min: 0,  max: 4  },
  { key: "student", min: 5,  max: 14 },
  { key: "expert",  min: 15, max: 29 },
  { key: "master",  min: 30, max: 59 },
  { key: "legend",  min: 60, max: Infinity },
];

export function getStudentLevel(completedCount: number): StudentLevel {
  return [...STUDENT_LEVELS].reverse().find((l) => completedCount >= l.min) ?? STUDENT_LEVELS[0];
}

export function getLevelProgress(completedCount: number): { level: StudentLevel; next: StudentLevel | null; progress: number } {
  const level = getStudentLevel(completedCount);
  const idx = STUDENT_LEVELS.indexOf(level);
  const next = STUDENT_LEVELS[idx + 1] ?? null;
  const progress = next
    ? Math.min(100, Math.round(((completedCount - level.min) / (next.min - level.min)) * 100))
    : 100;
  return { level, next, progress };
}
