CREATE INDEX IF NOT EXISTS idx_lessons_tutor_date 
ON public.lessons(tutor_id, starts_at DESC);

CREATE INDEX IF NOT EXISTS idx_lessons_tutor_payment 
ON public.lessons(tutor_id, student_payment_status);

CREATE INDEX IF NOT EXISTS idx_lesson_details_lesson 
ON public.lesson_details(lesson_id);

CREATE INDEX IF NOT EXISTS idx_lesson_details_payment 
ON public.lesson_details(lesson_id, student_payment_status);