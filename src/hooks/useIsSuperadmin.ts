import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Чи є поточний користувач суперадміном платформи (`platform_admins`).
 *
 * Раніше ця перевірка жила тільки всередині AppSidebar заради одного пункту
 * меню. Модерація чатів — друге місце, тож логіка стала хуком: один виклик
 * RPC, один кеш, одна правда. Клієнтський прапор — лише для UI; справжнє
 * забезпечення — RLS-політики на `is_superadmin()`.
 */
export function useIsSuperadmin(): { isSuperadmin: boolean; loading: boolean } {
  const { user } = useAuth();
  /* Аудит 09.09: стан тримає ще й ЧИЙ це результат. Раніше при user === null
     хук одразу казав «не суперадмін, перевірка завершена». Авторизація
     доїжджає двома кроками, тож існував один рендер, у якому user уже є,
     loading уже false, а відповіді для НЬОГО ще немає — і ProtectedRoute
     на /admin встигав редіректнути. У меню пункт був, а сторінка викидала
     на дашборд: власниця не потрапляла у власну адмінку. */
  const [state, setState] = useState<{ uid: string | null; value: boolean }>({ uid: null, value: false });
  const uid = user?.id ?? null;

  useEffect(() => {
    if (!uid) { setState({ uid: null, value: false }); return; }
    let active = true;
    // cast: is_superadmin потрапляє у згенеровані типи лише після міграції
    (supabase as any)
      .rpc("is_superadmin")
      .then(({ data }: { data: unknown }) => {
        if (active) setState({ uid, value: data === true });
      })
      // Аудит 01.09: без catch відхилений проміс лишав loading=true назавжди,
      // а прапор — false: модерація чатів тихо вимикалась назовсім.
      .catch(() => {
        if (active) setState({ uid, value: false });
      });
    return () => { active = false; };
  }, [uid]);

  // Для залогіненого «ще не знаю» ≠ «ні»: поки відповідь не про ЦЬОГО uid —
  // це завантаження, і рольові рішення не ухвалюються (persona-readiness).
  return { isSuperadmin: state.uid === uid && state.value, loading: uid !== null && state.uid !== uid };
}
