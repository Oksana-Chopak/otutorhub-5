import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { deriveSubscription } from "@/lib/subscriptionState";

export interface WorkspaceSettings {
  tutor_id: string;
  independent_workspace: boolean;
  subscription_status: "free" | "trial" | "active" | "past_due" | "cancelled";
  subscription_until: string | null;
  current_plan?: string | null;
  trial_until: string | null;
  onboarding_completed: boolean;
  onboarding_step: number;
  custom_currencies: string[];
  reward_theme: string;
  ai_notes_auto?: boolean;
  ai_notes_auto_send?: boolean;
  liqpay_recurring_active?: boolean;
}

interface WorkspaceQueryData {
  settings: WorkspaceSettings | null;
  studentCount: number;
}

/**
 * Free план тепер має необмежену кількість учнів — лімітів немає,
 * лишаємо лічильник для статистики у дашборді.
 * Premium-фічі: нагадування про оплату, керування скасуванням/перенесенням,
 * детальна аналітика та експорт звітів.
 *
 * A4: хук викликається у ~26 місцях (на дашборді ≥6 інстансів одночасно);
 * раніше кожен інстанс робив власні 2 запити за ті самі два рядки даних.
 * Тепер це один спільний useQuery-кеш (staleTime 60с з App.tsx) — один запит
 * на всіх. Це водночас фікс стійкості: при збої REFETCH react-query лишає
 * попередні дані, тож платний передплатник у метро більше не бачить пейвол
 * через те, що isPro «обнулився» на невдалому читанні.
 */
export function useWorkspaceSettings() {
  const { user, roles } = useAuth();
  const queryClient = useQueryClient();
  const isTutor = roles.includes("tutor");
  const enabled = !!user && isTutor;

  const queryKey = ["workspace-settings", user?.id ?? null];

  const { data, isPending, error } = useQuery<WorkspaceQueryData>({
    queryKey,
    enabled,
    // Збій читання — виняток, щоб спрацювали ретраї (retry: 1 з App.tsx),
    // а не тихий null, який вимикає Pro-фічі.
    queryFn: async () => {
      const [wsRes, ratesRes] = await Promise.all([
        supabase
          .from("tutor_workspace_settings")
          .select("*")
          .eq("tutor_id", user!.id)
          .maybeSingle(),
        supabase
          .from("student_rates")
          .select("student_id, archived_at")
          .eq("tutor_id", user!.id)
          .eq("source", "independent"),
      ]);
      if (wsRes.error) throw wsRes.error;
      if (ratesRes.error) throw ratesRes.error;
      // Той самий контракт, що й /my-students: distinct АКТИВНІ (без архіву).
      const ids = new Set(
        (ratesRes.data ?? [])
          .filter((r: { archived_at: string | null }) => !r.archived_at)
          .map((r: { student_id: string }) => r.student_id),
      );
      return {
        settings: wsRes.data as unknown as WorkspaceSettings | null,
        studentCount: ids.size,
      };
    },
  });

  const settings = data?.settings ?? null;
  const studentCount = data?.studentCount ?? 0;
  // Контракт loading не змінився: true лише поки перший запит справді летить;
  // для не-тьютора (query вимкнено) — одразу false, як і раніше.
  const loading = enabled ? isPending : false;

  /**
   * Аудит 01.09 — корінь цілого класу помилок: `isIndependent` дорівнює
   * `settings?.independent_workspace ?? false`, тобто «ще не знаю» невідрізнимо
   * від «хабовий». Через це самостійний репетитор устигав побачити чужий
   * інтерфейс (одинарний FAB, кнопку AI замість пейволу, підпис «Репетитор
   * хабу»), а форма встигала записати урок із source:"hub".
   *
   * `roleReady` — це і є відповідь на питання «чи можна вже вирішувати долю UI».
   * Для не-репетитора (запит вимкнено) персона визначається ролями, тож true
   * одразу. Гейт `src/test/persona-readiness.test.ts` вимагає, щоб КОЖЕН файл,
   * який читає `isIndependent`, згадував і готовність — інакше CI падає.
   */
  const roleReady = !enabled || !loading;

  /**
   * Запит завершився, а рядка налаштувань немає: збій читання після ретраїв або
   * (теоретично) відсутній рядок. Персона досі невідома — для грошей, пейволу
   * і будь-якого ЗАПИСУ це означає «не можна», а не «хабовий».
   */
  const workspaceUnknown = enabled && !loading && !settings;

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["workspace-settings", user?.id ?? null] });
  }, [queryClient, user?.id]);

  const updateSettings = async (patch: Partial<WorkspaceSettings>) => {
    if (!user) return;
    // Tutors no longer have a direct write policy on tutor_workspace_settings (it would
    // expose the privileged billing/subscription columns to a static security scan).
    // Safe settings go through the SECURITY DEFINER RPC, which only applies whitelisted
    // columns and physically cannot touch subscription/trial/workspace flags.
    const { error: rpcError } = await (supabase as any).rpc("update_my_workspace_settings", { _patch: patch });
    if (!rpcError) await refresh();
    return rpcError;
  };

  /**
   * ЗАМОК (рішення власниці 05.09): застосунок — платний. Після 30 днів тріалу
   * без підписки ядро (НОВІ уроки та позначення оплат) замикається; всі дані,
   * історія та кабінети учнів лишаються видимими. Light (149 грн) — оплачений
   * план без AI-фіч (hasFullPlan=false; тріал = повний план).
   *
   * Уся математика станів — у ЧИСТІЙ deriveSubscription (lib/subscriptionState):
   * чотириперсонний тест записів ганяє САМЕ її, тож тест і продакшн виконують
   * один код. Хабовий/менеджер/учень не замикаються ніколи; поки персона
   * невідома (roleReady/workspaceUnknown) — замок не вмикається
   * (persona-readiness), записи в цю мить гейтяться guard'ами воркспейсу.
   */
  const {
    isIndependent,
    isPro,
    isTrial: trialActive,
    coreLocked,
    hasFullPlan,
    planKey,
  } = deriveSubscription({ settings, roleReady, workspaceUnknown });
  const trialUntil = settings?.trial_until ? new Date(settings.trial_until) : null;
  const trialDaysLeft = trialActive && trialUntil
    ? Math.max(0, Math.ceil((trialUntil.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  return {
    settings,
    loading,
    /** Чи вже відомо, яка це персона. Перевіряй ЦЕ, а не loading. */
    roleReady,
    /** Запит завершився, але налаштувань немає — персона невідома. */
    workspaceUnknown,
    /** Збій читання (після ретраїв). Дані попереднього успішного читання при цьому зберігаються. */
    error: error ?? null,
    studentCount,
    isIndependent,
    isPro,
    isTrial: trialActive,
    /** Ядро замкнене: незалежний без активної підписки/тріалу. Дані видно, нові уроки/оплати — ні. */
    coreLocked,
    /** Активний ПОВНИЙ план (не Light): відкриває AI-конспекти і правила скасувань. */
    hasFullPlan,
    /** current_plan з бази: 'monthly' | 'halfyear' | 'yearly' | 'light' | null. */
    planKey,
    trialUntil,
    trialDaysLeft,
    updateSettings,
    refresh,
  };
}
