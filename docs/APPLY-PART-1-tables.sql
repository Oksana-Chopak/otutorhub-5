-- ╔═══ ЧАСТИНА 1 з 3 · ТАБЛИЦІ ТА КОЛОНКИ (виконати першою) ═══╗
-- Найважливіша: без неї застосунок не компілюється. Безпечна, ідемпотентна.

-- 1. Таблиця звернень користувачів (фідбек/баг/питання)
CREATE TABLE IF NOT EXISTS public.feedback_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  category text NOT NULL DEFAULT 'idea',
  message text NOT NULL,
  rating smallint,
  status text NOT NULL DEFAULT 'new',
  page_url text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_submissions_status_created_idx
  ON public.feedback_submissions (status, created_at DESC);

ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feedback_insert_own ON public.feedback_submissions;
CREATE POLICY feedback_insert_own
  ON public.feedback_submissions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS feedback_select_own_or_manager ON public.feedback_submissions;
CREATE POLICY feedback_select_own_or_manager
  ON public.feedback_submissions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'manager'::app_role));

DROP POLICY IF EXISTS feedback_update_manager ON public.feedback_submissions;
CREATE POLICY feedback_update_manager
  ON public.feedback_submissions FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'manager'::app_role));

-- 2. Колонка гаманця (фікс видалення передоплат)
ALTER TABLE public.student_wallet_balances
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.student_wallet_balances
  ADD COLUMN IF NOT EXISTS last_transaction_at timestamptz;

-- 3. Графік виплат репетиторам
ALTER TABLE public.tutor_details
  ADD COLUMN IF NOT EXISTS payout_frequency text,
  ADD COLUMN IF NOT EXISTS payout_weekday smallint,
  ADD COLUMN IF NOT EXISTS payout_monthday smallint,
  ADD COLUMN IF NOT EXISTS payout_anchor date,
  ADD COLUMN IF NOT EXISTS payout_last_marked_at timestamptz;
