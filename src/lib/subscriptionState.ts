/**
 * ЧИСТИЙ вивід стану підписки з рядка tutor_workspace_settings — єдине місце
 * правди для isPro / coreLocked / hasFullPlan (05.09, замок + Light).
 * useWorkspaceSettings ДЕЛЕГУЄ сюди; чотириперсонний тест записів
 * (four-persona-writes) ганяє цю ж функцію по матриці станів — тобто тест
 * і продакшн виконують той самий код, а не його переказ.
 */

export interface SubscriptionSettingsSlice {
  independent_workspace: boolean;
  subscription_status: "free" | "trial" | "active" | "past_due" | "cancelled";
  subscription_until: string | null;
  trial_until: string | null;
  current_plan?: string | null;
}

export interface SubscriptionFlagsInput {
  settings: SubscriptionSettingsSlice | null;
  /** Персона вже відома (не-тьютор або запит завершився). */
  roleReady: boolean;
  /** Запит завершився, а рядка немає — персона НЕвідома. */
  workspaceUnknown: boolean;
  now?: number;
}

export interface SubscriptionFlags {
  isIndependent: boolean;
  isPro: boolean;
  isTrial: boolean;
  /** Ядро замкнене: незалежний без активної підписки/тріалу. */
  coreLocked: boolean;
  /** Активний ПОВНИЙ план (не Light); тріал = повний. */
  hasFullPlan: boolean;
  planKey: string | null;
}

export function deriveSubscription({ settings, roleReady, workspaceUnknown, now = Date.now() }: SubscriptionFlagsInput): SubscriptionFlags {
  const isIndependent = settings?.independent_workspace ?? false;
  const subUntil = settings?.subscription_until ? new Date(settings.subscription_until).getTime() : null;
  const isActiveSub =
    settings?.subscription_status === "active" && (subUntil === null || subUntil > now);
  const isTrial =
    settings?.subscription_status === "trial" &&
    !!settings?.trial_until &&
    new Date(settings.trial_until).getTime() > now;
  const isPro = isActiveSub || isTrial;

  // Замок вмикається ЛИШЕ коли персона відома (persona-readiness): у стані
  // завантаження/невідомості жодних рольових рішень — і жодного пейволу.
  const coreLocked = roleReady && !workspaceUnknown && isIndependent && !isPro;

  const planKey = (settings?.current_plan ?? null) as string | null;
  const hasFullPlan = isPro && !(isActiveSub && planKey === "light");

  return { isIndependent, isPro, isTrial, coreLocked, hasFullPlan, planKey };
}
