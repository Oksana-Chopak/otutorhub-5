CREATE TABLE public.manager_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id uuid NOT NULL,
  author_id uuid NOT NULL,
  content text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_manager_notes_subject ON public.manager_notes(subject_user_id, created_at DESC);

ALTER TABLE public.manager_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers view all notes"
  ON public.manager_notes FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Managers insert notes"
  ON public.manager_notes FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'manager'::app_role) AND auth.uid() = author_id);

CREATE POLICY "Managers update notes"
  ON public.manager_notes FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Managers delete notes"
  ON public.manager_notes FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'manager'::app_role));

CREATE TRIGGER update_manager_notes_updated_at
  BEFORE UPDATE ON public.manager_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();