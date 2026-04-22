-- 1. Add per-lesson fields
ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS meeting_url text,
  ADD COLUMN IF NOT EXISTS homework text,
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS student_notes text;

-- 2. Default meeting URL per tutor-student pair
CREATE TABLE IF NOT EXISTS public.tutor_student_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id uuid NOT NULL,
  student_id uuid NOT NULL,
  default_meeting_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tutor_id, student_id)
);

ALTER TABLE public.tutor_student_defaults ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manager manages defaults"
  ON public.tutor_student_defaults
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Tutor manages own pair defaults"
  ON public.tutor_student_defaults
  FOR ALL TO authenticated
  USING (auth.uid() = tutor_id)
  WITH CHECK (auth.uid() = tutor_id);

CREATE POLICY "Student views own pair defaults"
  ON public.tutor_student_defaults
  FOR SELECT TO authenticated
  USING (auth.uid() = student_id);

CREATE TRIGGER trg_tutor_student_defaults_updated
  BEFORE UPDATE ON public.tutor_student_defaults
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Replace the financial-protection trigger with a broader one that also
--    restricts who can edit which lesson content fields.
DROP TRIGGER IF EXISTS protect_lesson_financials_trg ON public.lessons;

CREATE OR REPLACE FUNCTION public.protect_lesson_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_manager boolean := public.has_role(auth.uid(), 'manager'::app_role);
  _is_tutor   boolean := (auth.uid() = OLD.tutor_id);
  _is_student boolean := (auth.uid() = OLD.student_id);
BEGIN
  IF _is_manager THEN
    RETURN NEW;
  END IF;

  -- Financial / participant fields: only manager can change
  IF NEW.student_price          IS DISTINCT FROM OLD.student_price
     OR NEW.tutor_payout        IS DISTINCT FROM OLD.tutor_payout
     OR NEW.student_payment_status IS DISTINCT FROM OLD.student_payment_status
     OR NEW.tutor_payout_status IS DISTINCT FROM OLD.tutor_payout_status
     OR NEW.student_paid_at     IS DISTINCT FROM OLD.student_paid_at
     OR NEW.tutor_paid_at       IS DISTINCT FROM OLD.tutor_paid_at
     OR NEW.tutor_id            IS DISTINCT FROM OLD.tutor_id
     OR NEW.student_id          IS DISTINCT FROM OLD.student_id
  THEN
    RAISE EXCEPTION 'Тільки менеджер може змінювати фінансові поля та учасників уроку';
  END IF;

  -- Tutor-only fields: meeting_url, homework, summary
  IF NEW.meeting_url IS DISTINCT FROM OLD.meeting_url
     OR NEW.homework IS DISTINCT FROM OLD.homework
     OR NEW.summary  IS DISTINCT FROM OLD.summary
  THEN
    IF NOT _is_tutor THEN
      RAISE EXCEPTION 'Лише репетитор може редагувати посилання, домашку та конспект уроку';
    END IF;
  END IF;

  -- Student-only field: student_notes
  IF NEW.student_notes IS DISTINCT FROM OLD.student_notes THEN
    IF NOT _is_student THEN
      RAISE EXCEPTION 'Лише учень може редагувати свої нотатки';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_lesson_fields_trg
  BEFORE UPDATE ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.protect_lesson_fields();

-- 4. Replace the restrictive UPDATE policy on lessons so students can update
--    their own student_notes and tutors can update meeting_url/homework/summary.
DROP POLICY IF EXISTS "Non-managers cannot change financials (restrictive)" ON public.lessons;

CREATE POLICY "Student updates own notes"
  ON public.lessons
  FOR UPDATE TO authenticated
  USING (auth.uid() = student_id)
  WITH CHECK (auth.uid() = student_id);
