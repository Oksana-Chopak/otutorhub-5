-- ВІДНОВЛЕННЯ ЦІН (інцидент «600₴ → 0», уроки створені репетитором/менеджером):
-- Створення уроку в SchedulePage писало ціну в legacy-колонки таблиці lessons,
-- а тригер ensure_lesson_details створював рядок lesson_details зі student_price=0;
-- autofill міг не зматчити ставку через різні написання предмета
-- ('English' vs 'Англійська мова'). Поки view читав legacy — цього не було видно;
-- після відновлення правильного view (читає lesson_details) такі уроки показують 0.
--
-- Консервативний backfill: переносимо ЛИШЕ ціни, ЛИШЕ туди, де в details
-- порожньо/нуль, і ніколи не перетираємо ненульові значення в details.

UPDATE public.lesson_details ld
SET student_price = l.student_price
FROM public.lessons l
WHERE l.id = ld.lesson_id
  AND COALESCE(ld.student_price, 0) = 0
  AND COALESCE(l.student_price, 0) > 0;

UPDATE public.lesson_details ld
SET tutor_payout = l.tutor_payout
FROM public.lessons l
WHERE l.id = ld.lesson_id
  AND COALESCE(ld.tutor_payout, 0) = 0
  AND COALESCE(l.tutor_payout, 0) > 0;

-- Статуси оплат свідомо НЕ чіпаємо: ними керує застосунок у lesson_details,
-- і автоматичне перенесення могло б перезаписати реальні зміни.
