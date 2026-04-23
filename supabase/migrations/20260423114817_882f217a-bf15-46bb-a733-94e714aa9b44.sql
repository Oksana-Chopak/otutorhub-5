-- 1. Workspace settings for tutors
CREATE TABLE public.tutor_workspace_settings (
  tutor_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  independent_workspace BOOLEAN NOT NULL DEFAULT false,
  subscription_status TEXT NOT NULL DEFAULT 'free' CHECK (subscription_status IN ('free', 'active', 'past_due', 'cancelled')),
  subscription_until TIMESTAMPTZ,
  onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  onboarding_step SMALLINT NOT NULL DEFAULT 1 CHECK (onboarding_step BETWEEN 1 AND 7),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tutor_workspace_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tutor views own settings"
ON public.tutor_workspace_settings FOR SELECT
TO authenticated
USING (auth.uid() = tutor_id);

CREATE POLICY "Tutor inserts own settings"
ON public.tutor_workspace_settings FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = tutor_id);

CREATE POLICY "Tutor updates own settings"
ON public.tutor_workspace_settings FOR UPDATE
TO authenticated
USING (auth.uid() = tutor_id)
WITH CHECK (auth.uid() = tutor_id);

CREATE POLICY "Manager manages all workspace settings"
ON public.tutor_workspace_settings FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'manager'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'manager'::app_role));

CREATE TRIGGER trg_workspace_settings_updated
BEFORE UPDATE ON public.tutor_workspace_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Referral requests
CREATE TABLE public.tutor_referral_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL,
  subject TEXT,
  preferred_level TEXT,
  budget_note TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'fulfilled', 'closed')),
  manager_response TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tutor_referral_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Student creates own referral request"
ON public.tutor_referral_requests FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = student_id AND public.has_role(auth.uid(), 'student'::app_role));

CREATE POLICY "Student views own referral requests"
ON public.tutor_referral_requests FOR SELECT
TO authenticated
USING (auth.uid() = student_id);

CREATE POLICY "Student deletes own open referral request"
ON public.tutor_referral_requests FOR DELETE
TO authenticated
USING (auth.uid() = student_id AND status = 'open');

CREATE POLICY "Manager views all referral requests"
ON public.tutor_referral_requests FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Manager updates referral requests"
ON public.tutor_referral_requests FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'manager'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Manager deletes referral requests"
ON public.tutor_referral_requests FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'manager'::app_role));

CREATE TRIGGER trg_referral_requests_updated
BEFORE UPDATE ON public.tutor_referral_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Source labels
ALTER TABLE public.lessons
  ADD COLUMN source TEXT NOT NULL DEFAULT 'hub'
  CHECK (source IN ('hub', 'independent'));

ALTER TABLE public.student_rates
  ADD COLUMN source TEXT NOT NULL DEFAULT 'hub'
  CHECK (source IN ('hub', 'independent'));

CREATE INDEX idx_lessons_source ON public.lessons(source);
CREATE INDEX idx_student_rates_source ON public.student_rates(source);
CREATE INDEX idx_student_rates_tutor_source ON public.student_rates(tutor_id, source);

-- 4. Helper: independent student count
CREATE OR REPLACE FUNCTION public.get_tutor_independent_student_count(_tutor_id UUID)
RETURNS INTEGER
LANGUAGE SQL
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(DISTINCT student_id)::INTEGER
  FROM public.student_rates
  WHERE tutor_id = _tutor_id AND source = 'independent';
$$;

-- 5. Helper: is tutor independent
CREATE OR REPLACE FUNCTION public.is_independent_tutor(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT independent_workspace FROM public.tutor_workspace_settings WHERE tutor_id = _user_id),
    false
  );
$$;

-- 6. Independent tutor manages own student_rates
CREATE POLICY "Independent tutor manages own student rates"
ON public.student_rates FOR ALL
TO authenticated
USING (
  auth.uid() = tutor_id
  AND source = 'independent'
  AND public.is_independent_tutor(auth.uid())
)
WITH CHECK (
  auth.uid() = tutor_id
  AND source = 'independent'
  AND public.is_independent_tutor(auth.uid())
);

