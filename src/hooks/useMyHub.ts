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
    const sb = supabase as any;
    (async () => {
      try {
        const { data, error } = await sb.from("hubs").select("id, name, created_at").order("created_at", { ascending: true });
        if (!active) return;
        const rows: MyHub[] = !error && Array.isArray(data) ? data : [];
        let pick: MyHub | null = rows[0] ?? null;
        if (rows.length > 1) {
          /* Більше однієї школи бачить лише суперадмін. «Перша за датою» — не
             обовʼязково та, на яку він дивиться: питаємо базу (11.11, лінза).
             RPC ще немає в базі — лишається перша, як було. */
          const { data: mine } = await sb.rpc("caller_hub_id");
          if (!active) return;
          pick = rows.find((h) => h.id === mine) ?? pick;
        }
        setHub(pick ? { id: pick.id, name: pick.name } : null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [user?.id]);

  return { hub, loading };
}
