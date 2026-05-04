CREATE TABLE public.student_intake_quiz (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  subjects text[] NOT NULL DEFAULT '{}',
  level text,
  schedule text[] NOT NULL DEFAULT '{}',
  goal text,
  goal_other text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_student_intake_quiz_student ON public.student_intake_quiz(student_id, created_at DESC);

ALTER TABLE public.student_intake_quiz ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Student inserts own quiz"
  ON public.student_intake_quiz FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = student_id);

CREATE POLICY "Student views own quiz"
  ON public.student_intake_quiz FOR SELECT TO authenticated
  USING (auth.uid() = student_id);

CREATE POLICY "Student updates own quiz"
  ON public.student_intake_quiz FOR UPDATE TO authenticated
  USING (auth.uid() = student_id) WITH CHECK (auth.uid() = student_id);

CREATE POLICY "Manager manages all quiz"
  ON public.student_intake_quiz FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Tutor views own student quiz"
  ON public.student_intake_quiz FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.student_rates r
    WHERE r.tutor_id = auth.uid() AND r.student_id = student_intake_quiz.student_id
  ));

CREATE TRIGGER update_student_intake_quiz_updated_at
  BEFORE UPDATE ON public.student_intake_quiz
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();