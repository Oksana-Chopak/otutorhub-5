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

/**
 * Серверні позначки учня, обʼєднані з локальним кешем (union: позначене
 * будь-де рахується виконаним; локальні «сироти» доливаються на сервер
 * best-effort — так старі позначки з часів localStorage доїжджають до
 * репетитора при першому ж відкритті).
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
  const orphans = Array.from(local).filter((id) => !server.has(id));
  if (orphans.length) {
    void (supabase as any)
      .from("homework_done")
      .upsert(orphans.map((lesson_id) => ({ lesson_id, student_id: userId })), {
        onConflict: "lesson_id,student_id",
        ignoreDuplicates: true,
      })
      .then(() => { /* RLS відкине чужі/неіснуючі уроки — і нехай */ });
  }
  const merged = new Set([...server, ...local]);
  writeHomeworkDone(userId, merged);
  return merged;
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
