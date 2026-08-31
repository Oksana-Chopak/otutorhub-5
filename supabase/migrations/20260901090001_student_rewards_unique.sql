/* ============================================================================
   B5 (хвиля якості 31.08): одна нагорода учня на один урок — гарантія БД.

   «Позначити проведеним» без disabled + повторний виклик award() дарували
   учневі ДВІ нагороди за той самий урок (client-side дедупу не було, UNIQUE —
   теж). Кнопку заблоковано на клієнті; це — серверна половина гарантії.

   1) Дедуп наявних дублів: лишаємо найранішу нагороду на (lesson_id, student_id).
   2) UNIQUE-констрейнт. lesson_id IS NULL (нагороди без уроку) не обмежується:
      у Postgres NULL-и в UNIQUE вважаються різними (NULLS DISTINCT за замовч.).
   Клієнт пише через upsert(onConflict: "lesson_id,student_id",
   ignoreDuplicates) з фолбеком на insert до застосування цієї міграції.

   Timestamp строго вище останнього застосованого (ordering trap).
   ============================================================================ */

DELETE FROM public.student_rewards a
USING public.student_rewards b
WHERE a.lesson_id IS NOT NULL
  AND b.lesson_id = a.lesson_id
  AND b.student_id = a.student_id
  AND (b.created_at < a.created_at OR (b.created_at = a.created_at AND b.id < a.id));

ALTER TABLE public.student_rewards
  ADD CONSTRAINT student_rewards_lesson_student_unique UNIQUE (lesson_id, student_id);
