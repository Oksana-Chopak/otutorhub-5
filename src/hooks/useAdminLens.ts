import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useIsSuperadmin } from "@/hooks/useIsSuperadmin";

/**
 * «Лінза» суперадміна (11.11, перша зовнішня школа).
 *
 * Суперадмін водночас менеджер власної школи. Поки школа була одна, «бачу все»
 * і «бачу свою школу» збігались. З другою школою власні «Фінанси», «Мій день» і
 * розклад показали б гроші й уроки всіх шкіл упереміш. Тому в базі в суперадміна
 * є погляд (міграція `20261111120000_school_launch`):
 *   • own — власна школа (типово): усі звичні екрани поводяться як у менеджера;
 *   • hub — обрана школа: екрани показують ЇЇ очима (і додані люди йдуть у неї);
 *   • all — вся платформа разом.
 * Самостійні репетитори видимі завжди — це клієнти платформи.
 *
 * Перемикає лише сервер (`set_admin_view`): усе читання в застосунку йде крізь
 * RLS, тож після зміни погляду сторінка перезавантажується — жодного клієнтського
 * фільтра, який міг би розійтися з базою.
 *
 * До застосування міграції RPC немає: хук повертає `available: false`, і жоден
 * екран цього не помічає.
 */
export type LensMode = "own" | "hub" | "all";
export type LensHub = {
  id: string;
  name: string;
  created_at: string;
  managers: (string | null)[];
  tutors: number;
  students: number;
  lessons_30d: number;
  last_lesson_at: string | null;
};
export type AdminLens = {
  available: boolean;
  loading: boolean;
  mode: LensMode;
  viewHubId: string | null;
  ownHubId: string | null;
  hubs: LensHub[];
  /** Назва школи, на яку зараз дивиться суперадмін (null — власна або вся платформа). */
  viewHubName: string | null;
  reload: () => Promise<void>;
  setLens: (mode: LensMode, hubId?: string | null) => Promise<boolean>;
};

export function useAdminLens(): AdminLens {
  const { isSuperadmin, loading: saLoading } = useIsSuperadmin();
  const [state, setState] = useState<{
    available: boolean; loading: boolean; mode: LensMode; viewHubId: string | null; ownHubId: string | null; hubs: LensHub[];
  }>({ available: false, loading: true, mode: "own", viewHubId: null, ownHubId: null, hubs: [] });

  const reload = useCallback(async () => {
    if (!isSuperadmin) {
      setState((s) => ({ ...s, available: false, loading: saLoading }));
      return;
    }
    try {
      // cast: RPC потрапляє у згенеровані типи лише після застосування міграції
      const { data, error } = await (supabase as any).rpc("admin_hubs_overview");
      if (error || !data) {
        setState((s) => ({ ...s, available: false, loading: false }));
        return;
      }
      const mode: LensMode = data.view_mode === "hub" || data.view_mode === "all" ? data.view_mode : "own";
      setState({
        available: true,
        loading: false,
        mode,
        viewHubId: data.view_hub_id ?? null,
        ownHubId: data.own_hub_id ?? null,
        hubs: Array.isArray(data.hubs) ? (data.hubs as LensHub[]) : [],
      });
    } catch {
      setState((s) => ({ ...s, available: false, loading: false }));
    }
  }, [isSuperadmin, saLoading]);

  useEffect(() => { void reload(); }, [reload]);

  const setLens = useCallback(async (mode: LensMode, hubId?: string | null) => {
    const { error } = await (supabase as any).rpc("set_admin_view", { _mode: mode, _hub: mode === "hub" ? hubId ?? null : null });
    return !error;
  }, []);

  const viewHubName =
    state.mode === "hub" ? state.hubs.find((h) => h.id === state.viewHubId)?.name ?? null : null;

  return { ...state, viewHubName, reload, setLens };
}
