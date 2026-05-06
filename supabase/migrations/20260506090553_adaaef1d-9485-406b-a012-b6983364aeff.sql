-- Hide LiqPay card token from authenticated clients.
-- Tutors can still SELECT their own row (other columns), but the raw card
-- token used for recurring billing is restricted to service role only.
REVOKE SELECT (liqpay_card_token) ON public.tutor_workspace_settings FROM anon, authenticated;