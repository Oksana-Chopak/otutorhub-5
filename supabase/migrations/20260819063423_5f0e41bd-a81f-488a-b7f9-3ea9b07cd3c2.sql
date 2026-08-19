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
GRANT ALL ON public.subject_canon TO service_role;

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

DELETE FROM public.tutor_subject_rates a
USING (
  SELECT ctid, row_number() OVER (
    PARTITION BY tutor_id, public.normalize_subject(subject)
    ORDER BY COALESCE(rate_per_lesson,0) DESC, ctid
  ) AS rn
  FROM public.tutor_subject_rates
) r
WHERE a.ctid = r.ctid AND r.rn > 1;

DELETE FROM public.student_rates a
USING (
  SELECT ctid, row_number() OVER (
    PARTITION BY tutor_id, student_id, public.normalize_subject(subject)
    ORDER BY COALESCE(price_per_lesson,0) DESC, ctid
  ) AS rn
  FROM public.student_rates
) r
WHERE a.ctid = r.ctid AND r.rn > 1;

UPDATE public.lessons l SET subject = c.display
FROM public.subject_canon c
WHERE public.normalize_subject(l.subject) = c.norm AND l.subject IS DISTINCT FROM c.display;

UPDATE public.student_rates r SET subject = c.display
FROM public.subject_canon c
WHERE public.normalize_subject(r.subject) = c.norm AND r.subject IS DISTINCT FROM c.display;

UPDATE public.tutor_subject_rates r SET subject = c.display
FROM public.subject_canon c
WHERE public.normalize_subject(r.subject) = c.norm AND r.subject IS DISTINCT FROM c.display;

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

DROP POLICY IF EXISTS subject_canon_read ON public.subject_canon;
CREATE POLICY subject_canon_read ON public.subject_canon
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.subject_canon(norm, display)
SELECT public.normalize_subject(s), btrim(s)
FROM (SELECT unnest(subjects) AS s FROM public.tutor_details WHERE subjects IS NOT NULL) u
WHERE btrim(coalesce(s,'')) <> ''
ON CONFLICT (norm) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.lesson_tutor_notes (
  lesson_id  uuid PRIMARY KEY REFERENCES public.lessons(id) ON DELETE CASCADE,
  notes      text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lesson_tutor_notes TO authenticated;
GRANT ALL ON public.lesson_tutor_notes TO service_role;
ALTER TABLE public.lesson_tutor_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lesson_tutor_notes_owner ON public.lesson_tutor_notes;
CREATE POLICY lesson_tutor_notes_owner ON public.lesson_tutor_notes
  FOR ALL USING (EXISTS (SELECT 1 FROM public.lessons l WHERE l.id = lesson_id AND l.tutor_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.lessons l WHERE l.id = lesson_id AND l.tutor_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.tutor_student_notes (
  tutor_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  notes      text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tutor_id, student_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tutor_student_notes TO authenticated;
GRANT ALL ON public.tutor_student_notes TO service_role;
ALTER TABLE public.tutor_student_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tutor_student_notes_owner ON public.tutor_student_notes;
CREATE POLICY tutor_student_notes_owner ON public.tutor_student_notes
  FOR ALL USING (tutor_id = auth.uid()) WITH CHECK (tutor_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint   TEXT        NOT NULL,
  p256dh     TEXT        NOT NULL,
  auth       TEXT        NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, endpoint)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "own push subscriptions" ON public.push_subscriptions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.manager_debts_summary()
RETURNS TABLE (students_debt numeric, students_count int, payouts_owed numeric, payouts_count int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'managers only';
  END IF;

  RETURN QUERY
  WITH indiv AS (
    SELECT ld.student_price AS amt
    FROM public.lessons l JOIN public.lesson_details ld ON ld.lesson_id = l.id
    WHERE (l.source IS DISTINCT FROM 'independent')
      AND l.group_id IS NULL
      AND ld.student_payment_status = 'unpaid'
      AND coalesce(ld.student_price,0) > 0
      AND ( l.status IN ('completed','scheduled')
         OR (l.status = 'cancelled' AND coalesce(ld.is_cancellation_fee,false)) )
  ),
  grp AS (
    SELECT lp.student_price AS amt
    FROM public.lesson_participants lp
    JOIN public.lessons l ON l.id = lp.lesson_id
    WHERE (l.source IS DISTINCT FROM 'independent')
      AND l.status IN ('completed','scheduled')
      AND lp.student_payment_status = 'unpaid'
      AND coalesce(lp.student_price,0) > 0
  ),
  owed AS (
    SELECT ld.tutor_payout AS amt
    FROM public.lessons l JOIN public.lesson_details ld ON ld.lesson_id = l.id
    WHERE (l.source IS DISTINCT FROM 'independent')
      AND l.group_id IS NULL
      AND coalesce(ld.tutor_payout_status,'unpaid') <> 'paid'
      AND coalesce(ld.tutor_payout,0) > 0
      AND l.status NOT IN ('cancelled','pending')
      AND (l.status = 'completed' OR l.starts_at <= now())
  )
  SELECT
    coalesce((SELECT sum(amt) FROM indiv),0) + coalesce((SELECT sum(amt) FROM grp),0),
    (SELECT count(*) FROM indiv)::int + (SELECT count(*) FROM grp)::int,
    coalesce((SELECT sum(amt) FROM owed),0),
    (SELECT count(*) FROM owed)::int;
END $$;

REVOKE EXECUTE ON FUNCTION public.manager_debts_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_debts_summary() TO authenticated;