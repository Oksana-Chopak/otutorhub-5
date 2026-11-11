import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Предмети СВОЄЇ школи (11.11, перша зовнішня школа).
 *
 * Чипи предметів у формах менеджера були вшитим списком школи власниці платформи
 * («Математика (нім. програма)», «Шведська мова»…). Нова школа іспанської бачила
 * шість чужих предметів і мусила вписувати свій руками в кожній формі заново.
 * Тепер підказки — це предмети, які школа вже веде: зі ставок і профілів її
 * репетиторів. Читання йде крізь RLS, тож менеджер бачить лише свою школу, а
 * репетитор — лише себе. null = ще не прочитано (чи збій) → форма показує
 * загальний список, нічого не ламається.
 */
const cache = new Map<string, string[]>();

export function useSchoolSubjects(): string[] | null {
  const { user } = useAuth();
  const [list, setList] = useState<string[] | null>(() => (user ? cache.get(user.id) ?? null : null));

  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      const [td, sr] = await Promise.all([
        supabase.from("tutor_details").select("subjects").limit(500),
        supabase.from("tutor_subject_rates").select("subject").limit(1000),
      ]);
      if (!alive || td.error || sr.error) return;
      const seen = new Map<string, string>();
      const add = (raw: unknown) => {
        const s = String(raw ?? "").trim();
        const k = s.toLowerCase();
        if (s && !seen.has(k)) seen.set(k, s);
      };
      (td.data ?? []).forEach((r) => ((r.subjects as string[] | null) ?? []).forEach(add));
      (sr.data ?? []).forEach((r) => add(r.subject));
      const out = Array.from(seen.values()).sort((a, b) => a.localeCompare(b, "uk"));
      cache.set(user.id, out);
      setList(out);
    })();
    return () => { alive = false; };
  }, [user?.id]);

  return list;
}
