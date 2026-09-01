import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Нарахування ачівок репетитора (RPC `award_my_badges`, міграція 20260901120000).
 *
 * Перевірка 01.09: виклик жив лише на дашборді, а тост про новий бейдж веде на
 * /achievements — тобто хто відкривав сторінку досягнень напряму (чи саме за
 * тостом), бачив стару сітку. Логіка винесена сюди, щоб обидві поверхні
 * нараховували однаково і не розʼїхались.
 *
 * До застосування міграції RPC повертає помилку — вона тихо ігнорується,
 * поведінка рівно та сама, що була до цієї фічі.
 */
export function useAwardBadges(enabled: boolean, onAwarded: () => void | Promise<void>) {
  const inFlight = useRef(false);
  useEffect(() => {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    void (async () => {
      try {
        // Каст: типи RPC регенеруються Lovable після застосування міграції.
        const { data, error } = await (supabase as any).rpc("award_my_badges");
        if (!error && Array.isArray(data) && data.length > 0) await onAwarded();
      } catch {
        /* міграцію ще не застосовано — без шуму */
      } finally {
        inFlight.current = false;
      }
    })();
    // onAwarded навмисно поза залежностями: це стабільний refresh хука гейміфікації,
    // а перепідписка на кожен рендер зробила б зайвий виклик RPC.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
