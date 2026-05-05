CREATE TABLE public.subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  emoji text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subjects_read_all" ON public.subjects
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "subjects_manager_write" ON public.subjects
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager'))
  WITH CHECK (public.has_role(auth.uid(), 'manager'));

INSERT INTO public.subjects (name, emoji)
SELECT DISTINCT TRIM(subject), NULL
FROM public.lessons
WHERE subject IS NOT NULL AND TRIM(subject) <> ''
ON CONFLICT (name) DO NOTHING;

ALTER TABLE public.lessons
  ADD COLUMN subject_id uuid REFERENCES public.subjects(id);

UPDATE public.lessons l
SET subject_id = s.id
FROM public.subjects s
WHERE s.name = TRIM(l.subject);

CREATE INDEX IF NOT EXISTS idx_lessons_subject_id
  ON public.lessons(subject_id);