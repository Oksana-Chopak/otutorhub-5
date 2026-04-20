-- ============= WEEKLY TEMPLATE =============
CREATE TABLE public.tutor_availability_weekly (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id uuid NOT NULL,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0=Sun .. 6=Sat (JS Date.getDay())
  start_minute smallint NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute smallint NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_minute > start_minute)
);
CREATE INDEX idx_avail_weekly_tutor ON public.tutor_availability_weekly(tutor_id, weekday);
ALTER TABLE public.tutor_availability_weekly ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tutor manages own weekly availability"
  ON public.tutor_availability_weekly FOR ALL TO authenticated
  USING (auth.uid() = tutor_id) WITH CHECK (auth.uid() = tutor_id);

CREATE POLICY "Manager manages all weekly availability"
  ON public.tutor_availability_weekly FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Student views related tutor weekly availability"
  ON public.tutor_availability_weekly FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'student'::app_role) AND (
      EXISTS (SELECT 1 FROM public.lessons l WHERE l.tutor_id = tutor_availability_weekly.tutor_id AND l.student_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.student_rates r WHERE r.tutor_id = tutor_availability_weekly.tutor_id AND r.student_id = auth.uid())
    )
  );

-- ============= DATE OVERRIDES =============
CREATE TABLE public.tutor_availability_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id uuid NOT NULL,
  slot_date date NOT NULL,
  start_minute smallint NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute smallint NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  is_available boolean NOT NULL DEFAULT true, -- true=add slot, false=block range from weekly template
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_minute > start_minute)
);
CREATE INDEX idx_avail_overrides_tutor_date ON public.tutor_availability_overrides(tutor_id, slot_date);
ALTER TABLE public.tutor_availability_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tutor manages own overrides"
  ON public.tutor_availability_overrides FOR ALL TO authenticated
  USING (auth.uid() = tutor_id) WITH CHECK (auth.uid() = tutor_id);

CREATE POLICY "Manager manages all overrides"
  ON public.tutor_availability_overrides FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Student views related tutor overrides"
  ON public.tutor_availability_overrides FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'student'::app_role) AND (
      EXISTS (SELECT 1 FROM public.lessons l WHERE l.tutor_id = tutor_availability_overrides.tutor_id AND l.student_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.student_rates r WHERE r.tutor_id = tutor_availability_overrides.tutor_id AND r.student_id = auth.uid())
    )
  );

-- ============= AVAILABILITY REQUESTS =============
CREATE TABLE public.availability_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id uuid NOT NULL,
  requester_id uuid NOT NULL,
  message text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fulfilled', 'cancelled')),
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_avail_req_tutor ON public.availability_requests(tutor_id, status, created_at DESC);
CREATE INDEX idx_avail_req_requester ON public.availability_requests(requester_id, created_at DESC);
ALTER TABLE public.availability_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tutor views own requests"
  ON public.availability_requests FOR SELECT TO authenticated
  USING (auth.uid() = tutor_id);

CREATE POLICY "Requester views own requests"
  ON public.availability_requests FOR SELECT TO authenticated
  USING (auth.uid() = requester_id);

CREATE POLICY "Manager views all requests"
  ON public.availability_requests FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Manager or related student creates request"
  ON public.availability_requests FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = requester_id AND (
      public.has_role(auth.uid(), 'manager'::app_role)
      OR (
        public.has_role(auth.uid(), 'student'::app_role) AND (
          EXISTS (SELECT 1 FROM public.lessons l WHERE l.tutor_id = availability_requests.tutor_id AND l.student_id = auth.uid())
          OR EXISTS (SELECT 1 FROM public.student_rates r WHERE r.tutor_id = availability_requests.tutor_id AND r.student_id = auth.uid())
        )
      )
    )
  );

CREATE POLICY "Tutor or manager updates request"
  ON public.availability_requests FOR UPDATE TO authenticated
  USING (auth.uid() = tutor_id OR public.has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (auth.uid() = tutor_id OR public.has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Requester or manager deletes request"
  ON public.availability_requests FOR DELETE TO authenticated
  USING (auth.uid() = requester_id OR public.has_role(auth.uid(), 'manager'::app_role));

-- updated_at triggers
CREATE TRIGGER update_avail_weekly_updated_at BEFORE UPDATE ON public.tutor_availability_weekly
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_avail_overrides_updated_at BEFORE UPDATE ON public.tutor_availability_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_avail_requests_updated_at BEFORE UPDATE ON public.availability_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime for badge counter
ALTER PUBLICATION supabase_realtime ADD TABLE public.availability_requests;