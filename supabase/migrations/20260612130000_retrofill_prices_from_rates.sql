-- РЕТРО-ЗАПОВНЕННЯ ЦІН ЗІ СТАВОК (друга хвиля відновлення «600 → 0»).
-- Перший backfill копіював із legacy-колонок lessons — але уроки, створені
-- репетитором через швидкі форми, в legacy ціни НЕ мали взагалі: їхня правда
-- завжди жила у СТАВКАХ (student_rates 600₴ під 'English'), а тригер-autofill
-- промахувався через інше написання предмета ('Англійська мова').
-- Толерантний autofill уже виправлено для НОВИХ уроків (20260612121000);
-- цей файл застосовує ту саму логіку до ІСНУЮЧИХ нульових записів:
--   пріоритет — ставка з ci/trim-збігом предмета, інакше остання ставка пари.

UPDATE public.lesson_details ld
SET student_price = pick.price
FROM public.lessons l
JOIN LATERAL (
  SELECT sr.price_per_lesson AS price
  FROM public.student_rates sr
  WHERE sr.tutor_id = l.tutor_id
    AND sr.student_id = l.student_id
    AND COALESCE(sr.price_per_lesson, 0) > 0
  ORDER BY (lower(btrim(sr.subject)) = lower(btrim(COALESCE(l.subject, '')))) DESC,
           sr.updated_at DESC NULLS LAST
  LIMIT 1
) pick ON true
WHERE l.id = ld.lesson_id
  AND COALESCE(ld.student_price, 0) = 0;

-- Виплата репетитору: спершу ci-збіг по предметній ставці…
UPDATE public.lesson_details ld
SET tutor_payout = pick.rate
FROM public.lessons l
JOIN LATERAL (
  SELECT tsr.rate_per_lesson AS rate
  FROM public.tutor_subject_rates tsr
  WHERE tsr.tutor_id = l.tutor_id
    AND lower(btrim(tsr.subject)) = lower(btrim(COALESCE(l.subject, '')))
    AND COALESCE(tsr.rate_per_lesson, 0) > 0
  LIMIT 1
) pick ON true
WHERE l.id = ld.lesson_id
  AND COALESCE(ld.tutor_payout, 0) = 0;

-- …потім загальна ставка репетитора для тих, що лишились нульовими.
UPDATE public.lesson_details ld
SET tutor_payout = td.rate_per_lesson
FROM public.lessons l
JOIN public.tutor_details td ON td.user_id = l.tutor_id
WHERE l.id = ld.lesson_id
  AND COALESCE(ld.tutor_payout, 0) = 0
  AND COALESCE(td.rate_per_lesson, 0) > 0;
