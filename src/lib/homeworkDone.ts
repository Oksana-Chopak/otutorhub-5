import { supabase } from "@/integrations/supabase/client";

/**
 * №16 (ідеї 01.09): «домашку виконано» — тепер СПРАВЖНЯ позначка в БД
 * (public.homework_done), яку бачить репетитор. localStorage лишається
 * кешем/фолбеком: до застосування міграції і без мережі поведінка не гірша,
 * ніж була (личный чекліст пристрою).
 *
 * Історія: раніше це був ТІЛЬКИ localStorage цього пристрою — учень тисне
 * «виконано», лічильник падає, а репетитор не дізнається ніколи, і на іншому
 * телефоні позначка зникає.
 */
const keyFor = (userId: string) => `tutorhub.hwDone.${userId}`;
/* Аудит 02.09: прапорець «старий локальний список уже перелито на сервер».
   Без нього кожне відкриття сторінки заливало локальні позначки назад — і
   зняти домашку було технічно неможливо (див. коментар у fetchHomeworkDone). */
const migratedKeyFor = (userId: string) => `tutorhub.hwDone.migrated.${userId}`;

export function readHomeworkDone(userId: string | undefined | null): Set<string> {
  if (!userId) return new Set();
  try {
    const raw = localStorage.getItem(keyFor(userId));
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function writeHomeworkDone(userId: string, ids: Set<string>): void {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(Array.from(ids)));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

function isMigrated(userId: string): boolean {
  try {
    return localStorage.getItem(migratedKeyFor(userId)) === "1";
  } catch {
    return false;
  }
}

function markMigrated(userId: string): void {
  try {
    localStorage.setItem(migratedKeyFor(userId), "1");
  } catch {
    /* storage unavailable — тоді просто спробуємо ще раз наступного разу */
  }
}

/**
 * Серверні позначки учня. ПІСЛЯ успішного читання сервер — єдине джерело
 * правди: те, чого на сервері немає, вважається невиконаним.
 *
 * Чому не union (аудит 02.09): правило «позначене будь-де = виконано» робило
 * зняття позначки неможливим. Учень знімає домашку на телефоні А (сервер
 * очищено), відкриває телефон Б — там у localStorage ще лежить старий id,
 * union повертає його «виконаним» і best-effort доливка заливає рядок назад
 * на сервер. Галочка воскресає, і жодним способом її не прибрати.
 *
 * Старі позначки з часів «тільки localStorage» доїжджають на сервер РІВНО
 * ОДИН раз на пристрій (прапорець migrated) — далі локальний кеш лише
 * дзеркалить сервер.
 */
export async function fetchHomeworkDone(userId: string | undefined | null): Promise<Set<string>> {
  const local = readHomeworkDone(userId);
  if (!userId) return local;
  const { data, error } = await (supabase as any)
    .from("homework_done")
    .select("lesson_id")
    .eq("student_id", userId);
  if (error || !data) return local; // міграція ще не застосована / офлайн
  const server = new Set<string>((data as Array<{ lesson_id: string }>).map((r) => r.lesson_id));

  if (!isMigrated(userId)) {
    const orphans = Array.from(local).filter((id) => !server.has(id));
    if (orphans.length) {
      /* Порядково, не однією пачкою: у batch-upsert один урок, відкинутий
         RLS або FK (чужий/видалений урок), валив ВЕСЬ переліт — і чесні
         позначки губилися разом із ним. allSettled: що доїхало — доїхало. */
      const results = await Promise.allSettled(
        orphans.map((lesson_id) =>
          (supabase as any)
            .from("homework_done")
            .upsert({ lesson_id, student_id: userId }, {
              onConflict: "lesson_id,student_id",
              ignoreDuplicates: true,
            }),
        ),
      );
      results.forEach((r, i) => {
        const ok = r.status === "fulfilled" && !(r.value as any)?.error;
        if (ok) server.add(orphans[i]);
      });
    }
    markMigrated(userId);
  }

  writeHomeworkDone(userId, server);
  return server;
}

/**
 * Поставити/зняти позначку: сервер + локальний кеш. Повертає true, якщо
 * СЕРВЕР прийняв (для чесного тосту «репетитор побачить»); false — якщо
 * лишилось тільки локально.
 */
export async function setHomeworkDoneServer(
  userId: string,
  lessonId: string,
  done: boolean,
): Promise<boolean> {
  const local = readHomeworkDone(userId);
  if (done) local.add(lessonId); else local.delete(lessonId);
  writeHomeworkDone(userId, local);

  const res = done
    ? await (supabase as any)
        .from("homework_done")
        .upsert({ lesson_id: lessonId, student_id: userId }, { onConflict: "lesson_id,student_id", ignoreDuplicates: true })
    : await (supabase as any)
        .from("homework_done")
        .delete()
        .eq("lesson_id", lessonId)
        .eq("student_id", userId);
  return !res.error;
}
