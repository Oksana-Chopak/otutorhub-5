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
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setIsSuperadmin(false); setLoading(false); return; }
    let active = true;
    setLoading(true);
    // cast: is_superadmin потрапляє у згенеровані типи лише після міграції
    (supabase as any)
      .rpc("is_superadmin")
      .then(({ data }: { data: unknown }) => {
        if (!active) return;
        setIsSuperadmin(data === true);
        setLoading(false);
      })
      // Аудит 01.09: без catch відхилений проміс лишав loading=true назавжди,
      // а прапор — false: модерація чатів тихо вимикалась назовсім.
      .catch(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => { active = false; };
  }, [user?.id]);

  return { isSuperadmin, loading };
}
