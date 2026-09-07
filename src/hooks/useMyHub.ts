import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type MyHub = { id: string; name: string };

/**
 * Школа поточного користувача (модель «школа = сутність», 07.09).
 *
 * RLS на `hubs` віддає лише свою школу (менеджеру — з hub_managers,
 * репетитору — з settings.hub_id, учню — з hub_members), тож звичайний
 * select без фільтрів і є «моя школа». Суперадмін бачить усі — беремо
 * першу лише для підпису; сама адмінка працює зі списком напряму.
 *
 * До застосування міграції таблиці немає — запит падає, хук повертає null,
 * і жоден екран цього не помічає (підпис школи просто не показується).
 */
export function useMyHub(): { hub: MyHub | null; loading: boolean } {
  const { user } = useAuth();
  const [hub, setHub] = useState<MyHub | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setHub(null); setLoading(false); return; }
    let active = true;
    setLoading(true);
    // cast: hubs потрапляє у згенеровані типи лише після міграції
    (supabase as any)
      .from("hubs")
      .select("id, name, created_at")
      .order("created_at", { ascending: true })
      .limit(1)
      .then(({ data, error }: { data: MyHub[] | null; error: unknown }) => {
        if (!active) return;
        setHub(!error && data && data.length > 0 ? { id: data[0].id, name: data[0].name } : null);
        setLoading(false);
      })
      .catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.id]);

  return { hub, loading };
}
