CREATE TABLE public.paywall_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  feature_key TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'unknown',
  subscription_status TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.paywall_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert own paywall events"
ON public.paywall_events
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Managers view paywall events"
ON public.paywall_events
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'manager'::app_role));

CREATE INDEX idx_paywall_events_feature_created
  ON public.paywall_events (feature_key, created_at DESC);

CREATE INDEX idx_paywall_events_user_created
  ON public.paywall_events (user_id, created_at DESC);

CREATE INDEX idx_paywall_events_status_created
  ON public.paywall_events (subscription_status, created_at DESC);