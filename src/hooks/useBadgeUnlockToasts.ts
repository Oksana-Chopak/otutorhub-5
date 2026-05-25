import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { BADGE_DEFS } from "@/lib/badges";
import type { TutorBadge } from "@/hooks/useTutorGamification";
import { useAuth } from "@/hooks/useAuth";
import { insertNotification } from "@/lib/notifications";
import i18n from "@/i18n";

const t = i18n.t.bind(i18n);

const STORAGE_KEY = "seen_badge_keys_v1";

/**
 * Detects newly-awarded badges between renders and fires an animated
 * "🎯 Новий бейдж: …" toast — like in mobile games.
 *
 * Uses localStorage to remember which badges the user has already seen,
 * so refreshing the page doesn't re-trigger toasts for old badges.
 */
export function useBadgeUnlockToasts(badges: TutorBadge[], loading: boolean) {
  const { user } = useAuth();
  const initialized = useRef(false);

  useEffect(() => {
    if (loading) return;

    let seen: Set<string>;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      seen = new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      seen = new Set();
    }

    // First render after a fresh login: just sync — never spam old badges.
    if (!initialized.current) {
      initialized.current = true;
      const allKeys = badges.map((b) => b.badge_key);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(allKeys));
      } catch {
        /* ignore */
      }
      return;
    }

    const newOnes = badges.filter((b) => !seen.has(b.badge_key));
    if (newOnes.length === 0) return;

    newOnes.forEach((b, i) => {
      const def = BADGE_DEFS[b.badge_key];
      const emoji = def?.emoji ?? "🏅";
      const name = def?.name ?? b.badge_key;
      const desc = def?.description;
      setTimeout(() => {
        toast.success(t("badgeUnlockToast.newBadge", { emoji, name }), {
          description: desc,
          duration: 6000,
          className: "animate-pop",
        });
      }, i * 800);

      if (user) {
        insertNotification({
          userId: user.id,
          type: "badge_unlocked",
          title: t("notifications.badgeUnlockedTitle", { name }),
          link: "/achievements",
        });
      }
    });

    const next = Array.from(new Set([...Array.from(seen), ...newOnes.map((b) => b.badge_key)]));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, [badges, loading]);
}
