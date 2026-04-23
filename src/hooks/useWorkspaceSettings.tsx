import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface WorkspaceSettings {
  tutor_id: string;
  independent_workspace: boolean;
  subscription_status: "free" | "active" | "past_due" | "cancelled";
  subscription_until: string | null;
  onboarding_completed: boolean;
  onboarding_step: number;
}

export const FREE_STUDENT_LIMIT = 5;

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
    setSettings(ws as WorkspaceSettings | null);
    const ids = new Set((rates ?? []).map((r: any) => r.student_id));
    setStudentCount(ids.size);
    setLoading(false);
  }, [user?.id, isTutor]);

  useEffect(() => {
    load();
  }, [load]);

  const updateSettings = async (patch: Partial<WorkspaceSettings>) => {
    if (!user) return;
    const { error } = await supabase
      .from("tutor_workspace_settings")
      .upsert({ tutor_id: user.id, ...patch }, { onConflict: "tutor_id" });
    if (!error) await load();
    return error;
  };

  const isIndependent = settings?.independent_workspace ?? false;
  const isAtLimit =
    isIndependent &&
    settings?.subscription_status === "free" &&
    studentCount >= FREE_STUDENT_LIMIT;

  return {
    settings,
    loading,
    studentCount,
    isIndependent,
    isAtLimit,
    updateSettings,
    refresh: load,
  };
}
