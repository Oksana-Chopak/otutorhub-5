-- AUDIT 02.08: код писав у таблиці, яких НІКОЛИ не існувало (тихі падіння):
--   lesson_tutor_notes  — приватні нотатки репетитора на сторінці уроку
--   tutor_student_notes — нотатка про учня у швидкому додаванні
-- Обидві приватні для репетитора. Idempotent.

CREATE TABLE IF NOT EXISTS public.lesson_tutor_notes (
  lesson_id  uuid PRIMARY KEY REFERENCES public.lessons(id) ON DELETE CASCADE,
  notes      text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lesson_tutor_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lesson_tutor_notes_owner ON public.lesson_tutor_notes;
CREATE POLICY lesson_tutor_notes_owner ON public.lesson_tutor_notes
  FOR ALL USING (EXISTS (SELECT 1 FROM public.lessons l WHERE l.id = lesson_id AND l.tutor_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.lessons l WHERE l.id = lesson_id AND l.tutor_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.tutor_student_notes (
  tutor_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  notes      text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tutor_id, student_id)
);
ALTER TABLE public.tutor_student_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tutor_student_notes_owner ON public.tutor_student_notes;
CREATE POLICY tutor_student_notes_owner ON public.tutor_student_notes
  FOR ALL USING (tutor_id = auth.uid()) WITH CHECK (tutor_id = auth.uid());
