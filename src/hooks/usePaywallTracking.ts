import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";

export type PaywallFeatureKey =
  | "ai_summary"
  | "premium_analytics"
  | "payment_reminder"
  | "bulk_actions"
  | "subscription_page_visit"
  | "upgrade_banner";

export type PaywallSource =
  | "lesson_workspace"
  | "finances"
  | "dashboard"
  | "sidebar"
  | "subscription_page"
  | "analytics_page"
  | "unknown";

/**
 * Fire-and-forget трекер кліків по paywall-точках.
 * Записує в paywall_events: хто, яка фіча, звідки, статус підписки.
 * Pro/Trial кліки теж пишемо — для воронки. У дашборді менеджер фільтрує.
 */
export function usePaywallTracking() {
  const { user } = useAuth();
  const { settings } = useWorkspaceSettings();

  const trackPaywallClick = useCallback(
    (
      feature: PaywallFeatureKey,
      source: PaywallSource = "unknown",
      metadata: Record<string, unknown> = {},
    ) => {
      if (!user) return;
      // fire-and-forget — не блокуємо UI
      void supabase.from("paywall_events").insert({
        user_id: user.id,
        feature_key: feature,
        source,
        subscription_status: settings?.subscription_status ?? "free",
        metadata: metadata as never,
      });
    },
    [user?.id, settings?.subscription_status],
  );

  return { trackPaywallClick };
}
