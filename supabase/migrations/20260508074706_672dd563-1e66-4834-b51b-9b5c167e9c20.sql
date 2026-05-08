CREATE TABLE public.tutor_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id uuid NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tutor_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tutor manages own notes"
ON public.tutor_notes
FOR ALL
TO authenticated
USING (tutor_id = auth.uid())
WITH CHECK (tutor_id = auth.uid());

CREATE POLICY "Manager views all notes"
ON public.tutor_notes
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'manager'::app_role));

CREATE INDEX idx_tutor_notes_tutor_created ON public.tutor_notes (tutor_id, created_at DESC);