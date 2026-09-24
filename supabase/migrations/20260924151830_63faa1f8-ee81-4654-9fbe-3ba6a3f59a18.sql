CREATE OR REPLACE FUNCTION public.guard_user_roles_writes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row record := COALESCE(NEW, OLD);
  _is_ghost boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN _row;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE')
     AND NEW.role = 'manager'::app_role
     AND NOT public.is_superadmin()
     AND current_setting('app.allow_manager_role', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Only the platform admin can grant the manager role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF public.is_superadmin() OR current_setting('app.allow_manager_role', true) = '1' THEN
    RETURN _row;
  END IF;
  -- 24.09: перша роль після входу через Google. Прапорець ставить лише
  -- claim_tutor_role() (транзакційно); 'manager' сюди не доходить — виняток вище.
  IF current_setting('app.allow_initial_role', true) = '1' THEN
    RETURN _row;
  END IF;
  IF public.has_role(auth.uid(), 'manager'::app_role) THEN
    RETURN _row;
  END IF;
  IF TG_OP = 'INSERT'
     AND NEW.role = 'student'::app_role
     AND public.is_independent_tutor(auth.uid()) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = NEW.user_id AND p.is_pending = true
    ) INTO _is_ghost;
    IF _is_ghost THEN
      RETURN NEW;
    END IF;
  END IF;
  IF TG_OP = 'DELETE'
     AND OLD.role = 'student'::app_role
     AND public.is_independent_tutor(auth.uid()) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = OLD.user_id AND p.is_pending = true
    ) INTO _is_ghost;
    IF _is_ghost THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'Only managers can modify user roles';
END; $$;

CREATE OR REPLACE FUNCTION public.claim_tutor_role()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _created timestamptz;
  _has_tutor boolean;
  _blocked boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Auth required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT u.created_at INTO _created FROM auth.users u WHERE u.id = _uid;
  IF _created IS NULL OR _created < now() - interval '24 hours' THEN
    RETURN 'too_late';
  END IF;
  SELECT bool_or(r.role = 'tutor'::app_role) INTO _has_tutor
    FROM public.user_roles r WHERE r.user_id = _uid;
  IF COALESCE(_has_tutor, false) THEN
    RETURN 'already_tutor';
  END IF;
  -- Акаунт, який уже ЖИВЕ як учень, роль не міняє: чужі уроки й оплати
  -- не мають переїжджати в репетиторський простір.
  SELECT EXISTS (SELECT 1 FROM public.student_rates sr WHERE sr.student_id = _uid)
      OR EXISTS (SELECT 1 FROM public.lessons l WHERE l.student_id = _uid)
      OR EXISTS (SELECT 1 FROM public.hub_members hm WHERE hm.user_id = _uid)
      OR EXISTS (SELECT 1 FROM public.user_roles r2 WHERE r2.user_id = _uid AND r2.role = 'manager'::app_role)
    INTO _blocked;
  IF _blocked THEN
    RETURN 'has_data';
  END IF;
  PERFORM set_config('app.allow_initial_role', '1', true);
  DELETE FROM public.user_roles r WHERE r.user_id = _uid AND r.role = 'student'::app_role;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (_uid, 'tutor'::app_role)
  ON CONFLICT (user_id, role) DO NOTHING;
  -- Самостійний воркспейс + той самий 30-денний тріал, що й при реєстрації поштою.
  PERFORM set_config('app.allow_independent_optin', '1', true);
  INSERT INTO public.tutor_workspace_settings (tutor_id, independent_workspace, subscription_status, trial_until)
  VALUES (_uid, true, 'trial', now() + interval '30 days')
  ON CONFLICT (tutor_id) DO UPDATE
    SET independent_workspace = true,
        subscription_status = COALESCE(public.tutor_workspace_settings.subscription_status, 'trial'),
        trial_until = COALESCE(public.tutor_workspace_settings.trial_until, now() + interval '30 days');
  RETURN 'ok';
END; $$;

REVOKE EXECUTE ON FUNCTION public.claim_tutor_role() FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.claim_tutor_role() TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'claim_tutor_role') THEN
    RAISE EXCEPTION 'claim_tutor_role не створено';
  END IF;
  RAISE NOTICE 'Google-реєстрація: claim_tutor_role готова (24 години, лише чистий акаунт)';
END $$;