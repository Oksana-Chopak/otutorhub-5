/**
 * useOnboardingProgress — перевіряє які onboarding-кроки ще не завершені.
 * Використовується на дашборді для секції "Що зробити далі".
 * Логіку даних взято з OnboardingFlowB.tsx — не дублює запити, просто перевіряє факти.
 */
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface OnboardingProgress {
  hasAvailability: boolean;
  hasMeetingUrl: boolean;
  hasReferral: boolean;
  hasGoogleCalendar: boolean;
  hasTelegram: boolean;
  /* Аудит 05.09: репетитор проходив онбординг до кінця і лишався БЕЗ способу
     приймати гроші — реквізитів не було в жодному чеклісті, а учень на
     «Оплатити» бачив тільки «спитати в чаті». */
  hasPaymentDetails: boolean;
  hasAnyStudent: boolean;
  loading: boolean;
}

const INITIAL: OnboardingProgress = {
  hasAvailability: true,  // default true = don't nag until data loaded
  hasMeetingUrl: true,
  hasReferral: true,
  hasGoogleCalendar: true,
  hasTelegram: true,
  hasPaymentDetails: true,
  hasAnyStudent: false,
  loading: true,
};

export function useOnboardingProgress(): OnboardingProgress & { refetch: () => void } {
  const { user } = useAuth();
  const [state, setState] = useState<OnboardingProgress>(INITIAL);
  const [tick, setTick] = useState(0); // A16: рефетч після дій

  const check = useCallback(async () => {
    if (!user) return;

    const safe = async <T,>(p: PromiseLike<T>, fallback: T): Promise<T> => {
      try { return await p; } catch { return fallback; }
    };

    const [avail, meetUrl, referral, gcal, tgLink, payDetails, anyRate] = await Promise.all([
      safe(
        supabase.from("tutor_availability_weekly").select("id").eq("tutor_id", user.id).limit(1),
        { data: [], error: null, count: null, status: 200, statusText: "OK" } as any
      ),
      safe(
        (supabase.from("tutor_student_defaults") as any).select("default_meeting_url").eq("tutor_id", user.id).limit(1),
        { data: [], error: null, count: null, status: 200, statusText: "OK" } as any
      ),
      safe(
        // A9: /my-referrals сам створює код при відкритті — предикат по КОДУ закривав
        // завдання від самого переходу. Рахуємо РЕАЛЬНИХ запрошених.
        (supabase.from("referrals") as any).select("id").eq("referrer_id", user.id).limit(1),
        { data: [], error: null, count: null, status: 200, statusText: "OK" } as any
      ),
      safe(
        (supabase.from("google_calendar_tokens") as any).select("id").eq("user_id", user.id).limit(1),
        { data: [], error: null, count: null, status: 200, statusText: "OK" } as any
      ),
      // UX-1 (2026-07-25): the true "Telegram connected" signal is a row in
      // user_telegram_links — the same source tutor-daily-digest uses. The old
      // check read settings.telegram_daily_digest, a column from the obsolete
      // June schema that never shipped → hasTelegram was permanently false and
      // the dashboard checklist nagged users who had already connected the bot.
      safe(
        (supabase.from("user_telegram_links") as any).select("user_id").eq("user_id", user.id).not("chat_id", "is", null).limit(1),
        { data: [], error: null, count: null, status: 200, statusText: "OK" } as any
      ),
      // Аудит 05.09: реквізити живуть на student_rates.payment_details (форма
      // учня в MyStudentsPage). «Виконано» = хоч одна НЕархівована пара має
      // непорожні реквізити; поки учнів немає — крок не показуємо зовсім
      // (реквізити вводяться у формі учня, тож спершу «додай учня»).
      safe(
        (supabase.from("student_rates") as any)
          .select("id")
          .eq("tutor_id", user.id)
          .is("archived_at", null)
          .not("payment_details", "is", null)
          .neq("payment_details", "")
          .limit(1),
        { data: [], error: null, count: null, status: 200, statusText: "OK" } as any
      ),
      safe(
        (supabase.from("student_rates") as any)
          .select("id")
          .eq("tutor_id", user.id)
          .is("archived_at", null)
          .limit(1),
        { data: [], error: null, count: null, status: 200, statusText: "OK" } as any
      ),
    ]);

    setState({
      hasAvailability:   ((avail.data as any[])?.length ?? 0) > 0,
      hasMeetingUrl:     ((meetUrl.data as any[])?.some((r: any) => r.default_meeting_url?.trim())) ?? false,
      hasReferral:       ((referral.data as any[])?.length ?? 0) > 0,
      hasGoogleCalendar: ((gcal.data as any[])?.length ?? 0) > 0,
      hasTelegram:       ((tgLink.data as any[])?.length ?? 0) > 0,
      hasPaymentDetails: ((payDetails.data as any[])?.length ?? 0) > 0,
      hasAnyStudent:     ((anyRate.data as any[])?.length ?? 0) > 0,
      loading: false,
    });
  }, [user?.id, tick]);

  useEffect(() => { check(); }, [check]);
  const refetch = () => setTick((t) => t + 1); // A16

  return { ...state, refetch };
}
