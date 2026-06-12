-- ЗВЕРНЕННЯ КОРИСТУВАЧІВ (фідбек/баг/питання).
-- Раніше форма «Залишити фідбек» НІКУДИ не зберігала (setTimeout + тост) — усі
-- звернення зникали. Ця таблиця + RLS дають менеджеру місце, де їх читати.

CREATE TABLE IF NOT EXISTS public.feedback_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  category text NOT NULL DEFAULT 'idea',         -- bug | idea | question | other
  message text NOT NULL,
  rating smallint,                               -- 0..5, опційно
  status text NOT NULL DEFAULT 'new',            -- new | in_progress | resolved
  page_url text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_submissions_status_created_idx
  ON public.feedback_submissions (status, created_at DESC);

ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY;

-- Будь-який залогінений користувач може лишити звернення (тільки за себе).
CREATE POLICY feedback_insert_own
  ON public.feedback_submissions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Автор бачить свої; менеджер бачить усі.
CREATE POLICY feedback_select_own_or_manager
  ON public.feedback_submissions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'manager'::app_role));

-- Лише менеджер змінює статус.
CREATE POLICY feedback_update_manager
  ON public.feedback_submissions FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'manager'::app_role));
