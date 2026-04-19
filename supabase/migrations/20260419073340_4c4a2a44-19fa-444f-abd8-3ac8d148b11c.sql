-- 1. Move phone from profiles to a separate profile_contacts table (PII protection)
CREATE TABLE IF NOT EXISTS public.profile_contacts (
  user_id uuid PRIMARY KEY,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Backfill existing phones
INSERT INTO public.profile_contacts (user_id, phone)
SELECT id, phone FROM public.profiles WHERE phone IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE public.profile_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner views own contact"
  ON public.profile_contacts FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Manager views all contacts"
  ON public.profile_contacts FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Owner upserts own contact"
  ON public.profile_contacts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owner updates own contact"
  ON public.profile_contacts FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Manager manages contacts"
  ON public.profile_contacts FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (has_role(auth.uid(), 'manager'::app_role));

CREATE TRIGGER trg_profile_contacts_updated_at
BEFORE UPDATE ON public.profile_contacts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Drop phone from profiles (now exposed via restricted contacts table)
ALTER TABLE public.profiles DROP COLUMN IF EXISTS phone;

-- Update handle_new_user to write phone into profile_contacts
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _is_first_user BOOLEAN;
  _assigned_role app_role;
  _phone TEXT;
BEGIN
  INSERT INTO public.profiles (id, first_name, last_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', '')
  );

  _phone := NEW.raw_user_meta_data->>'phone';
  IF _phone IS NOT NULL AND _phone <> '' THEN
    INSERT INTO public.profile_contacts (user_id, phone) VALUES (NEW.id, _phone);
  END IF;

  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles) INTO _is_first_user;
  _assigned_role := CASE WHEN _is_first_user THEN 'manager'::app_role ELSE 'student'::app_role END;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _assigned_role);

  IF _assigned_role = 'student' THEN
    INSERT INTO public.student_details (user_id) VALUES (NEW.id);
  END IF;

  RETURN NEW;
END;
$function$;

-- 2. Restrict tutor access to student_details: only students they teach
DROP POLICY IF EXISTS "Tutors view student details" ON public.student_details;

CREATE POLICY "Tutor views own students details"
  ON public.student_details FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'tutor'::app_role)
    AND (
      EXISTS (
        SELECT 1 FROM public.lessons l
        WHERE l.tutor_id = auth.uid() AND l.student_id = student_details.user_id
      )
      OR EXISTS (
        SELECT 1 FROM public.student_rates r
        WHERE r.tutor_id = auth.uid() AND r.student_id = student_details.user_id
      )
    )
  );

-- 3. Install trigger to protect lesson financial fields from non-managers
DROP TRIGGER IF EXISTS trg_protect_lesson_financials ON public.lessons;
CREATE TRIGGER trg_protect_lesson_financials
BEFORE UPDATE ON public.lessons
FOR EACH ROW EXECUTE FUNCTION public.protect_lesson_financials();

-- Also install the autofill and payment-date triggers (they exist as functions but not as triggers per scan)
DROP TRIGGER IF EXISTS trg_autofill_lesson_prices ON public.lessons;
CREATE TRIGGER trg_autofill_lesson_prices
BEFORE INSERT ON public.lessons
FOR EACH ROW EXECUTE FUNCTION public.autofill_lesson_prices();

DROP TRIGGER IF EXISTS trg_set_payment_dates ON public.lessons;
CREATE TRIGGER trg_set_payment_dates
BEFORE UPDATE ON public.lessons
FOR EACH ROW EXECUTE FUNCTION public.set_payment_dates();

-- Install handle_new_user trigger on auth.users if missing
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at triggers for other tables
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_student_details_updated_at ON public.student_details;
CREATE TRIGGER trg_student_details_updated_at
BEFORE UPDATE ON public.student_details
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_tutor_details_updated_at ON public.tutor_details;
CREATE TRIGGER trg_tutor_details_updated_at
BEFORE UPDATE ON public.tutor_details
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_student_rates_updated_at ON public.student_rates;
CREATE TRIGGER trg_student_rates_updated_at
BEFORE UPDATE ON public.student_rates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_lessons_updated_at ON public.lessons;
CREATE TRIGGER trg_lessons_updated_at
BEFORE UPDATE ON public.lessons
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();