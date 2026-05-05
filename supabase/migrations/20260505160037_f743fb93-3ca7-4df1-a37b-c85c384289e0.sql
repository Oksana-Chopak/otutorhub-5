ALTER TABLE public.lesson_details
ADD COLUMN IF NOT EXISTS student_paid_at timestamptz,
ADD COLUMN IF NOT EXISTS tutor_paid_at timestamptz;

UPDATE public.lesson_details ld
SET
  student_paid_at = l.student_paid_at,
  tutor_paid_at = l.tutor_paid_at
FROM public.lessons l
WHERE l.id = ld.lesson_id
  AND (l.student_paid_at IS NOT NULL OR l.tutor_paid_at IS NOT NULL);