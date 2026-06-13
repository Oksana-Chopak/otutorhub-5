-- ╔═══ ЧАСТИНА 3 з 3 · ВІДНОВЛЕННЯ ДАНИХ (виконати останньою) ═══╗
-- Повертає ціни 600₴ і зводить предмети до української. Безпечна, не перетирає
-- ненульові ціни. Тут НЕМАЄ pg_temp (саме він зупиняв попередній скрипт) —
-- звичайна функція public._canon_subject, яку видаляємо в кінці.

-- A. Backfill цін із legacy-колонок (де details порожні)
UPDATE public.lesson_details ld SET student_price = l.student_price
FROM public.lessons l WHERE l.id = ld.lesson_id
  AND COALESCE(ld.student_price,0)=0 AND COALESCE(l.student_price,0)>0;
UPDATE public.lesson_details ld SET tutor_payout = l.tutor_payout
FROM public.lessons l WHERE l.id = ld.lesson_id
  AND COALESCE(ld.tutor_payout,0)=0 AND COALESCE(l.tutor_payout,0)>0;

-- B. Ретро-заповнення цін зі ставок (де legacy теж порожній)
UPDATE public.lesson_details ld SET student_price = pick.price
FROM public.lessons l JOIN LATERAL (
  SELECT sr.price_per_lesson AS price FROM public.student_rates sr
  WHERE sr.tutor_id=l.tutor_id AND sr.student_id=l.student_id AND COALESCE(sr.price_per_lesson,0)>0
  ORDER BY (lower(btrim(sr.subject))=lower(btrim(COALESCE(l.subject,'')))) DESC, sr.updated_at DESC NULLS LAST
  LIMIT 1
) pick ON true
WHERE l.id=ld.lesson_id AND COALESCE(ld.student_price,0)=0;

UPDATE public.lesson_details ld SET tutor_payout = pick.rate
FROM public.lessons l JOIN LATERAL (
  SELECT tsr.rate_per_lesson AS rate FROM public.tutor_subject_rates tsr
  WHERE tsr.tutor_id=l.tutor_id AND lower(btrim(tsr.subject))=lower(btrim(COALESCE(l.subject,''))) AND COALESCE(tsr.rate_per_lesson,0)>0
  LIMIT 1
) pick ON true
WHERE l.id=ld.lesson_id AND COALESCE(ld.tutor_payout,0)=0;

-- C. Канонізуюча функція (звичайна, не pg_temp)
CREATE OR REPLACE FUNCTION public._canon_subject(_s text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(m.canonical, t.cleaned)
  FROM (SELECT btrim(regexp_replace(COALESCE(_s,''), '\s+', ' ', 'g')) AS cleaned) t
  LEFT JOIN (VALUES
    ('english','Англійська мова'),('english language','Англійська мова'),
    ('англійська','Англійська мова'),('англійська мова','Англійська мова'),
    ('math','Математика'),('maths','Математика'),('mathematics','Математика'),('математика','Математика'),
    ('ukrainian','Українська мова'),('ukrainian language','Українська мова'),
    ('українська','Українська мова'),('українська мова','Українська мова'),
    ('physics','Фізика'),('фізика','Фізика'),
    ('chemistry','Хімія'),('хімія','Хімія'),
    ('biology','Біологія'),('біологія','Біологія'),
    ('history','Історія'),('історія','Історія'),
    ('geography','Географія'),('географія','Географія'),
    ('german','Німецька мова'),('німецька','Німецька мова'),('німецька мова','Німецька мова'),
    ('french','Французька мова'),('французька','Французька мова'),('французька мова','Французька мова'),
    ('spanish','Іспанська мова'),('іспанська','Іспанська мова'),('іспанська мова','Іспанська мова'),
    ('polish','Польська мова'),('польська','Польська мова'),('польська мова','Польська мова'),
    ('italian','Італійська мова'),('італійська','Італійська мова'),('італійська мова','Італійська мова'),
    ('programming','Програмування'),('програмування','Програмування'),
    ('informatics','Інформатика'),('computer science','Інформатика'),('інформатика','Інформатика'),
    ('literature','Література'),('література','Література'),
    ('music','Музика'),('музика','Музика'),
    ('art','Малювання'),('drawing','Малювання'),('малювання','Малювання'),
    ('chess','Шахи'),('шахи','Шахи'),
    ('economics','Економіка'),('економіка','Економіка')
  ) AS m(key, canonical) ON m.key = lower(t.cleaned)
$$;

-- D. Уніфікація предметів до української
UPDATE public.lessons SET subject = public._canon_subject(subject)
WHERE subject IS NOT NULL AND subject <> public._canon_subject(subject);

UPDATE public.groups SET subject = public._canon_subject(subject)
WHERE subject IS NOT NULL AND subject <> public._canon_subject(subject);

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY tutor_id, lower(public._canon_subject(subject))
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC) AS rn
  FROM public.tutor_subject_rates
) DELETE FROM public.tutor_subject_rates t USING ranked r WHERE t.id=r.id AND r.rn>1;
UPDATE public.tutor_subject_rates SET subject = public._canon_subject(subject)
WHERE subject <> public._canon_subject(subject);

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY tutor_id, student_id, lower(public._canon_subject(subject))
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC) AS rn
  FROM public.student_rates
) DELETE FROM public.student_rates s USING ranked r WHERE s.id=r.id AND r.rn>1;
UPDATE public.student_rates SET subject = public._canon_subject(subject)
WHERE subject <> public._canon_subject(subject);

UPDATE public.tutor_public_details t SET subjects = q.new_subjects
FROM (
  SELECT user_id,
    (SELECT array_agg(DISTINCT public._canon_subject(u) ORDER BY public._canon_subject(u))
     FROM unnest(subjects) AS u WHERE btrim(COALESCE(u,'')) <> '') AS new_subjects
  FROM public.tutor_public_details WHERE subjects IS NOT NULL
) q WHERE t.user_id=q.user_id AND q.new_subjects IS DISTINCT FROM t.subjects;

-- E. Прибираємо тимчасову функцію
DROP FUNCTION IF EXISTS public._canon_subject(text);
