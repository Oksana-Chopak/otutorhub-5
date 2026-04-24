-- Temporarily disable protection trigger to allow system backfill
ALTER TABLE public.lessons DISABLE TRIGGER protect_lesson_fields_trg;

UPDATE public.lessons l
SET student_price = COALESCE(
  (SELECT price_per_lesson FROM public.student_rates r
   WHERE r.tutor_id = l.tutor_id AND r.student_id = l.student_id AND r.subject = l.subject LIMIT 1),
  (SELECT price_per_lesson FROM public.student_rates r
   WHERE r.tutor_id = l.tutor_id AND r.student_id = l.student_id ORDER BY updated_at DESC LIMIT 1),
  (SELECT rate_per_lesson FROM public.tutor_subject_rates s
   WHERE s.tutor_id = l.tutor_id AND s.subject = l.subject LIMIT 1),
  (SELECT rate_per_lesson FROM public.tutor_details t WHERE t.user_id = l.tutor_id LIMIT 1),
  l.student_price
)
WHERE l.student_price = 0
  AND COALESCE(
    (SELECT price_per_lesson FROM public.student_rates r
     WHERE r.tutor_id = l.tutor_id AND r.student_id = l.student_id AND r.subject = l.subject LIMIT 1),
    (SELECT price_per_lesson FROM public.student_rates r
     WHERE r.tutor_id = l.tutor_id AND r.student_id = l.student_id ORDER BY updated_at DESC LIMIT 1),
    (SELECT rate_per_lesson FROM public.tutor_subject_rates s
     WHERE s.tutor_id = l.tutor_id AND s.subject = l.subject LIMIT 1),
    (SELECT rate_per_lesson FROM public.tutor_details t WHERE t.user_id = l.tutor_id LIMIT 1)
  ) IS NOT NULL;

ALTER TABLE public.lessons ENABLE TRIGGER protect_lesson_fields_trg;