-- PART 1
CREATE TABLE IF NOT EXISTS public.feedback_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  category text NOT NULL DEFAULT 'idea',
  message text NOT NULL,
  rating smallint,
  status text NOT NULL DEFAULT 'new',
  page_url text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.feedback_submissions TO authenticated;
GRANT ALL ON public.feedback_submissions TO service_role;
CREATE INDEX IF NOT EXISTS feedback_submissions_status_created_idx
  ON public.feedback_submissions (status, created_at DESC);
ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feedback_insert_own ON public.feedback_submissions;
CREATE POLICY feedback_insert_own ON public.feedback_submissions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS feedback_select_own_or_manager ON public.feedback_submissions;
CREATE POLICY feedback_select_own_or_manager ON public.feedback_submissions FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'manager'::app_role));
DROP POLICY IF EXISTS feedback_update_manager ON public.feedback_submissions;
CREATE POLICY feedback_update_manager ON public.feedback_submissions FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'manager'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'manager'::app_role));

ALTER TABLE public.tutor_details
  ADD COLUMN IF NOT EXISTS payout_frequency text,
  ADD COLUMN IF NOT EXISTS payout_weekday smallint,
  ADD COLUMN IF NOT EXISTS payout_monthday smallint,
  ADD COLUMN IF NOT EXISTS payout_anchor date,
  ADD COLUMN IF NOT EXISTS payout_last_marked_at timestamptz;

-- PART 2
CREATE OR REPLACE FUNCTION public.wallet_delete_transaction(_tx_id uuid, _hard boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tx public.student_wallet_transactions%ROWTYPE; _new_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'Only managers can delete wallet transactions';
  END IF;
  SELECT * INTO _tx FROM public.student_wallet_transactions WHERE id = _tx_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction not found'; END IF;
  IF _hard THEN
    DELETE FROM public.student_wallet_transactions WHERE id = _tx_id;
    RETURN _tx_id;
  ELSE
    INSERT INTO public.student_wallet_transactions
      (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
    VALUES (_tx.tutor_id, _tx.student_id, 'adjustment',
       -_tx.lessons_delta, -_tx.amount_delta, _tx.lesson_id,
       'Сторно: ' || COALESCE(_tx.note, _tx.kind), auth.uid())
    RETURNING id INTO _new_id;
    RETURN _new_id;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.mark_tutor_payouts_paid(_tutor_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'Only managers can mark payouts';
  END IF;
  UPDATE public.lesson_details ld
  SET tutor_payout_status = 'paid', tutor_paid_at = now()
  FROM public.lessons l
  WHERE l.id = ld.lesson_id AND l.tutor_id = _tutor_id
    AND COALESCE(ld.tutor_payout_status,'unpaid') = 'unpaid'
    AND l.status <> 'cancelled';
  GET DIAGNOSTICS _n = ROW_COUNT;
  UPDATE public.tutor_details SET payout_last_marked_at = now() WHERE user_id = _tutor_id;
  RETURN _n;
END; $$;
GRANT EXECUTE ON FUNCTION public.mark_tutor_payouts_paid(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.autofill_lesson_details_prices()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tutor_id uuid; _student_id uuid; _subject text; _rate numeric(10,2); _payout numeric(10,2);
BEGIN
  SELECT tutor_id, student_id, subject INTO _tutor_id, _student_id, _subject
  FROM public.lessons WHERE id = NEW.lesson_id;
  IF COALESCE(NEW.student_price,0) = 0 AND _student_id IS NOT NULL THEN
    SELECT price_per_lesson INTO _rate FROM public.student_rates
    WHERE tutor_id=_tutor_id AND student_id=_student_id
      AND lower(btrim(subject))=lower(btrim(COALESCE(_subject,'')))
    ORDER BY updated_at DESC NULLS LAST LIMIT 1;
    IF _rate IS NULL THEN
      SELECT price_per_lesson INTO _rate FROM public.student_rates
      WHERE tutor_id=_tutor_id AND student_id=_student_id
      ORDER BY updated_at DESC NULLS LAST LIMIT 1;
    END IF;
    IF _rate IS NOT NULL THEN NEW.student_price := _rate; END IF;
  END IF;
  IF COALESCE(NEW.tutor_payout,0) = 0 THEN
    SELECT rate_per_lesson INTO _payout FROM public.tutor_subject_rates
    WHERE tutor_id=_tutor_id AND lower(btrim(subject))=lower(btrim(COALESCE(_subject,''))) LIMIT 1;
    IF _payout IS NULL THEN
      SELECT rate_per_lesson INTO _payout FROM public.tutor_details WHERE user_id=_tutor_id;
    END IF;
    IF _payout IS NOT NULL THEN NEW.tutor_payout := _payout; END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP VIEW IF EXISTS public.lessons_visible;
CREATE VIEW public.lessons_visible WITH (security_invoker = true) AS
WITH caller AS (
  SELECT auth.uid() AS uid, public.has_role(auth.uid(),'manager'::app_role) AS is_manager
)
SELECT l.id, l.tutor_id, l.student_id, l.created_by, l.subject, l.subject_id,
  l.starts_at, l.duration_minutes, l.status, l.notes, l.source, l.lesson_type,
  l.group_id, l.created_at, l.updated_at, l.meeting_url, ld.homework, ld.summary,
  CASE WHEN c.is_manager OR c.uid=l.student_id THEN ld.student_notes ELSE NULL::text END AS student_notes,
  CASE WHEN c.is_manager OR c.uid=l.student_id OR (c.uid=l.tutor_id AND l.source='independent') THEN ld.student_price ELSE NULL::numeric END AS student_price,
  CASE WHEN c.is_manager OR c.uid=l.student_id OR (c.uid=l.tutor_id AND l.source='independent') THEN ld.student_payment_status ELSE NULL::text END AS student_payment_status,
  CASE WHEN c.is_manager OR c.uid=l.student_id OR (c.uid=l.tutor_id AND l.source='independent') THEN ld.student_paid_at ELSE NULL::timestamptz END AS student_paid_at,
  CASE WHEN c.is_manager OR c.uid=l.tutor_id THEN ld.tutor_payout ELSE NULL::numeric END AS tutor_payout,
  CASE WHEN c.is_manager OR c.uid=l.tutor_id THEN ld.tutor_payout_status ELSE NULL::text END AS tutor_payout_status,
  CASE WHEN c.is_manager OR c.uid=l.tutor_id THEN ld.tutor_paid_at ELSE NULL::timestamptz END AS tutor_paid_at
FROM public.lessons l
LEFT JOIN public.lesson_details ld ON ld.lesson_id = l.id
CROSS JOIN caller c;
GRANT SELECT ON public.lessons_visible TO authenticated;

-- PART 3
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
    ('spanish','Іспанська мова'),('іспанська','Іспанська мова'),('іспанська мова','Іспанська мова')
  ) AS m(key, canonical) ON m.key = lower(t.cleaned)
$$;

UPDATE public.lessons SET subject = public._canon_subject(subject)
WHERE subject IS NOT NULL AND subject <> public._canon_subject(subject);

UPDATE public.lesson_groups SET subject = public._canon_subject(subject)
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
) q
WHERE t.user_id=q.user_id
  AND q.new_subjects IS NOT NULL
  AND array_length(q.new_subjects, 1) > 0
  AND q.new_subjects IS DISTINCT FROM t.subjects;

DROP FUNCTION IF EXISTS public._canon_subject(text);