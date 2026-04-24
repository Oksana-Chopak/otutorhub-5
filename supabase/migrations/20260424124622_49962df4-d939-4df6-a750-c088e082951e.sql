-- 1. Add Pro settings columns to tutor_workspace_settings
ALTER TABLE public.tutor_workspace_settings
  ADD COLUMN IF NOT EXISTS payment_due_mode text NOT NULL DEFAULT 'before_lesson',
  ADD COLUMN IF NOT EXISTS payment_due_days smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS cancel_free_hours smallint NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS payment_reminder_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.tutor_workspace_settings
  DROP CONSTRAINT IF EXISTS tutor_workspace_settings_payment_due_mode_check;
ALTER TABLE public.tutor_workspace_settings
  ADD CONSTRAINT tutor_workspace_settings_payment_due_mode_check
  CHECK (payment_due_mode IN ('prepaid','before_lesson','after_lesson'));

ALTER TABLE public.tutor_workspace_settings
  DROP CONSTRAINT IF EXISTS tutor_workspace_settings_payment_due_days_check;
ALTER TABLE public.tutor_workspace_settings
  ADD CONSTRAINT tutor_workspace_settings_payment_due_days_check
  CHECK (payment_due_days BETWEEN 0 AND 30);

ALTER TABLE public.tutor_workspace_settings
  DROP CONSTRAINT IF EXISTS tutor_workspace_settings_cancel_free_hours_check;
ALTER TABLE public.tutor_workspace_settings
  ADD CONSTRAINT tutor_workspace_settings_cancel_free_hours_check
  CHECK (cancel_free_hours BETWEEN 0 AND 168);

-- 2. Lock down privilege escalation: tutor can update only safe columns,
--    cannot self-flip independent_workspace or subscription_status.
DROP POLICY IF EXISTS "Tutor updates own settings" ON public.tutor_workspace_settings;

CREATE POLICY "Tutor updates own settings"
ON public.tutor_workspace_settings
FOR UPDATE
TO authenticated
USING (auth.uid() = tutor_id)
WITH CHECK (auth.uid() = tutor_id);

CREATE OR REPLACE FUNCTION public.guard_tutor_workspace_settings_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Manager bypass
  IF public.has_role(auth.uid(), 'manager'::app_role) THEN
    RETURN NEW;
  END IF;

  -- Tutor cannot self-grant independent workspace status
  IF NEW.independent_workspace IS DISTINCT FROM OLD.independent_workspace THEN
    RAISE EXCEPTION 'Only managers can change independent_workspace flag';
  END IF;

  -- Tutor cannot self-promote to active subscription
  IF NEW.subscription_status IS DISTINCT FROM OLD.subscription_status THEN
    RAISE EXCEPTION 'Only managers can change subscription_status';
  END IF;

  IF NEW.subscription_until IS DISTINCT FROM OLD.subscription_until THEN
    RAISE EXCEPTION 'Only managers can change subscription_until';
  END IF;

  -- Pro-only fields are still editable by tutors; gating happens in UI/edge fn,
  -- since the actual reminder/cancel automation will check is_pro server-side.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_tutor_workspace_settings_update ON public.tutor_workspace_settings;
CREATE TRIGGER guard_tutor_workspace_settings_update
  BEFORE UPDATE ON public.tutor_workspace_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_tutor_workspace_settings_update();

-- 3. lesson_change_requests: student-initiated cancel/reschedule
CREATE TABLE IF NOT EXISTS public.lesson_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL,
  student_id uuid NOT NULL,
  tutor_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('cancel','reschedule')),
  proposed_starts_at timestamptz,
  reason text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','cancelled')),
  charge_decision text
    CHECK (charge_decision IN ('none','partial','full')),
  tutor_response text,
  decided_at timestamptz,
  decided_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lesson_change_requests_lesson_idx
  ON public.lesson_change_requests(lesson_id);
CREATE INDEX IF NOT EXISTS lesson_change_requests_tutor_status_idx
  ON public.lesson_change_requests(tutor_id, status);
CREATE INDEX IF NOT EXISTS lesson_change_requests_student_status_idx
  ON public.lesson_change_requests(student_id, status);

ALTER TABLE public.lesson_change_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manager views all change requests"
ON public.lesson_change_requests
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Participant views own change requests"
ON public.lesson_change_requests
FOR SELECT TO authenticated
USING (auth.uid() = student_id OR auth.uid() = tutor_id);

-- Student creates only for own lessons
CREATE POLICY "Student creates change request"
ON public.lesson_change_requests
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = student_id
  AND EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id = lesson_change_requests.lesson_id
      AND l.student_id = auth.uid()
      AND l.tutor_id = lesson_change_requests.tutor_id
      AND l.status = 'scheduled'
  )
);

-- Tutor or student cancel-own-pending; tutor approves/rejects
CREATE POLICY "Tutor manages own change requests"
ON public.lesson_change_requests
FOR UPDATE TO authenticated
USING (auth.uid() = tutor_id)
WITH CHECK (auth.uid() = tutor_id);

CREATE POLICY "Student cancels own pending request"
ON public.lesson_change_requests
FOR UPDATE TO authenticated
USING (auth.uid() = student_id AND status = 'pending')
WITH CHECK (auth.uid() = student_id AND status IN ('pending','cancelled'));

CREATE POLICY "Manager manages change requests"
ON public.lesson_change_requests
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'manager'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'manager'::app_role));

CREATE OR REPLACE FUNCTION public.touch_lesson_change_request()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('approved','rejected') THEN
    NEW.decided_at := COALESCE(NEW.decided_at, now());
    NEW.decided_by := COALESCE(NEW.decided_by, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_lesson_change_request ON public.lesson_change_requests;
CREATE TRIGGER touch_lesson_change_request
  BEFORE UPDATE ON public.lesson_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_lesson_change_request();

-- 4. lesson_payment_reminders: idempotency log for sent reminders
CREATE TABLE IF NOT EXISTS public.lesson_payment_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL,
  tutor_id uuid NOT NULL,
  student_id uuid NOT NULL,
  reminder_kind text NOT NULL CHECK (reminder_kind IN ('prepaid','before_lesson','after_lesson')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  channel text NOT NULL DEFAULT 'telegram',
  UNIQUE (lesson_id, reminder_kind)
);

CREATE INDEX IF NOT EXISTS lesson_payment_reminders_tutor_sent_idx
  ON public.lesson_payment_reminders(tutor_id, sent_at DESC);

ALTER TABLE public.lesson_payment_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manager views all reminders"
ON public.lesson_payment_reminders
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Participant views own reminders"
ON public.lesson_payment_reminders
FOR SELECT TO authenticated
USING (auth.uid() = tutor_id OR auth.uid() = student_id);

-- Inserts only by service role (edge function)
-- (no INSERT policy => only service_role can insert)