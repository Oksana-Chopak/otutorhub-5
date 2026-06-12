-- УНІФІКАЦІЯ ПРЕДМЕТІВ ДО УКРАЇНСЬКОЇ (рішення власниці).
-- Зводить усі написання одного предмета ('English', ' english ', 'АНГЛІЙСЬКА
-- МОВА') до одного канону ('Англійська мова') в усіх таблицях:
-- lessons.subject, groups.subject, tutor_subject_rates, student_rates,
-- tutor_public_details.subjects[]. Невідомі словнику назви лишаються як є,
-- лише чистяться пробіли. Дублікати ставок після зведення зливаються —
-- виживає найсвіжіша (updated_at), щоб не порушити unique-ключі.

-- Тимчасова канонізуюча функція (живе лише в цій сесії міграції)
CREATE FUNCTION pg_temp.canon_subject(_s text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(m.canonical, t.cleaned)
  FROM (SELECT btrim(regexp_replace(COALESCE(_s, ''), '\s+', ' ', 'g')) AS cleaned) t
  LEFT JOIN (VALUES
    ('english', 'Англійська мова'),
    ('english language', 'Англійська мова'),
    ('англійська', 'Англійська мова'),
    ('англійська мова', 'Англійська мова'),
    ('math', 'Математика'),
    ('maths', 'Математика'),
    ('mathematics', 'Математика'),
    ('математика', 'Математика'),
    ('ukrainian', 'Українська мова'),
    ('ukrainian language', 'Українська мова'),
    ('українська', 'Українська мова'),
    ('українська мова', 'Українська мова'),
    ('physics', 'Фізика'),
    ('фізика', 'Фізика'),
    ('chemistry', 'Хімія'),
    ('хімія', 'Хімія'),
    ('biology', 'Біологія'),
    ('біологія', 'Біологія'),
    ('history', 'Історія'),
    ('історія', 'Історія'),
    ('geography', 'Географія'),
    ('географія', 'Географія'),
    ('german', 'Німецька мова'),
    ('німецька', 'Німецька мова'),
    ('німецька мова', 'Німецька мова'),
    ('french', 'Французька мова'),
    ('французька', 'Французька мова'),
    ('французька мова', 'Французька мова'),
    ('spanish', 'Іспанська мова'),
    ('іспанська', 'Іспанська мова'),
    ('іспанська мова', 'Іспанська мова'),
    ('polish', 'Польська мова'),
    ('польська', 'Польська мова'),
    ('польська мова', 'Польська мова'),
    ('italian', 'Італійська мова'),
    ('італійська', 'Італійська мова'),
    ('італійська мова', 'Італійська мова'),
    ('programming', 'Програмування'),
    ('програмування', 'Програмування'),
    ('informatics', 'Інформатика'),
    ('computer science', 'Інформатика'),
    ('інформатика', 'Інформатика'),
    ('literature', 'Література'),
    ('література', 'Література'),
    ('music', 'Музика'),
    ('музика', 'Музика'),
    ('art', 'Малювання'),
    ('drawing', 'Малювання'),
    ('малювання', 'Малювання'),
    ('chess', 'Шахи'),
    ('шахи', 'Шахи'),
    ('economics', 'Економіка'),
    ('економіка', 'Економіка')
  ) AS m(key, canonical) ON m.key = lower(t.cleaned)
$$;

-- 1) Уроки
UPDATE public.lessons
SET subject = pg_temp.canon_subject(subject)
WHERE subject IS NOT NULL
  AND subject <> pg_temp.canon_subject(subject);

-- 2) Групи
UPDATE public.groups
SET subject = pg_temp.canon_subject(subject)
WHERE subject IS NOT NULL
  AND subject <> pg_temp.canon_subject(subject);

-- 3) Предметні ставки репетитора: спершу злити дублікати (виживає найсвіжіша)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY tutor_id, lower(pg_temp.canon_subject(subject))
           ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
         ) AS rn
  FROM public.tutor_subject_rates
)
DELETE FROM public.tutor_subject_rates t
USING ranked r
WHERE t.id = r.id AND r.rn > 1;

UPDATE public.tutor_subject_rates
SET subject = pg_temp.canon_subject(subject)
WHERE subject <> pg_temp.canon_subject(subject);

-- 4) Ставки учнів: те саме в межах пари (tutor, student)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY tutor_id, student_id, lower(pg_temp.canon_subject(subject))
           ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
         ) AS rn
  FROM public.student_rates
)
DELETE FROM public.student_rates s
USING ranked r
WHERE s.id = r.id AND r.rn > 1;

UPDATE public.student_rates
SET subject = pg_temp.canon_subject(subject)
WHERE subject <> pg_temp.canon_subject(subject);

-- 5) Публічний профіль репетитора: масив предметів
UPDATE public.tutor_public_details t
SET subjects = q.new_subjects
FROM (
  SELECT user_id,
         (SELECT array_agg(DISTINCT pg_temp.canon_subject(u) ORDER BY pg_temp.canon_subject(u))
          FROM unnest(subjects) AS u
          WHERE btrim(COALESCE(u, '')) <> '') AS new_subjects
  FROM public.tutor_public_details
  WHERE subjects IS NOT NULL
) q
WHERE t.user_id = q.user_id
  AND q.new_subjects IS DISTINCT FROM t.subjects;
