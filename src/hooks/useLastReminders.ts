import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * «Нагадано сьогодні о 14:20» — щоб не питати себе, чи вже нагадувала
 * (важіль 2 аудиту шляхів 24.09).
 *
 * Читає лог `lesson_payment_reminders` за останні 7 днів і віддає час
 * ОСТАННЬОГО РУЧНОГО нагадування по кожній парі «репетитор+учень». RLS уже
 * звужує вибірку: репетитор бачить свої рядки, менеджер — рядки своєї школи,
 * тож жодних фільтрів по ролі тут не потрібно і бути не може.
 *
 * Свідомо лише `manual` (і кнопка з Telegram): автоматичні нагадування крона
 * — не «я нагадала», і показувати їх як свою дію було б брехнею.
 */
const WINDOW_DAYS = 7;

export function useLastReminders() {
  const { user } = useAuth();
  const [map, setMap] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!user) { setMap({}); return; }
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600_000).toISOString();
    // Цей підпис — косметика поверх грошового екрана: він НЕ має права нічого
    // зламати. Тому і помилка запиту, і будь-який виняток (інший клієнт, мок у
    // тесті) означають лише «підпису не буде».
    let rows: Array<{ tutor_id: string; student_id: string; sent_at: string }> = [];
    try {
      const { data, error } = await supabase
        .from("lesson_payment_reminders")
        .select("tutor_id, student_id, sent_at, reminder_kind")
        .gte("sent_at", since)
        .in("reminder_kind", ["manual", "telegram_button"])
        .order("sent_at", { ascending: false })
        .limit(500);
      if (error) return;
      rows = (data ?? []) as typeof rows;
    } catch {
      return;
    }
    const next: Record<string, string> = {};
    for (const r of rows) {
      const key = `${r.tutor_id}:${r.student_id}`;
      if (!next[key]) next[key] = r.sent_at; // вибірка вже за спаданням часу
    }
    setMap(next);
  }, [user?.id]);

  useEffect(() => { void load(); }, [load]);

  /** Час останнього ручного нагадування по парі або null. */
  const lastRemindedAt = useCallback(
    (studentId: string, tutorId?: string | null) => map[`${tutorId ?? user?.id ?? ""}:${studentId}`] ?? null,
    [map, user?.id],
  );

  /** Позначити «нагадано зараз» локально, не чекаючи перечитування. */
  const markReminded = useCallback((studentId: string, tutorId?: string | null) => {
    const key = `${tutorId ?? user?.id ?? ""}:${studentId}`;
    setMap((prev) => ({ ...prev, [key]: new Date().toISOString() }));
  }, [user?.id]);

  return { lastRemindedAt, markReminded, reload: load };
}