-- 7. Independent tutor creates own-source lessons
CREATE POLICY "Independent tutor creates own-source lessons"
ON public.lessons FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'tutor'::app_role)
  AND tutor_id = auth.uid()
  AND created_by = auth.uid()
  AND source = 'independent'
  AND public.is_independent_tutor(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.student_rates r
    WHERE r.tutor_id = auth.uid()
      AND r.student_id = lessons.student_id
      AND r.source = 'independent'
  )
);

-- 8. Independent tutor updates own-source lesson financials
CREATE POLICY "Independent tutor updates own-source lesson financials"
ON public.lessons FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'tutor'::app_role)
  AND auth.uid() = tutor_id
  AND source = 'independent'
  AND public.is_independent_tutor(auth.uid())
)
WITH CHECK (
  has_role(auth.uid(), 'tutor'::app_role)
  AND auth.uid() = tutor_id
  AND source = 'independent'
  AND public.is_independent_tutor(auth.uid())
);

-- 9. Independent tutor deletes own-source lessons
CREATE POLICY "Independent tutor deletes own-source lessons"
ON public.lessons FOR DELETE
TO authenticated
USING (
  has_role(auth.uid(), 'tutor'::app_role)
  AND auth.uid() = tutor_id
  AND source = 'independent'
  AND public.is_independent_tutor(auth.uid())
);

-- 10. Update protect_lesson_fields to allow independent tutors
CREATE OR REPLACE FUNCTION public.protect_lesson_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _is_manager boolean := public.has_role(auth.uid(), 'manager'::app_role);
  _is_tutor   boolean := (auth.uid() = OLD.tutor_id);
  _is_student boolean := (auth.uid() = OLD.student_id);
  _is_independent_own boolean := (
    OLD.source = 'independent'
    AND auth.uid() = OLD.tutor_id
    AND public.is_independent_tutor(auth.uid())
  );
BEGIN
  IF _is_manager THEN
    RETURN NEW;
  END IF;

  IF _is_independent_own THEN
    IF NEW.tutor_id IS DISTINCT FROM OLD.tutor_id OR NEW.student_id IS DISTINCT FROM OLD.student_id THEN
      RAISE EXCEPTION 'Не можна змінювати учасників уроку';
    END IF;
    IF NEW.source IS DISTINCT FROM OLD.source THEN
      RAISE EXCEPTION 'Не можна змінювати тип уроку';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.student_price          IS DISTINCT FROM OLD.student_price
     OR NEW.tutor_payout        IS DISTINCT FROM OLD.tutor_payout
     OR NEW.student_payment_status IS DISTINCT FROM OLD.student_payment_status
     OR NEW.tutor_payout_status IS DISTINCT FROM OLD.tutor_payout_status
     OR NEW.student_paid_at     IS DISTINCT FROM OLD.student_paid_at
     OR NEW.tutor_paid_at       IS DISTINCT FROM OLD.tutor_paid_at
     OR NEW.tutor_id            IS DISTINCT FROM OLD.tutor_id
     OR NEW.student_id          IS DISTINCT FROM OLD.student_id
     OR NEW.source              IS DISTINCT FROM OLD.source
  THEN
    RAISE EXCEPTION 'Тільки менеджер може змінювати фінансові поля та учасників уроку';
  END IF;

  IF NEW.meeting_url IS DISTINCT FROM OLD.meeting_url
     OR NEW.homework IS DISTINCT FROM OLD.homework
     OR NEW.summary  IS DISTINCT FROM OLD.summary
  THEN
    IF NOT _is_tutor THEN
      RAISE EXCEPTION 'Лише репетитор може редагувати посилання, домашку та конспект уроку';
    END IF;
  END IF;

  IF NEW.student_notes IS DISTINCT FROM OLD.student_notes THEN
    IF NOT _is_student THEN
      RAISE EXCEPTION 'Лише учень може редагувати свої нотатки';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 11. Independent tutor creates ghost profiles
CREATE POLICY "Independent tutor creates own student profiles"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (
  public.is_independent_tutor(auth.uid())
  AND is_pending = true
);

