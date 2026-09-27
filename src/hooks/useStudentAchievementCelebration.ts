import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { insertNotification } from "@/lib/notifications";
import { burstConfetti } from "@/lib/confetti";
import type { StudentAchievementWithStatus } from "@/lib/studentAchievements";
import i18n from "@/i18n";

const t = i18n.t.bind(i18n);

/* Ключ на КОРИСТУВАЧА — спільний ключ означав би, що на одному телефоні другий
   акаунт успадковує чужий список «побачених» (та сама пастка, що в бейджах
   репетитора, аудит 02.09). */
const storageKey = (userId: string | undefined) => `seen_student_achievements_v1.${userId ?? "anon"}`;

/**
 * Свято за розблокування ачівки УЧНЯ — дзеркало `useBadgeUnlockToasts`
 * (репетитор). Знахідка §4 аудиту шляхів 24.09: «розблокування ачівки не
 * святкується ніяк — ні тост, ні конфеті». Тобто єдина подія, за яку в учня
 * взагалі можна порадіти, проходила невидимо: сім ачівок жили на сторінці, куди
 * людина не заходить.
 *
 * Межі, які тримає цей хук:
 *  • Свято лише за ЗБЕРЕЖЕНИМ станом. Ачівка учня рахується на клієнті, але з
 *    даних, які вже в базі (проведені уроки, задана домашка). Поки читання не
 *    завершилось або впало — не святкуємо: інваріант «святкуємо лише збережене».
 *  • Перший запуск на пристрої СИНХРОНІЗУЄТЬСЯ тихо. Інакше людина з трьома
 *    давніми ачівками отримувала б три тости підряд при кожному новому вході.
 *  • Пачка від трьох згортається в одне повідомлення (у день, коли ачівки
 *    вмикали репетиторам, кожен отримував шість тостів підряд — свято стало
 *    спамом).
 *  • У дзвіночок пишемо тип із КЛЮЧЕМ ачівки: `create_notification` дедуплікує
 *    за (user_id, type) на 24 години, тож зі спільним типом долітала б лише
 *    перша з кількох.
 */
export function useStudentAchievementCelebration(
  achievements: StudentAchievementWithStatus[],
  loading: boolean,
  loadError: boolean,
) {
  const { user } = useAuth();
  const initialized = useRef(false);

  useEffect(() => {
    if (loading || loadError || achievements.length === 0) return;

    const STORAGE_KEY = storageKey(user?.id);
    let seen: Set<string>;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      seen = new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      seen = new Set();
    }

    const earned = achievements.filter((a) => a.earned);

    // Перший прохід після входу: лише синхронізуємо — старі ачівки не святкуємо.
    if (!initialized.current) {
      initialized.current = true;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(earned.map((a) => a.def.key)));
      } catch {
        /* storage недоступний — тоді свято просто повториться наступного разу */
      }
      return;
    }

    const fresh = earned.filter((a) => !seen.has(a.def.key));
    if (fresh.length === 0) return;

    burstConfetti();
    if (fresh.length >= 3) {
      toast.success(t("studentAchievementToast.many", { count: fresh.length }), {
        description: t("studentAchievementToast.manyDesc"),
        className: "animate-pop",
      });
    } else {
      fresh.forEach((a, i) => {
        setTimeout(() => {
          toast.success(
            t("studentAchievementToast.one", { emoji: a.def.emoji, name: t(a.def.nameKey) }),
            { description: t(a.def.descKey), className: "animate-pop" },
          );
        }, i * 800);
      });
    }

    if (user) {
      fresh.forEach((a) => {
        insertNotification({
          userId: user.id,
          type: `student_achievement_${a.def.key}`,
          title: t("notifications.studentAchievementTitle", { name: t(a.def.nameKey) }),
          link: "/student/achievements",
        });
      });
    }

    const next = Array.from(new Set([...Array.from(seen), ...fresh.map((a) => a.def.key)]));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, [achievements, loading, loadError]);
}
