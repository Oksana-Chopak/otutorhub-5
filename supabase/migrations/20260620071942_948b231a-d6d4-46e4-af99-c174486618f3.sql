CREATE TABLE IF NOT EXISTS public.student_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tutor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  lesson_id uuid REFERENCES public.lessons(id) ON DELETE SET NULL,
  emoji text NOT NULL,
  theme text NOT NULL DEFAULT 'fruits',
  earned_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS student_rewards_student_id_earned_at_idx
  ON public.student_rewards (student_id, earned_at DESC);
CREATE INDEX IF NOT EXISTS student_rewards_lesson_id_idx
  ON public.student_rewards (lesson_id);

GRANT SELECT, INSERT ON public.student_rewards TO authenticated;
GRANT ALL ON public.student_rewards TO service_role;

ALTER TABLE public.student_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students view own rewards" ON public.student_rewards;
CREATE POLICY "Students view own rewards"
  ON public.student_rewards FOR SELECT TO authenticated
  USING (student_id = auth.uid());

DROP POLICY IF EXISTS "Tutors view own granted rewards" ON public.student_rewards;
CREATE POLICY "Tutors view own granted rewards"
  ON public.student_rewards FOR SELECT TO authenticated
  USING (tutor_id = auth.uid());

DROP POLICY IF EXISTS "Managers view all rewards" ON public.student_rewards;
CREATE POLICY "Managers view all rewards"
  ON public.student_rewards FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'manager'));

DROP POLICY IF EXISTS "Tutors insert rewards for linked students" ON public.student_rewards;
CREATE POLICY "Tutors insert rewards for linked students"
  ON public.student_rewards FOR INSERT TO authenticated
  WITH CHECK (
    tutor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.student_rates sr
      WHERE sr.tutor_id = auth.uid()
        AND sr.student_id = student_rewards.student_id
        AND sr.archived_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Managers insert rewards" ON public.student_rewards;
CREATE POLICY "Managers insert rewards"
  ON public.student_rewards FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'manager'));