-- 12. Independent tutor updates own student profiles
CREATE POLICY "Independent tutor updates own student profiles"
ON public.profiles FOR UPDATE
TO authenticated
USING (
  public.is_independent_tutor(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.student_rates r
    WHERE r.tutor_id = auth.uid()
      AND r.student_id = profiles.id
      AND r.source = 'independent'
  )
);

-- 13. Independent tutor manages own student contacts
CREATE POLICY "Independent tutor manages own student contacts"
ON public.profile_contacts FOR ALL
TO authenticated
USING (
  public.is_independent_tutor(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.student_rates r
    WHERE r.tutor_id = auth.uid()
      AND r.student_id = profile_contacts.user_id
      AND r.source = 'independent'
  )
)
WITH CHECK (
  public.is_independent_tutor(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.student_rates r
    WHERE r.tutor_id = auth.uid()
      AND r.student_id = profile_contacts.user_id
      AND r.source = 'independent'
  )
);

-- 14. Independent tutor manages own student details
CREATE POLICY "Independent tutor manages own student details"
ON public.student_details FOR ALL
TO authenticated
USING (
  public.is_independent_tutor(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.student_rates r
    WHERE r.tutor_id = auth.uid()
      AND r.student_id = student_details.user_id
      AND r.source = 'independent'
  )
)
WITH CHECK (
  public.is_independent_tutor(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.student_rates r
    WHERE r.tutor_id = auth.uid()
      AND r.student_id = student_details.user_id
      AND r.source = 'independent'
  )
);

-- 15. Independent tutor assigns student role to own ghosts
CREATE POLICY "Independent tutor assigns student role to own ghosts"
ON public.user_roles FOR INSERT
TO authenticated
WITH CHECK (
  public.is_independent_tutor(auth.uid())
  AND role = 'student'::app_role
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = user_roles.user_id AND p.is_pending = true
  )
);

-- 16. Update handle_new_user to support role choice + independent flag
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _is_first_user BOOLEAN;
  _assigned_role app_role;
  _requested_role TEXT;
  _phone TEXT;
  _email TEXT;
  _merged uuid;
  _has_role BOOLEAN;
  _wants_independent BOOLEAN;
BEGIN
  _email := NEW.email;
  _phone := NEW.raw_user_meta_data->>'phone';
  _requested_role := NEW.raw_user_meta_data->>'role';
  _wants_independent := COALESCE((NEW.raw_user_meta_data->>'independent_workspace')::boolean, false);

  INSERT INTO public.profiles (id, first_name, last_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', '')
  );

  INSERT INTO public.profile_contacts (user_id, phone, email)
  VALUES (NEW.id, NULLIF(_phone, ''), NULLIF(_email, ''))
  ON CONFLICT (user_id) DO NOTHING;

  _merged := public.merge_pending_profile(NEW.id, _email, _phone);

  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id) INTO _has_role;

  IF NOT _has_role THEN
    SELECT NOT EXISTS (SELECT 1 FROM public.user_roles) INTO _is_first_user;

    IF _is_first_user THEN
      _assigned_role := 'manager'::app_role;
    ELSIF _requested_role = 'tutor' THEN
      _assigned_role := 'tutor'::app_role;
    ELSE
      _assigned_role := 'student'::app_role;
    END IF;

    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _assigned_role);

    IF _assigned_role = 'student' THEN
      INSERT INTO public.student_details (user_id) VALUES (NEW.id)
      ON CONFLICT (user_id) DO NOTHING;
    ELSIF _assigned_role = 'tutor' THEN
      INSERT INTO public.tutor_details (user_id) VALUES (NEW.id)
      ON CONFLICT (user_id) DO NOTHING;

      INSERT INTO public.tutor_workspace_settings (tutor_id, independent_workspace)
      VALUES (NEW.id, _wants_independent)
      ON CONFLICT (tutor_id) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 17. Backfill workspace settings for existing tutors
INSERT INTO public.tutor_workspace_settings (tutor_id, independent_workspace)
SELECT user_id, false
FROM public.user_roles
WHERE role = 'tutor'::app_role
ON CONFLICT (tutor_id) DO NOTHING;