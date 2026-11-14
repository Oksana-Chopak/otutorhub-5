import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { deviceTimeZone } from "@/lib/timeZone";

/* Пояси інших людей (14.11). Читаються RPC `people_timezones` — під RLS таблиці profiles, тобто
   лише тих, кого людина й так бачить. Поки міграцію не вставлено (або людина ще не заходила) —
   пояс невідомий, і екран нічого про нього не каже: відсутнє рендериться як відсутнє. */

const cache = new Map<string, string | null>();     // id → пояс | null («питали, немає»)
const MEMO = "oth_tz_";

/** Записати пояс пристрою у свій профіль. Раз на зміну поясу; збій не заважає роботі. */
export async function syncMyTimeZone(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  const tz = deviceTimeZone();
  cache.set(userId, tz);
  try {
    if (localStorage.getItem(MEMO + userId) === tz) return;
  } catch { /* приватний режим — просто запишемо ще раз */ }
  // cast: функція зʼявиться у згенерованих типах після міграції 20261114120000
  const { error } = await (supabase as any).rpc("set_my_timezone", { _tz: tz });
  if (error) return;                                   // немає функції / мережі — спробуємо наступного разу
  try { localStorage.setItem(MEMO + userId, tz); } catch { /* приватний режим */ }
}

async function fetchZones(ids: string[]): Promise<void> {
  const need = ids.filter((id) => !cache.has(id));
  if (!need.length) return;
  const { data, error } = await (supabase as any).rpc("people_timezones", { _ids: need });
  if (error) return;                                   // функції ще немає — лишаємо «невідомо», спитаємо знову
  for (const id of need) cache.set(id, null);
  for (const r of (data ?? []) as Array<{ user_id: string; timezone: string | null }>) cache.set(r.user_id, r.timezone);
}

/** Пояси людей за їхніми id: `{ [id]: "Europe/Kyiv" }`; кого не знаємо — того в обʼєкті немає. */
export function useTimeZones(ids: Array<string | null | undefined>): Record<string, string> {
  const key = useMemo(() => Array.from(new Set(ids.filter((x): x is string => !!x))).sort().join(","), [ids]);
  const [, bump] = useState(0);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void fetchZones(key.split(",")).then(() => { if (alive) bump((n) => n + 1); });
    return () => { alive = false; };
  }, [key]);
  const out: Record<string, string> = {};
  for (const id of key ? key.split(",") : []) {
    const tz = cache.get(id);
    if (tz) out[id] = tz;
  }
  return out;
}

/** Для тестів. */
export function __resetTimeZoneCache(): void { cache.clear(); }
