import i18n from "@/i18n";

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
    name: i18n.t("badgesExtra.scheduleManiac"),
    description: i18n.t("badgesExtra.scheduleManiacDesc"),
  },
  first_referral: {
    key: "first_referral",
    emoji: "🤝",
    name: i18n.t("badgesExtra.firstReferral"),
    description: i18n.t("badgesExtra.firstReferralDesc"),
  },
  top_tutor: {
    key: "top_tutor",
    emoji: "👑",
    name: i18n.t("badgesExtra.topTutor"),
    description: i18n.t("badgesExtra.topTutorDesc"),
  },
};

export const ALL_BADGES = Object.values(BADGE_DEFS);
