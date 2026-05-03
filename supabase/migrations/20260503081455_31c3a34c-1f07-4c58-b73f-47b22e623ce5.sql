
-- Reminders log (idempotency)
CREATE TABLE public.lesson_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL,
  tutor_id uuid NOT NULL,
  student_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  recipient_role text NOT NULL CHECK (recipient_role IN ('tutor','student')),
  reminder_kind text NOT NULL,
  channel text NOT NULL DEFAULT 'telegram',
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lesson_id, recipient_id, reminder_kind)
);

CREATE INDEX idx_lesson_reminders_lesson ON public.lesson_reminders(lesson_id);
ALTER TABLE public.lesson_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manager views all lesson reminders"
ON public.lesson_reminders FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Participant views own lesson reminders"
ON public.lesson_reminders FOR SELECT TO authenticated
USING (auth.uid() = tutor_id OR auth.uid() = student_id);

-- Lesson feedback (student → tutor)
CREATE TABLE public.lesson_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL,
  tutor_id uuid NOT NULL,
  student_id uuid NOT NULL,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lesson_id, student_id)
);

CREATE INDEX idx_lesson_feedback_tutor ON public.lesson_feedback(tutor_id);
CREATE INDEX idx_lesson_feedback_lesson ON public.lesson_feedback(lesson_id);

ALTER TABLE public.lesson_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manager views all feedback"
ON public.lesson_feedback FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Tutor views own feedback"
ON public.lesson_feedback FOR SELECT TO authenticated
USING (auth.uid() = tutor_id);

CREATE POLICY "Student views own feedback"
ON public.lesson_feedback FOR SELECT TO authenticated
USING (auth.uid() = student_id);

CREATE POLICY "Student inserts own feedback for completed lesson"
ON public.lesson_feedback FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = student_id
  AND EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id = lesson_feedback.lesson_id
      AND l.student_id = auth.uid()
      AND l.tutor_id = lesson_feedback.tutor_id
      AND l.status = 'completed'::lesson_status
  )
);

CREATE POLICY "Student updates own feedback"
ON public.lesson_feedback FOR UPDATE TO authenticated
USING (auth.uid() = student_id)
WITH CHECK (auth.uid() = student_id);

CREATE POLICY "Manager deletes feedback"
ON public.lesson_feedback FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'manager'::app_role));

CREATE TRIGGER trg_lesson_feedback_updated_at
BEFORE UPDATE ON public.lesson_feedback
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
