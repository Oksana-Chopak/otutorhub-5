ALTER TABLE public.lessons DISABLE TRIGGER USER;
UPDATE public.lessons l
SET source = 'independent'
FROM public.tutor_workspace_settings ws
WHERE ws.tutor_id = l.tutor_id
  AND ws.independent_workspace = true
  AND l.source = 'hub';
ALTER TABLE public.lessons ENABLE TRIGGER USER;