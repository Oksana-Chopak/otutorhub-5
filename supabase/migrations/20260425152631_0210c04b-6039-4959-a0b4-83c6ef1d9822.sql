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
  _is_pending_profile_merge boolean := COALESCE(current_setting('app.pending_profile_merge', true), '') = 'on';
BEGIN
  IF _is_pending_profile_merge THEN
    RETURN NEW;
  END IF;

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

CREATE OR REPLACE FUNCTION public.merge_pending_profile(_real_id uuid, _email text, _phone text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _ghost_id uuid;
BEGIN
  SELECT p.id INTO _ghost_id
  FROM public.profiles p
  JOIN public.profile_contacts c ON c.user_id = p.id
  WHERE p.is_pending = true
    AND (
      (_email IS NOT NULL AND _email <> '' AND lower(c.email) = lower(_email))
      OR (_phone IS NOT NULL AND _phone <> '' AND c.phone = _phone)
    )
  LIMIT 1;

  IF _ghost_id IS NULL OR _ghost_id = _real_id THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('app.pending_profile_merge', 'on', true);

  UPDATE public.lessons SET tutor_id = _real_id WHERE tutor_id = _ghost_id;
  UPDATE public.lessons SET student_id = _real_id WHERE student_id = _ghost_id;
  UPDATE public.lessons SET created_by = _real_id WHERE created_by = _ghost_id;
  UPDATE public.student_rates SET tutor_id = _real_id WHERE tutor_id = _ghost_id;
  UPDATE public.student_rates SET student_id = _real_id WHERE student_id = _ghost_id;

  UPDATE public.tutor_details SET user_id = _real_id
    WHERE user_id = _ghost_id
      AND NOT EXISTS (SELECT 1 FROM public.tutor_details WHERE user_id = _real_id);
  DELETE FROM public.tutor_details WHERE user_id = _ghost_id;

  UPDATE public.student_details SET user_id = _real_id
    WHERE user_id = _ghost_id
      AND NOT EXISTS (SELECT 1 FROM public.student_details WHERE user_id = _real_id);
  DELETE FROM public.student_details WHERE user_id = _ghost_id;

  INSERT INTO public.user_roles (user_id, role)
  SELECT _real_id, role FROM public.user_roles WHERE user_id = _ghost_id
  ON CONFLICT (user_id, role) DO NOTHING;
  DELETE FROM public.user_roles WHERE user_id = _ghost_id;

  UPDATE public.profiles r
    SET first_name = COALESCE(NULLIF(r.first_name, ''), g.first_name),
        last_name  = COALESCE(NULLIF(r.last_name, ''),  g.last_name)
    FROM public.profiles g
    WHERE r.id = _real_id AND g.id = _ghost_id;

  INSERT INTO public.profile_contacts (user_id, email, phone)
  SELECT _real_id, c.email, c.phone FROM public.profile_contacts c WHERE c.user_id = _ghost_id
  ON CONFLICT (user_id) DO UPDATE
    SET email = COALESCE(public.profile_contacts.email, EXCLUDED.email),
        phone = COALESCE(public.profile_contacts.phone, EXCLUDED.phone);
  DELETE FROM public.profile_contacts WHERE user_id = _ghost_id;

  DELETE FROM public.profiles WHERE id = _ghost_id;

  PERFORM set_config('app.pending_profile_merge', '', true);

  RETURN _ghost_id;
END;
$function$;