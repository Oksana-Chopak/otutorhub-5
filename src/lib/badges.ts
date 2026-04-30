// Badge definitions for the gamification system
export interface BadgeDef {
  key: string;
  emoji: string;
  name: string;
  description: string;
}

export const BADGE_DEFS: Record<string, BadgeDef> = {
  first_lesson: {
    key: "first_lesson",
    emoji: "🎯",
    name: "Перший урок",
    description: "Провів перший урок в застосунку",
  },
  no_debts: {
    key: "no_debts",
    emoji: "💸",
    name: "Без боргів",
    description: "Всі учні оплатили цього місяця",
  },
  streak_7: {
    key: "streak_7",
    emoji: "🔥",
    name: "7 днів поспіль",
    description: "Уроки 7 днів підряд",
  },
  schedule_maniac: {
    key: "schedule_maniac",
    emoji: "📅",
    name: "Розклад-маніяк",
    description: "Заплановано 20+ уроків на місяць",
  },
  first_referral: {
    key: "first_referral",
    emoji: "🤝",
    name: "Перший реферал",
    description: "Привів першого друга",
  },
  top_tutor: {
    key: "top_tutor",
    emoji: "👑",
    name: "Топ-репетитор",
    description: "В топ-10 за активністю місяця",
  },
};

export const ALL_BADGES = Object.values(BADGE_DEFS);
