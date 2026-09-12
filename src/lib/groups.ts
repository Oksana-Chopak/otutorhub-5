import { supabase } from "@/integrations/supabase/client";

/**
 * Створення групи — ОДНЕ місце на застосунок (UI CANON, CLAUDE.md).
 *
 * Було (баг, знайдений 12.09 зі слів власниці «у груповому уроці можу обрати
 * лише одного, додавати теж не можу»): зібрати урок на кількох учнів можна було
 * тільки так — піти в «Групи», створити групу майстром, додати туди учасників,
 * повернутись у розклад і аж тоді створити урок. У самій формі уроку про це не
 * було ні слова: перемикач «Група» зʼявлявся ЛИШЕ якщо група вже існує, тож
 * репетиторка, яка жодної не має, бачила список учнів з вибором рівно одного.
 *
 * Тепер групу можна зібрати прямо у формі уроку — але запис іде через цю
 * функцію, а не другою копією логіки.
 *
 * ГРОШІ: ціна за урок у групі свідомо лишається NULL. Індивідуальна ставка
 * учня — ІНША величина (групова зазвичай нижча), і підставити її означало б
 * тихо виставити неправильну суму. Інваріант CLAUDE.md: відсутнє значення
 * рендериться як відсутнє, ніколи не підміняється сусіднім полем. Ціну
 * репетиторка ставить на пігулці учасника, а до того урок чесно потрапляє
 * в задачу «уроки без ціни».
 */
export interface CreateGroupInput {
  /** Чия це група. Для менеджера — обраний репетитор, не він сам. */
  tutorId: string;
  name: string;
  subject?: string | null;
  subjectId?: string | null;
  /** Кого одразу зарахувати. Порожній масив — теж валідний (група «на потім»). */
  studentIds?: string[];
}

export interface CreateGroupResult {
  groupId: string | null;
  error: string | null;
  /** Скільки учнів реально зараховано (може бути менше за передане, якщо RLS відмовила). */
  enrolled: number;
}

export async function createGroupWithStudents(input: CreateGroupInput): Promise<CreateGroupResult> {
  const name = input.name.trim();
  if (!input.tutorId || !name) return { groupId: null, error: "name_required", enrolled: 0 };

  const { data: created, error } = await supabase
    .from("lesson_groups")
    .insert({
      tutor_id: input.tutorId,
      name,
      subject: input.subject || null,
      subject_id: input.subjectId || null,
    })
    .select("id")
    .single();

  if (error || !created) return { groupId: null, error: error?.message ?? "insert_failed", enrolled: 0 };
  const groupId = (created as { id: string }).id;

  const ids = Array.from(new Set(input.studentIds ?? [])).filter(Boolean);
  if (ids.length === 0) return { groupId, error: null, enrolled: 0 };

  // Ціна null — свідомо (див. шапку). Статус active: зарахування і Є актом
  // «цей учень у цій групі».
  const { error: enrErr } = await supabase.from("group_enrollments").insert(
    ids.map((student_id) => ({ group_id: groupId, student_id, status: "active", price_per_lesson: null })),
  );

  // Група вже створена — якщо частина зарахувань не пройшла, це НЕ привід
  // відкотити все: краще група з меншою кількістю учасників і чесне число,
  // ніж мовчазна втрата всього кроку.
  return { groupId, error: enrErr?.message ?? null, enrolled: enrErr ? 0 : ids.length };
}
