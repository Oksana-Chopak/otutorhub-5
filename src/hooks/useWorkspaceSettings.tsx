import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface WorkspaceSettings {
  tutor_id: string;
  independent_workspace: boolean;
  subscription_status: "free" | "trial" | "active" | "past_due" | "cancelled";
  subscription_until: string | null;
  trial_until: string | null;
  onboarding_completed: boolean;
  onboarding_step: number;
  custom_currencies: string[];
  reward_theme: string;
}

/**
 * Free план тепер має необмежену кількість учнів — лімітів немає,
 * лишаємо лічильник для статистики у дашборді.
 * Premium-фічі: нагадування про оплату, керування скасуванням/перенесенням,
 * детальна аналітика та експорт звітів.
 */
export function useWorkspaceSettings() {
  const { user, roles } = useAuth();
  const isTutor = roles.includes("tutor");
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [studentCount, setStudentCount] = useState(0);

  const load = useCallback(async () => {
    if (!user || !isTutor) {
      setSettings(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data: ws }, { data: rates }] = await Promise.all([
      supabase
        .from("tutor_workspace_settings")
        .select("*")
        .eq("tutor_id", user.id)
        .maybeSingle(),
      supabase
        .from("student_rates")
        .select("student_id")
        .eq("tutor_id", user.id)
        .eq("source", "independent"),
    ]);
    setSettings(ws as unknown as WorkspaceSettings | null);
    const ids = new Set((rates ?? []).map((r: any) => r.student_id));
    setStudentCount(ids.size);
    setLoading(false);
  }, [user?.id, isTutor]);

  useEffect(() => {
    load();
  }, [load]);

  const updateSettings = async (patch: Partial<WorkspaceSettings>) => {
    if (!user) return;
    const { error } = await (supabase as any)
      .from("tutor_workspace_settings")
      .upsert({ tutor_id: user.id, ...patch }, { onConflict: "tutor_id" });
    if (!error) await load();
    return error;
  };

  const isIndependent = settings?.independent_workspace ?? false;
  const isActiveSub = settings?.subscription_status === "active";
  const trialActive =
    settings?.subscription_status === "trial" &&
    !!settings?.trial_until &&
    new Date(settings.trial_until).getTime() > Date.now();
  const isPro = isActiveSub || trialActive;
  const trialUntil = settings?.trial_until ? new Date(settings.trial_until) : null;
  const trialDaysLeft = trialActive && trialUntil
    ? Math.max(0, Math.ceil((trialUntil.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  return {
    settings,
    loading,
    studentCount,
    isIndependent,
    isPro,
    isTrial: trialActive,
    trialUntil,
    trialDaysLeft,
    updateSettings,
    refresh: load,
  };
}
