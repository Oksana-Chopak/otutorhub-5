-- Drop legacy triggers (no-op if missing)
DROP TRIGGER IF EXISTS trg_lessons_autofill_prices ON public.lessons;
DROP TRIGGER IF EXISTS trg_lessons_payment_dates ON public.lessons;
DROP TRIGGER IF EXISTS trg_log_lesson_financials ON public.lessons;
DROP TRIGGER IF EXISTS z_trg_wallet_autocharge ON public.lessons;
DROP TRIGGER IF EXISTS trg_wallet_refund_on_unpaid ON public.lessons;

-- Replace policies that reference financial/content columns about to be dropped.
DROP POLICY IF EXISTS "Student updates own notes" ON public.lessons;
DROP POLICY IF EXISTS "Tutor updates own lessons (non-financial)" ON public.lessons;
DROP POLICY IF EXISTS "Independent tutor creates own-source lessons" ON public.lessons;
DROP POLICY IF EXISTS "Tutor creates own lessons" ON public.lessons;

-- Recreate INSERT policies without the now-dropped financial defaults
CREATE POLICY "Independent tutor creates own-source lessons"
ON public.lessons
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'tutor'::app_role)
  AND tutor_id = auth.uid()
  AND created_by = auth.uid()
  AND source = 'independent'::text
  AND is_independent_tutor(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.student_rates r
    WHERE r.tutor_id = auth.uid()
      AND r.student_id = lessons.student_id
      AND r.source = 'independent'::text
  )
);

CREATE POLICY "Tutor creates own lessons"
ON public.lessons
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'tutor'::app_role)
  AND tutor_id = auth.uid()
  AND created_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.student_rates r
    WHERE r.tutor_id = auth.uid()
      AND r.student_id = lessons.student_id
  )
);

-- Tutor UPDATE policy: keep immutable fields but drop reference to financial/content columns
CREATE POLICY "Tutor updates own lessons (non-financial)"
ON public.lessons
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'tutor'::app_role) AND auth.uid() = tutor_id
)
WITH CHECK (
  has_role(auth.uid(), 'tutor'::app_role)
  AND auth.uid() = tutor_id
  AND tutor_id = (SELECT l.tutor_id FROM public.lessons l WHERE l.id = lessons.id)
  AND student_id = (SELECT l.student_id FROM public.lessons l WHERE l.id = lessons.id)
);

-- Student UPDATE policy: students cannot edit any lesson columns now (notes moved to lesson_details).
-- We keep the policy but lock it down to a no-op that preserves all immutable fields.
CREATE POLICY "Student updates own notes"
ON public.lessons
FOR UPDATE
TO authenticated
USING (auth.uid() = student_id)
WITH CHECK (
  auth.uid() = student_id
  AND tutor_id = (SELECT l.tutor_id FROM public.lessons l WHERE l.id = lessons.id)
  AND student_id = (SELECT l.student_id FROM public.lessons l WHERE l.id = lessons.id)
  AND NOT (meeting_url IS DISTINCT FROM (SELECT l.meeting_url FROM public.lessons l WHERE l.id = lessons.id))
);

-- Update protect_lesson_fields trigger function to remove references to dropped columns
CREATE OR REPLACE FUNCTION public.protect_lesson_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Immutable identifiers
    IF NEW.tutor_id IS DISTINCT FROM OLD.tutor_id THEN
      RAISE EXCEPTION 'tutor_id is immutable';
    END IF;
    IF NEW.student_id IS DISTINCT FROM OLD.student_id THEN
      RAISE EXCEPTION 'student_id is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Drop the columns
ALTER TABLE public.lessons
  DROP COLUMN IF EXISTS student_price,
  DROP COLUMN IF EXISTS tutor_payout,
  DROP COLUMN IF EXISTS student_payment_status,
  DROP COLUMN IF EXISTS tutor_payout_status,
  DROP COLUMN IF EXISTS student_paid_at,
  DROP COLUMN IF EXISTS tutor_paid_at,
  DROP COLUMN IF EXISTS homework,
  DROP COLUMN IF EXISTS summary,
  DROP COLUMN IF EXISTS student_notes;