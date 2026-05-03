ALTER TABLE public.tutor_workspace_settings
  ADD COLUMN IF NOT EXISTS daily_digest_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.tutor_daily_digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id uuid NOT NULL,
  digest_date date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  channel text NOT NULL DEFAULT 'telegram',
  UNIQUE (tutor_id, digest_date, channel)
);

ALTER TABLE public.tutor_daily_digests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manager views all digests"
  ON public.tutor_daily_digests FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Tutor views own digests"
  ON public.tutor_daily_digests FOR SELECT TO authenticated
  USING (tutor_id = auth.uid());