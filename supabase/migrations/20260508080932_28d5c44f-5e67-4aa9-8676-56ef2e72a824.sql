CREATE TABLE public.lesson_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  attendance_status text NOT NULL DEFAULT 'expected'
    CHECK (attendance_status IN ('expected','attended','absent','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lesson_id, student_id)
);

ALTER TABLE public.lesson_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tutor_manages_participants" ON public.lesson_participants
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.lessons l WHERE l.id = lesson_id AND l.tutor_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.lessons l WHERE l.id = lesson_id AND l.tutor_id = auth.uid()));

CREATE POLICY "manager_manages_participants" ON public.lesson_participants
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "student_views_participation" ON public.lesson_participants
  FOR SELECT TO authenticated
  USING (student_id = auth.uid());

CREATE INDEX idx_lesson_participants_lesson ON public.lesson_participants(lesson_id);
CREATE INDEX idx_lesson_participants_student ON public.lesson_participants(student_id);