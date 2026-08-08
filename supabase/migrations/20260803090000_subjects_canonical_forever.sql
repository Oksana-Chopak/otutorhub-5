-- SUBJECTS: раз і назавжди. Предмет — вільний текст у 3 таблицях, тому будь-які
-- дві поверхні могли писати його по-різному, і матчинг ставок/цін розсипався.
-- Рішення на рівні БД (покриває ВСІ поверхні, теперішні й майбутні):
--   1) normalize_subject(): регістр, зайві пробіли, кінцеві крапки.
--   2) Реєстр subject_canon: одна канонічна форма написання на предмет.
--   3) BEFORE-тригери на lessons / student_rates / tutor_subject_rates:
--      будь-який запис «прилипає» до канонічного написання; нове — реєструється.
--   4) Разове злиття історії (з дедуплікацією рейтів, щоб не впертись в unique).
-- Свідомо РІЗНІ формулювання («Математика» vs «Матем. 7 клас») лишаються
-- різними предметами — це вже семантика, і звіт нульових виплат її називає.
-- Idempotent.

CREATE OR REPLACE FUNCTION public.normalize_subject(t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(regexp_replace(regexp_replace(btrim(coalesce(t,'')), '\s+', ' ', 'g'), '[\s.]+$', ''))
$$;

CREATE TABLE IF NOT EXISTS public.subject_canon (
  norm    text PRIMARY KEY,
  display text NOT NULL
);
ALTER TABLE public.subject_canon ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.subject_canon TO authenticated;

-- Сід: для кожної нормалізованої форми — найчастіше вживане написання
WITH all_s AS (
  SELECT subject FROM public.lessons              WHERE subject IS NOT NULL AND btrim(subject) <> ''
  UNION ALL
  SELECT subject FROM public.student_rates        WHERE subject IS NOT NULL AND btrim(subject) <> ''
  UNION ALL
  SELECT subject FROM public.tutor_subject_rates  WHERE subject IS NOT NULL AND btrim(subject) <> ''
),
counted AS (
  SELECT public.normalize_subject(subject) AS norm, btrim(subject) AS display, count(*) AS n
  FROM all_s GROUP BY 1, 2
),
ranked AS (
  SELECT norm, display, row_number() OVER (PARTITION BY norm ORDER BY n DESC, display) AS rn
  FROM counted WHERE norm <> ''
)
INSERT INTO public.subject_canon(norm, display)
SELECT norm, display FROM ranked WHERE rn = 1
ON CONFLICT (norm) DO NOTHING;

CREATE OR REPLACE FUNCTION public.subject_canon_apply()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n text; _d text;
BEGIN
  IF NEW.subject IS NULL OR btrim(NEW.subject) = '' THEN RETURN NEW; END IF;
  _n := public.normalize_subject(NEW.subject);
  SELECT display INTO _d FROM public.subject_canon WHERE norm = _n;
  IF _d IS NULL THEN
    INSERT INTO public.subject_canon(norm, display) VALUES (_n, btrim(NEW.subject))
    ON CONFLICT (norm) DO NOTHING;
    SELECT display INTO _d FROM public.subject_canon WHERE norm = _n;
  END IF;
  NEW.subject := _d;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_subject_canon ON public.lessons;
CREATE TRIGGER trg_subject_canon BEFORE INSERT OR UPDATE OF subject ON public.lessons
FOR EACH ROW EXECUTE FUNCTION public.subject_canon_apply();

DROP TRIGGER IF EXISTS trg_subject_canon ON public.student_rates;
CREATE TRIGGER trg_subject_canon BEFORE INSERT OR UPDATE OF subject ON public.student_rates
FOR EACH ROW EXECUTE FUNCTION public.subject_canon_apply();

DROP TRIGGER IF EXISTS trg_subject_canon ON public.tutor_subject_rates;
CREATE TRIGGER trg_subject_canon BEFORE INSERT OR UPDATE OF subject ON public.tutor_subject_rates
FOR EACH ROW EXECUTE FUNCTION public.subject_canon_apply();

-- Разове злиття історії. Спершу дедуп рейтів (той самий предмет у різних
-- написаннях у одного репетитора/пари) — лишаємо перший рядок.
DELETE FROM public.tutor_subject_rates a
USING public.tutor_subject_rates b
WHERE a.tutor_id = b.tutor_id
  AND public.normalize_subject(a.subject) = public.normalize_subject(b.subject)
  AND a.ctid > b.ctid;

DELETE FROM public.student_rates a
USING public.student_rates b
WHERE a.tutor_id = b.tutor_id AND a.student_id = b.student_id
  AND public.normalize_subject(a.subject) = public.normalize_subject(b.subject)
  AND a.ctid > b.ctid;

UPDATE public.lessons l SET subject = c.display
FROM public.subject_canon c
WHERE public.normalize_subject(l.subject) = c.norm AND l.subject IS DISTINCT FROM c.display;

UPDATE public.student_rates r SET subject = c.display
FROM public.subject_canon c
WHERE public.normalize_subject(r.subject) = c.norm AND r.subject IS DISTINCT FROM c.display;

UPDATE public.tutor_subject_rates r SET subject = c.display
FROM public.subject_canon c
WHERE public.normalize_subject(r.subject) = c.norm AND r.subject IS DISTINCT FROM c.display;

-- Після злиття написань — добити виплати, які через це не матчились:
UPDATE public.lesson_details ld
SET tutor_payout = tsr.rate_per_lesson
FROM public.lessons l
JOIN public.tutor_subject_rates tsr
  ON tsr.tutor_id = l.tutor_id AND tsr.subject = l.subject
WHERE l.id = ld.lesson_id
  AND (l.source = 'hub' OR l.source IS NULL)
  AND COALESCE(ld.tutor_payout,0) = 0
  AND COALESCE(ld.tutor_payout_status,'unpaid') <> 'paid'
  AND COALESCE(tsr.rate_per_lesson,0) > 0;
