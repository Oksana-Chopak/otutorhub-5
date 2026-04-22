-- Storage bucket for lesson attachments (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('lesson-attachments', 'lesson-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Metadata table for lesson attachments
CREATE TABLE IF NOT EXISTS public.lesson_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  uploader_id uuid NOT NULL,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lesson_attachments_lesson ON public.lesson_attachments(lesson_id);

ALTER TABLE public.lesson_attachments ENABLE ROW LEVEL SECURITY;

-- View: tutor, student, manager involved in the lesson can see attachments
CREATE POLICY "Lesson participants view attachments"
ON public.lesson_attachments FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'manager'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id = lesson_attachments.lesson_id
      AND (auth.uid() = l.tutor_id OR auth.uid() = l.student_id)
  )
);

-- Insert: tutor or student of the lesson, or manager. Uploader must be self.
CREATE POLICY "Lesson participants add attachments"
ON public.lesson_attachments FOR INSERT
TO authenticated
WITH CHECK (
  uploader_id = auth.uid()
  AND (
    public.has_role(auth.uid(), 'manager'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.lessons l
      WHERE l.id = lesson_attachments.lesson_id
        AND (auth.uid() = l.tutor_id OR auth.uid() = l.student_id)
    )
  )
);

-- Delete: uploader, tutor, or manager
CREATE POLICY "Uploader tutor or manager deletes attachment"
ON public.lesson_attachments FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'manager'::app_role)
  OR uploader_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id = lesson_attachments.lesson_id
      AND auth.uid() = l.tutor_id
  )
);

-- Storage RLS policies on storage.objects for the bucket.
-- Path convention: <lesson_id>/<uuid>-<filename>
CREATE POLICY "Lesson participants read attachment files"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'lesson-attachments'
  AND (
    public.has_role(auth.uid(), 'manager'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.lessons l
      WHERE l.id::text = (storage.foldername(name))[1]
        AND (auth.uid() = l.tutor_id OR auth.uid() = l.student_id)
    )
  )
);

CREATE POLICY "Lesson participants upload attachment files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'lesson-attachments'
  AND (
    public.has_role(auth.uid(), 'manager'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.lessons l
      WHERE l.id::text = (storage.foldername(name))[1]
        AND (auth.uid() = l.tutor_id OR auth.uid() = l.student_id)
    )
  )
);

CREATE POLICY "Tutor or manager deletes attachment files"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'lesson-attachments'
  AND (
    public.has_role(auth.uid(), 'manager'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.lessons l
      WHERE l.id::text = (storage.foldername(name))[1]
        AND auth.uid() = l.tutor_id
    )
    OR auth.uid() = owner
  )
);