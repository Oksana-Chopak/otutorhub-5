-- Subscription upgrade requests from independent tutors to school managers
CREATE TYPE public.subscription_request_status AS ENUM ('new', 'in_progress', 'completed', 'rejected');

CREATE TABLE public.subscription_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id UUID NOT NULL,
  plan TEXT NOT NULL DEFAULT 'pro',
  price NUMERIC(10,2) NOT NULL DEFAULT 145,
  status public.subscription_request_status NOT NULL DEFAULT 'new',
  message TEXT,
  manager_response TEXT,
  handled_by UUID,
  handled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscription_requests_tutor ON public.subscription_requests(tutor_id);
CREATE INDEX idx_subscription_requests_status ON public.subscription_requests(status);
CREATE INDEX idx_subscription_requests_created ON public.subscription_requests(created_at DESC);

ALTER TABLE public.subscription_requests ENABLE ROW LEVEL SECURITY;

-- Independent tutor: insert own
CREATE POLICY "Independent tutor creates own subscription request"
  ON public.subscription_requests FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = tutor_id
    AND public.has_role(auth.uid(), 'tutor'::app_role)
    AND public.is_independent_tutor(auth.uid())
  );

-- Tutor views own
CREATE POLICY "Tutor views own subscription requests"
  ON public.subscription_requests FOR SELECT TO authenticated
  USING (auth.uid() = tutor_id);

-- Manager: full access
CREATE POLICY "Manager views all subscription requests"
  ON public.subscription_requests FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Manager updates subscription requests"
  ON public.subscription_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Manager deletes subscription requests"
  ON public.subscription_requests FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'manager'::app_role));

-- Auto-set handled_at when status changes to non-new
CREATE OR REPLACE FUNCTION public.set_subscription_request_handled()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> OLD.status AND NEW.status <> 'new' AND NEW.handled_at IS NULL THEN
    NEW.handled_at := now();
    NEW.handled_by := COALESCE(NEW.handled_by, auth.uid());
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_subscription_request_handled
BEFORE UPDATE ON public.subscription_requests
FOR EACH ROW EXECUTE FUNCTION public.set_subscription_request_handled();

CREATE TRIGGER trg_subscription_request_updated_at
BEFORE UPDATE ON public.subscription_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.subscription_requests;