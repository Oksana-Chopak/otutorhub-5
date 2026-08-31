import { toast } from "sonner";
import { bumpDataVersion } from "@/lib/dataBus";
import { logEvent } from "@/lib/analytics";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { setLessonStatus, completeLessons } from "@/lib/lessonActions";
import { syncLessonToGoogleCalendar } from "@/lib/googleCalendarSync";
import { burstConfetti } from "@/lib/confetti";
import { useHaptic } from "@/hooks/useHaptic";
import { insertNotification } from "@/lib/notifications";
import { notifyGroupLessonCancelled } from "@/lib/groupLessons";
import { getRandomEmoji, type RewardTheme } from "@/lib/rewardThemes";

/**
 * C1: ЄДИНИЙ конвеєр статусу уроку (аудит B4). Одна дія — однакова
 * винагорода й побічні ефекти з УСІХ п'яти точок: запис через lib →
 * календар → гейміфікація/нагорода → тост. Розтяжка №10 (затягнута)
 * гарантує, що інших писарів не з'явиться.
 */
export type LessonLite = {
  id: string;
  student_id: string | null;
  tutor_id?: string;
  subject?: string;
  source?: string | null;
  student_payment_status?: string | null;
};

export type CompleteOpts = {
  canMarkPay?: boolean;
  onMarkPaid?: () => void;
  streakCount?: number | null;
  onXp?: () => void;
  firstLesson?: boolean;
  celebrate?: boolean;
};

export function useLessonStatus() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const haptic = useHaptic();

  const award = (l: LessonLite) => {
    const tutorId = l.tutor_id ?? user?.id;
    if (!l.student_id || !tutorId) return;
    const theme: RewardTheme = "fruits";
    // B5: upsert з ignoreDuplicates + UNIQUE(lesson_id, student_id) у БД
    // (міграція 20260901090001) — повторний виклик за той самий урок більше
    // не дарує учневі другу нагороду.
    const row = {
      student_id: l.student_id, lesson_id: l.id, tutor_id: tutorId,
      emoji: getRandomEmoji(theme), theme,
    };
    void (async () => {
      const { error } = await (supabase as any)
        .from("student_rewards")
        .upsert(row, { onConflict: "lesson_id,student_id", ignoreDuplicates: true });
      // Фолбек: поки UNIQUE-міграцію не застосовано, on_conflict відхиляється —
      // пишемо по-старому, щоб нагорода не зникла взагалі.
      if (error) await (supabase as any).from("student_rewards").insert(row);
    })();
  };

  const complete = async (l: LessonLite, o: CompleteOpts = {}): Promise<boolean> => {
    const { error } = await setLessonStatus(l.id, "completed");
    if (error) { haptic.error(); toast.error(t("dashboardExtra.statusChangeFailed")); return false; }
    if (o.celebrate !== false) {
      haptic.success();
      burstConfetti(o.firstLesson ? { count: 40, originY: 40 } : undefined);
    }
    toast.success(
      o.firstLesson ? t("dashboardExtra.firstLessonToast") : t("dashboardExtra.lessonCompletedToast"),
      {
        description: o.canMarkPay
          ? t("dashboardExtra.studentPaidQuestion")
          : o.streakCount
            ? t("dashboardExtra.lessonCompletedStreak", { count: o.streakCount })
            : t("dashboardExtra.lessonCompletedGood"),
        duration: o.canMarkPay ? 6000 : 4000,
        action: o.canMarkPay && o.onMarkPaid
          ? { label: t("dashboardExtra.paidAction"), onClick: o.onMarkPaid }
          : undefined,
      },
    );
    logEvent("lesson_completed", { id: l.id }); // C6
    bumpDataVersion(); // C3
    award(l);
    o.onXp?.();
    void syncLessonToGoogleCalendar(l.id, "upsert");
    return true;
  };

  const cancel = async (l: LessonLite): Promise<boolean> => {
    const { error } = await setLessonStatus(l.id, "cancelled");
    if (error) { toast.error(t("dashboardExtra.statusChangeFailed")); return false; }
    if (l.student_id) {
      insertNotification({
        userId: l.student_id,
        type: `lesson_cancelled_${l.id}`,
        title: t("notifications.lessonCancelledTitle", { subject: l.subject ?? "" }),
        link: "/student/schedule",
      });
    } else {
      void notifyGroupLessonCancelled(l.id, l.subject ?? "");
    }
    logEvent("lesson_cancelled", { id: l.id }); // C6
    bumpDataVersion(); // C3
    void syncLessonToGoogleCalendar(l.id, "delete");
    toast.success(t("schedule.statusUpdated"));
    return true;
  };

  const completeMany = async (ls: LessonLite[], o: { toastText?: string } = {}): Promise<boolean> => {
    const ids = ls.map((x) => x.id);
    if (!ids.length) return true;
    const { error } = await completeLessons(ids);
    if (error) { haptic.error(); toast.error(t("closeDayDialog.closeDayError")); return false; }
    haptic.success();
    burstConfetti({ count: 24, originY: 40 });
    ls.forEach(award);
    ls.forEach((x) => void syncLessonToGoogleCalendar(x.id, "upsert"));
    if (o.toastText) toast.success(o.toastText);
    return true;
  };

  return { complete, cancel, completeMany };
}
