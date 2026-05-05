import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface Subject {
  id: string;
  name: string;
  emoji: string | null;
}

let cache: Subject[] | null = null;
let inflight: Promise<Subject[]> | null = null;
const subscribers = new Set<(s: Subject[]) => void>();

async function loadSubjects(): Promise<Subject[]> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    const { data } = await supabase
      .from("subjects")
      .select("id, name, emoji")
      .order("name");
    cache = (data ?? []) as Subject[];
    inflight = null;
    subscribers.forEach((cb) => cb(cache!));
    return cache;
  })();
  return inflight;
}

/** Cached list of school subjects. Single fetch shared across all components. */
export function useSubjects() {
  const [subjects, setSubjects] = useState<Subject[]>(cache ?? []);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    let mounted = true;
    const cb = (s: Subject[]) => {
      if (mounted) setSubjects(s);
    };
    subscribers.add(cb);
    if (!cache) {
      loadSubjects().then(() => {
        if (mounted) setLoading(false);
      });
    }
    return () => {
      mounted = false;
      subscribers.delete(cb);
    };
  }, []);

  return { subjects, loading };
}
