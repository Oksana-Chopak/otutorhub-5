-- 1. Create tutor_subject_rates table
CREATE TABLE IF NOT EXISTS public.tutor_subject_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id uuid NOT NULL,
  subject text NOT NULL,
  rate_per_lesson numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tutor_id, subject)
);

ALTER TABLE public.tutor_subject_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manager manages tutor subject rates"
  ON public.tutor_subject_rates FOR ALL TO authenticated
  USING (public.has_role('manager'::app_role))
  WITH CHECK (public.has_role('manager'::app_role));

CREATE POLICY "Tutor views own subject rates"
  ON public.tutor_subject_rates FOR SELECT TO authenticated
  USING (auth.uid() = tutor_id);

CREATE POLICY "Tutor manages own subject rates"
  ON public.tutor_subject_rates FOR ALL TO authenticated
  USING (auth.uid() = tutor_id)
  WITH CHECK (auth.uid() = tutor_id);

CREATE POLICY "Student views assigned tutor subject rates"
  ON public.tutor_subject_rates FOR SELECT TO authenticated
  USING (
    public.has_role('student'::app_role) AND (
      EXISTS (SELECT 1 FROM public.lessons l WHERE l.tutor_id = tutor_subject_rates.tutor_id AND l.student_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.student_rates r WHERE r.tutor_id = tutor_subject_rates.tutor_id AND r.student_id = auth.uid())
    )
  );

CREATE TRIGGER trg_tutor_subject_rates_updated_at
  BEFORE UPDATE ON public.tutor_subject_rates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Migrate existing tutor_details.rate_per_lesson -> first subject in subjects array
INSERT INTO public.tutor_subject_rates (tutor_id, subject, rate_per_lesson)
SELECT td.user_id, td.subjects[1], td.rate_per_lesson
FROM public.tutor_details td
WHERE array_length(td.subjects, 1) >= 1
  AND td.rate_per_lesson > 0
ON CONFLICT (tutor_id, subject) DO NOTHING;

-- 2. Add subject column to student_rates
ALTER TABLE public.student_rates ADD COLUMN IF NOT EXISTS subject text;

-- Backfill: assign first subject of corresponding tutor to existing rows
UPDATE public.student_rates sr
SET subject = (
  SELECT td.subjects[1] FROM public.tutor_details td
  WHERE td.user_id = sr.tutor_id AND array_length(td.subjects, 1) >= 1
  LIMIT 1
)
WHERE subject IS NULL;

-- For rows where tutor has no subjects, set to empty marker so unique constraint works; allow NULL otherwise
UPDATE public.student_rates SET subject = '' WHERE subject IS NULL;

ALTER TABLE public.student_rates ALTER COLUMN subject SET NOT NULL;
ALTER TABLE public.student_rates ALTER COLUMN subject SET DEFAULT '';

-- Drop old unique constraint if exists, add new composite unique
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_rates_tutor_id_student_id_key') THEN
    ALTER TABLE public.student_rates DROP CONSTRAINT student_rates_tutor_id_student_id_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS student_rates_tutor_student_subject_uniq
  ON public.student_rates (tutor_id, student_id, subject);

-- 3. Update autofill_lesson_prices to use subject-aware rates
CREATE OR REPLACE FUNCTION public.autofill_lesson_prices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _rate NUMERIC(10,2);
  _payout NUMERIC(10,2);
BEGIN
  -- Student price per subject
  IF NEW.student_price = 0 THEN
    SELECT price_per_lesson INTO _rate
    FROM public.student_rates
    WHERE tutor_id = NEW.tutor_id AND student_id = NEW.student_id AND subject = NEW.subject;
    IF _rate IS NOT NULL THEN
      NEW.student_price := _rate;
    END IF;
  END IF;

  -- Tutor payout per subject
  IF NEW.tutor_payout = 0 THEN
    SELECT rate_per_lesson INTO _payout
    FROM public.tutor_subject_rates
    WHERE tutor_id = NEW.tutor_id AND subject = NEW.subject;
    IF _payout IS NOT NULL THEN
      NEW.tutor_payout := _payout;
    ELSE
      -- Fallback to legacy single rate if subject-specific not set
      SELECT rate_per_lesson INTO _payout
      FROM public.tutor_details
      WHERE user_id = NEW.tutor_id;
      IF _payout IS NOT NULL THEN
        NEW.tutor_payout := _payout;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;