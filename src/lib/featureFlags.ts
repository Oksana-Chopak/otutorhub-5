/**
 * Прапорці функцій (02.10). Один запит на сесію (`my_feature_flags()` у базі:
 * enabled × відсоток за хешем людини × поіменний список), далі — з кешу
 * модуля. Без бази або до вставки SQL — fallback, щоб жодна функція не
 * зникла через прапорці: вимкнути можна лише свідомо, в адмінці.
 * Без react-query навмисно: хук має працювати всюди, де є supabase, —
 * і на лендінгу, і в тестах без провайдера.
 */
import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";

export type FlagKey = "import_sheet_link" | "import_google_calendar" | "landing_sheet_link" | "ai_lesson_summary";

type Flags = Record<string, boolean>;
let cache: Flags | null = null;
let inflight: Promise<Flags> | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const l of listeners) l(); };

export async function fetchFeatureFlags(): Promise<Flags> {
  try {
    // RPC з міграції 20261002120000 — до перегенерації types.ts через (rpc as any)
    const rpc = (supabase as any)?.rpc;
    if (typeof rpc !== "function") return {};
    const { data, error } = await rpc.call(supabase, "my_feature_flags");
    if (error || !data || typeof data !== "object") return {};
    return data as Flags;
  } catch {
    return {};
  }
}

/** Завантажити раз на сесію; повторний виклик — той самий проміс або кеш. */
export function loadFeatureFlags(): Promise<Flags> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetchFeatureFlags().then((f) => { cache = f; notify(); return f; }).catch(() => { cache = {}; notify(); return {}; });
  }
  return inflight;
}

/** Скинути кеш (адмінка після перемикання прапорця). */
export function invalidateFeatureFlags(): void {
  cache = null;
  inflight = null;
  notify();
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getSnapshot = () => cache;

/** true/false з бази; поки не завантажено або прапорця немає — fallback (за замовчуванням увімкнено). */
export function useFeatureFlag(key: FlagKey, fallback = true): boolean {
  const flags = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => { if (!cache) void loadFeatureFlags(); }, []);
  if (!flags || !(key in flags)) return fallback;
  return flags[key] === true;
}
