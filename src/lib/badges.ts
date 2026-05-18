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
    name: i18n.t("badges.firstLesson"),
    description: i18n.t("badges.firstLessonDesc"),
  },
  no_debts: {
    key: "no_debts",
    emoji: "💸",
    name: i18n.t("badges.noDebts"),
    description: i18n.t("badges.noDebtsDesc"),
  },
  streak_7: {
    key: "streak_7",
    emoji: "🔥",
    name: i18n.t("badges.streak7"),
    description: i18n.t("badges.streak7Desc"),
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
