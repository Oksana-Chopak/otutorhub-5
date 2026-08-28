import { supabase } from "@/integrations/supabase/client";

/**
 * C6: легкі продукт-події → таблиця app_events (RLS insert-own).
 * Фейл-сайлент: до застосування APPLY-PART-4 вставки тихо падають — жодного
 * впливу на UX. Саме на цих цифрах прийматимемо рішення по A-D редизайнах.
 */
export function logEvent(name: string, props: Record<string, unknown> = {}) {
  try {
    void ((supabase as any).from("app_events"))
      .insert({ name, props })
      .then(() => {}, () => {});
  } catch {
    /* таблиця може ще не існувати — тихо */
  }
}
