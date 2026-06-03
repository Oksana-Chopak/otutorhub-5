
CREATE INDEX IF NOT EXISTS idx_lessons_tutor_starts ON public.lessons (tutor_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_lessons_student_starts ON public.lessons (student_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_lessons_status_starts ON public.lessons (status, starts_at);
CREATE INDEX IF NOT EXISTS idx_lesson_details_lesson ON public.lesson_details (lesson_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_created ON public.chat_messages (thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_threads_tutor ON public.chat_threads (tutor_id);
CREATE INDEX IF NOT EXISTS idx_chat_threads_student ON public.chat_threads (student_id);
CREATE INDEX IF NOT EXISTS idx_chat_reads_user_thread ON public.chat_reads (user_id, thread_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles (user_id);
