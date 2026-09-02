CREATE OR REPLACE FUNCTION public.protect_lesson_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tutor_id IS DISTINCT FROM OLD.tutor_id THEN
      RAISE EXCEPTION 'tutor_id is immutable';
    END IF;
    IF NEW.student_id IS DISTINCT FROM OLD.student_id THEN
      RAISE EXCEPTION 'student_id is immutable';
    END IF;
    IF auth.uid() IS NOT NULL AND NEW.source IS DISTINCT FROM OLD.source THEN
      RAISE EXCEPTION 'lesson source is immutable'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_lesson_fields_trg     ON public.lessons;
DROP TRIGGER IF EXISTS protect_lesson_fields_trigger ON public.lessons;
DROP TRIGGER IF EXISTS trg_protect_lesson_fields     ON public.lessons;
CREATE TRIGGER trg_protect_lesson_fields
  BEFORE UPDATE ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.protect_lesson_fields();

COMMENT ON FUNCTION public.protect_lesson_fields() IS
  'tutor_id, student_id і source незмінні для будь-якого авторизованого запису. '
  'source — бо саме він вирішує, чиї це гроші (hub = школи, independent = репетитора).';

CREATE OR REPLACE FUNCTION public.fill_group_participant_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _price    numeric;
  _currency text;
  _source   text;
  _is_mgr   boolean := public.has_role(auth.uid(), 'manager'::app_role);
BEGIN
  SELECT l.source INTO _source FROM public.lessons l WHERE l.id = NEW.lesson_id;

  IF auth.uid() IS NOT NULL AND NOT _is_mgr AND (_source = 'hub' OR _source IS NULL) THEN
    NEW.student_price          := NULL;
    NEW.student_payment_status := 'unpaid';
    NEW.student_paid_at        := NULL;
  END IF;

  IF NEW.student_price IS NULL THEN
    SELECT e.price_per_lesson, e.currency INTO _price, _currency
    FROM public.lessons l
    JOIN public.group_enrollments e
      ON e.group_id = l.group_id AND e.student_id = NEW.student_id
    WHERE l.id = NEW.lesson_id
    LIMIT 1;
    IF _price IS NOT NULL THEN
      NEW.student_price := _price;
      IF _currency IS NOT NULL THEN NEW.currency := _currency; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_group_participant_price ON public.lesson_participants;
CREATE TRIGGER trg_fill_group_participant_price
BEFORE INSERT ON public.lesson_participants
FOR EACH ROW EXECUTE FUNCTION public.fill_group_participant_price();

CREATE OR REPLACE FUNCTION public.guard_group_enrollment_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _group_tutor uuid;
  _independent boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF public.has_role(auth.uid(), 'manager'::app_role) THEN RETURN NEW; END IF;

  SELECT g.tutor_id INTO _group_tutor
  FROM public.lesson_groups g WHERE g.id = NEW.group_id;

  _independent := EXISTS (
    SELECT 1 FROM public.tutor_workspace_settings ws
    WHERE ws.tutor_id = _group_tutor AND ws.independent_workspace = true
  );

  IF NOT _independent THEN
    NEW.price_per_lesson := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_group_enrollment_price ON public.group_enrollments;
CREATE TRIGGER trg_guard_group_enrollment_price
BEFORE INSERT ON public.group_enrollments
FOR EACH ROW EXECUTE FUNCTION public.guard_group_enrollment_price();

