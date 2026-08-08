-- Читання реєстру предметів застосунком + збагачення сіду з профілів репетиторів.
CREATE POLICY IF NOT EXISTS subject_canon_read ON public.subject_canon
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.subject_canon(norm, display)
SELECT public.normalize_subject(s), btrim(s)
FROM (SELECT unnest(subjects) AS s FROM public.tutor_details WHERE subjects IS NOT NULL) u
WHERE btrim(coalesce(s,'')) <> ''
ON CONFLICT (norm) DO NOTHING;
