import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Єдиний список предметів (реєстр subject_canon). Кеш на сесію.
let cache: string[] | null = null;
let inflight: Promise<string[]> | null = null;

async function fetchCanon(): Promise<string[]> {
  const { data, error } = await (supabase.from("subject_canon" as any) as any)
    .select("display")
    .order("display");
  if (error || !data) return [];
  return (data as { display: string }[]).map((r) => r.display);
}

export function useSubjectCanon(): string[] {
  const [list, setList] = useState<string[]>(cache ?? []);
  useEffect(() => {
    if (cache) return;
    inflight = inflight ?? fetchCanon();
    inflight.then((l) => { cache = l; setList(l); });
  }, []);
  return list;
}