CREATE OR REPLACE FUNCTION public.get_referral_savings_uah(_tutor_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(ROUND(SUM(days_granted)::numeric * 299 / 30), 0)::numeric
  FROM public.pro_bonus_ledger
  WHERE tutor_id = _tutor_id
    AND (_tutor_id = auth.uid() OR public.has_role(auth.uid(), 'manager'::app_role))
    AND reason IN ('referral_pro_upgrade', 'referral_3_pro_in_month', 'referral_signup_referrer');
$$;
REVOKE ALL     ON FUNCTION public.get_referral_savings_uah(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_referral_savings_uah(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_wallet_balance(_tutor_id uuid, _student_id uuid)
RETURNS TABLE(lessons_balance integer, amount_balance numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _tutor_independent boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;

  _tutor_independent := EXISTS (
    SELECT 1 FROM public.tutor_workspace_settings ws
    WHERE ws.tutor_id = _tutor_id AND ws.independent_workspace = true
  );

  IF NOT (
    (public.has_role(auth.uid(), 'manager'::app_role) AND NOT _tutor_independent)
    OR auth.uid() = _tutor_id
    OR auth.uid() = _student_id
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
    SELECT COALESCE(SUM(swt.lessons_delta), 0)::int,
           COALESCE(SUM(swt.amount_delta), 0)::numeric(12,2)
    FROM public.student_wallet_transactions swt
    WHERE swt.tutor_id = _tutor_id AND swt.student_id = _student_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_subscription_request(
  _request_id uuid,
  _months     integer DEFAULT NULL,
  _response   text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _req    record;
  _m      integer;
  _cur    record;
  _until  timestamptz;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;

  IF NOT (public.has_role(_caller, 'manager'::app_role) OR public.is_superadmin()) THEN
    RAISE EXCEPTION 'Only a manager or platform admin can approve subscription requests'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO _req FROM public.subscription_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription request not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF _req.status = 'completed' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'tutor_id', _req.tutor_id);
  END IF;

  _m := COALESCE(
    _months,
    CASE _req.plan
      WHEN 'yearly'   THEN 12
      WHEN 'halfyear' THEN 6
      ELSE 1
    END
  );
  IF _m < 1 OR _m > 24 THEN
    RAISE EXCEPTION 'months must be between 1 and 24' USING ERRCODE = 'check_violation';
  END IF;

  SELECT subscription_status, subscription_until
    INTO _cur
    FROM public.tutor_workspace_settings
   WHERE tutor_id = _req.tutor_id
     FOR UPDATE;

  IF NOT FOUND THEN
    _until := now() + (_m || ' months')::interval;
    INSERT INTO public.tutor_workspace_settings (tutor_id, subscription_status, subscription_until, current_plan)
    VALUES (_req.tutor_id, 'active', _until, _req.plan);
  ELSE
    _until := GREATEST(COALESCE(_cur.subscription_until, now()), now()) + (_m || ' months')::interval;
    UPDATE public.tutor_workspace_settings
       SET subscription_status = 'active',
           subscription_until  = _until,
           current_plan        = _req.plan,
           updated_at          = now()
     WHERE tutor_id = _req.tutor_id;
  END IF;

  INSERT INTO public.pro_bonus_ledger (tutor_id, days_granted, reason, metadata)
  VALUES (
    _req.tutor_id,
    _m * 30,
    'manual_approval',
    jsonb_build_object('request_id', _request_id, 'plan', _req.plan,
                       'price', _req.price, 'approved_by', _caller)
  );

  UPDATE public.subscription_requests
     SET status           = 'completed',
         handled_by       = _caller,
         handled_at       = now(),
         manager_response = COALESCE(NULLIF(_response, ''), manager_response),
         updated_at       = now()
   WHERE id = _request_id;

  PERFORM public.create_notification(
    _req.tutor_id,
    'subscription_activated_' || _request_id::text,
    '👑 Pro активовано',
    'Підписка діє до ' || to_char(_until AT TIME ZONE 'Europe/Kyiv', 'DD.MM.YYYY') || '.',
    '/subscription'
  );

  RETURN jsonb_build_object('ok', true, 'already', false,
                            'tutor_id', _req.tutor_id, 'until', _until);
END;
$$;
REVOKE ALL     ON FUNCTION public.approve_subscription_request(uuid, integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.approve_subscription_request(uuid, integer, text) TO authenticated;