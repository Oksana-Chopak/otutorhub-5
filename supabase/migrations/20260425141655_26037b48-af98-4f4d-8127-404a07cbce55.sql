-- Таблиця платежів LiqPay
CREATE TABLE public.liqpay_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  order_id text NOT NULL UNIQUE,
  plan text NOT NULL CHECK (plan IN ('monthly', 'yearly')),
  amount numeric(10,2) NOT NULL,
  currency text NOT NULL DEFAULT 'UAH',
  status text NOT NULL DEFAULT 'pending',
  liqpay_payment_id text,
  liqpay_action text,
  card_token text,
  is_recurring boolean NOT NULL DEFAULT false,
  raw_callback jsonb,
  paid_at timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_liqpay_payments_tutor ON public.liqpay_payments(tutor_id);
CREATE INDEX idx_liqpay_payments_status ON public.liqpay_payments(status);
CREATE INDEX idx_liqpay_payments_order ON public.liqpay_payments(order_id);

ALTER TABLE public.liqpay_payments ENABLE ROW LEVEL SECURITY;

-- Репетитор бачить власні платежі
CREATE POLICY "Tutors view own payments"
  ON public.liqpay_payments
  FOR SELECT
  TO authenticated
  USING (auth.uid() = tutor_id);

-- Менеджер бачить усі
CREATE POLICY "Managers view all payments"
  ON public.liqpay_payments
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'manager'::app_role));

-- INSERT/UPDATE/DELETE — лише через service role (немає policy для authenticated)

-- Trigger для updated_at
CREATE TRIGGER update_liqpay_payments_updated_at
  BEFORE UPDATE ON public.liqpay_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Додаю поле для зберігання картки (рекурентні платежі)
ALTER TABLE public.tutor_workspace_settings
  ADD COLUMN IF NOT EXISTS liqpay_card_token text,
  ADD COLUMN IF NOT EXISTS liqpay_recurring_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS current_plan text;