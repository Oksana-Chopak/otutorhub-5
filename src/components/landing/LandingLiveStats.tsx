import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";

/**
 * Живі лічильники платформи (12.09) — соціальний доказ без відгуків, яких
 * поки нема: «за 30 днів помічник провів N зустрічей і нагадав про M оплат».
 *
 * Показуємо ЛИШЕ коли числа вже не соромні: маленькі цифри працюють проти
 * продукту («12 зустрічей» читається як «тут нікого немає»). Пороги — тут, у
 * коді, одним місцем; поки їх не досягнуто, компонент не рендерить нічого,
 * і сторінка виглядає так, ніби його немає. Дані — агрегати з публічної
 * edge-функції landing-spots-left (service role, жодного імені чи суми).
 */
export const LIVE_STATS_MIN_LESSONS = 100;
export const LIVE_STATS_MIN_REMINDERS = 20;

type Stats = { lessonsCompleted30d: number; remindersSent30d: number; tutors: number };

export function LandingLiveStats() {
  const { t, i18n } = useTranslation();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let active = true;
    supabase.functions
      .invoke("landing-spots-left")
      .then(({ data }) => {
        if (!active) return;
        const s = (data as { stats?: Stats } | null)?.stats;
        if (s && typeof s.lessonsCompleted30d === "number" && typeof s.remindersSent30d === "number") setStats(s);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  if (!stats || stats.lessonsCompleted30d < LIVE_STATS_MIN_LESSONS || stats.remindersSent30d < LIVE_STATS_MIN_REMINDERS) return null;

  // Роздільник тисяч — за мовою інтерфейсу, а не за локаллю браузера: «1 234» у нас, «1,234» в en.
  const n = (v: number) => new Intl.NumberFormat(i18n.language).format(v);
  return (
    <div className="live-stats" aria-live="polite">
      <span className="live-stats-dot" aria-hidden="true" />
      <span>
        {t("landingLive.line", {
          lessons: t("landingLive.lessons", { count: stats.lessonsCompleted30d, n: n(stats.lessonsCompleted30d) }),
          reminders: t("landingLive.reminders", { count: stats.remindersSent30d, n: n(stats.remindersSent30d) }),
        })}
      </span>
    </div>
  );
}
