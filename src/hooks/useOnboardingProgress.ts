/**
 * useOnboardingProgress — перевіряє які onboarding-кроки ще не завершені.
 * Використовується на дашборді для секції "Що зробити далі".
 * Логіку даних взято з OnboardingFlowB.tsx — не дублює запити, просто перевіряє факти.
 */
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";

export interface OnboardingProgress {
  hasAvailability: boolean;
  hasMeetingUrl: boolean;
  hasReferral: boolean;
  hasGoogleCalendar: boolean;
  hasTelegram: boolean;
  loading: boolean;
}

const INITIAL: OnboardingProgress = {
  hasAvailability: true,  // default true = don't nag until data loaded
  hasMeetingUrl: true,
  hasReferral: true,
  hasGoogleCalendar: true,
  hasTelegram: true,
  loading: true,
};

export function useOnboardingProgress(): OnboardingProgress {
  const { user } = useAuth();
  const { settings } = useWorkspaceSettings();
  const [state, setState] = useState<OnboardingProgress>(INITIAL);

  const check = useCallback(async () => {
    if (!user) return;

    const safe = async <T,>(p: PromiseLike<T>, fallback: T): Promise<T> => {
      try { return await p; } catch { return fallback; }
    };

    const [avail, meetUrl, referral, gcal] = await Promise.all([
      safe(
        supabase.from("tutor_availability_weekly").select("id").eq("tutor_id", user.id).limit(1),
        { data: [], error: null, count: null, status: 200, statusText: "OK" } as any
      ),
      safe(
        (supabase.from("tutor_student_defaults") as any).select("default_meeting_url").eq("tutor_id", user.id).limit(1),
        { data: [], error: null, count: null, status: 200, statusText: "OK" } as any
      ),
      safe(
        (supabase.from("referral_codes") as any).select("id").eq("tutor_id", user.id).limit(1),
        { data: [], error: null, count: null, status: 200, statusText: "OK" } as any
      ),
      safe(
        (supabase.from("google_calendar_tokens") as any).select("id").eq("user_id", user.id).limit(1),
        { data: [], error: null, count: null, status: 200, statusText: "OK" } as any
      ),
    ]);

    setState({
      hasAvailability:   ((avail.data as any[])?.length ?? 0) > 0,
      hasMeetingUrl:     ((meetUrl.data as any[])?.some((r: any) => r.default_meeting_url?.trim())) ?? false,
      hasReferral:       ((referral.data as any[])?.length ?? 0) > 0,
      hasGoogleCalendar: ((gcal.data as any[])?.length ?? 0) > 0,
      hasTelegram:       Boolean((settings as any)?.telegram_daily_digest),
      loading: false,
    });
  }, [user?.id, settings]);

  useEffect(() => { check(); }, [check]);

  return state;
}
