import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Назви груп для карток уроків (11.11).
 *
 * Груповий урок на картці підписувався «Груповий урок» — і все. Менеджер школи з
 * трьома групами бачив у розкладі три однакові картки й не міг сказати, де чия;
 * LessonCard назву показувати вмів (`groupName`), та жодна сторінка її не передавала.
 * Хук дочитує назви лише для груп, що справді є серед показаних уроків; читання —
 * крізь RLS, тож кожен бачить назви тільки своїх груп. Збій чи відсутня назва —
 * картка лишається з попереднім підписом, нічого не ламається.
 */
export function useGroupNames(lessons: ReadonlyArray<{ group_id?: string | null }>): Map<string, string> {
  const key = useMemo(
    () => Array.from(new Set(lessons.map((l) => l.group_id).filter((g): g is string => !!g))).sort().join(","),
    [lessons],
  );
  const [names, setNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!key) { setNames(new Map()); return; }
    let alive = true;
    supabase
      .from("lesson_groups")
      .select("id, name")
      .in("id", key.split(","))
      .then(({ data, error }) => {
        if (!alive || error) return;
        setNames(new Map((data ?? []).map((g) => [g.id as string, g.name as string])));
      });
    return () => { alive = false; };
  }, [key]);

  return names;
}
