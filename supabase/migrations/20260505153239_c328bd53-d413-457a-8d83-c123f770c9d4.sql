
CREATE TYPE public.lesson_type AS ENUM ('individual', 'pair', 'group');

CREATE TABLE public.lesson_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id uuid NOT NULL,
  name text NOT NULL,
  subject_id uuid REFERENCES public.subjects(id),
  subject text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_lesson_groups_tutor ON public.lesson_groups(tutor_id);
ALTER TABLE public.lesson_groups ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.group_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.lesson_groups(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, student_id)
);
CREATE INDEX idx_group_enrollments_group ON public.group_enrollments(group_id);
CREATE INDEX idx_group_enrollments_student ON public.group_enrollments(student_id);
ALTER TABLE public.group_enrollments ENABLE ROW LEVEL SECURITY;

-- lesson_groups policies
CREATE POLICY "Tutor manages own groups" ON public.lesson_groups
  FOR ALL TO authenticated
  USING (auth.uid() = tutor_id AND has_role(auth.uid(), 'tutor'::app_role))
  WITH CHECK (auth.uid() = tutor_id AND has_role(auth.uid(), 'tutor'::app_role));
CREATE POLICY "Manager manages all groups" ON public.lesson_groups
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (has_role(auth.uid(), 'manager'::app_role));
CREATE POLICY "Student views own groups" ON public.lesson_groups
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.group_enrollments ge
    WHERE ge.group_id = lesson_groups.id
      AND ge.student_id = auth.uid()
      AND ge.status = 'active'
  ));

-- group_enrollments policies
CREATE POLICY "Tutor manages enrollments of own groups" ON public.group_enrollments
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.lesson_groups g WHERE g.id = group_enrollments.group_id AND g.tutor_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.lesson_groups g WHERE g.id = group_enrollments.group_id AND g.tutor_id = auth.uid()));
CREATE POLICY "Manager manages all enrollments" ON public.group_enrollments
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (has_role(auth.uid(), 'manager'::app_role));
CREATE POLICY "Student views own enrollments" ON public.group_enrollments
  FOR SELECT TO authenticated
  USING (student_id = auth.uid());

CREATE TRIGGER trg_lesson_groups_updated_at
  BEFORE UPDATE ON public.lesson_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_group_enrollments_updated_at
  BEFORE UPDATE ON public.group_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- lessons: type + group_id
ALTER TABLE public.lessons
  ADD COLUMN lesson_type public.lesson_type NOT NULL DEFAULT 'individual',
  ADD COLUMN group_id uuid REFERENCES public.lesson_groups(id) ON DELETE SET NULL;

CREATE INDEX idx_lessons_group_id ON public.lessons(group_id);
CREATE INDEX idx_lessons_lesson_type ON public.lessons(lesson_type);

ALTER TABLE public.lessons ALTER COLUMN student_id DROP NOT NULL;

ALTER TABLE public.lessons
  ADD CONSTRAINT lessons_participant_check CHECK (
    (lesson_type = 'individual' AND student_id IS NOT NULL AND group_id IS NULL)
    OR
    (lesson_type IN ('pair', 'group') AND group_id IS NOT NULL)
  );

CREATE POLICY "Student views group lessons" ON public.lessons
  FOR SELECT TO authenticated
  USING (
    lesson_type IN ('pair', 'group')
    AND EXISTS (
      SELECT 1 FROM public.group_enrollments ge
      WHERE ge.group_id = lessons.group_id
        AND ge.student_id = auth.uid()
        AND ge.status = 'active'
    )
  );
