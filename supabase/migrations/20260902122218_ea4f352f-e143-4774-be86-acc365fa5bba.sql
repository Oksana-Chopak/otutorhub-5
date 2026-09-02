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

  /* Тільки менеджер або суперадмін. RLS на subscription_requests уже дозволяє
     менеджеру UPDATE, але ця функція обходить RLS — тому перевірка тут явна. */
  IF NOT (public.has_role(_caller, 'manager'::app_role) OR public.is_superadmin()) THEN
    RAISE EXCEPTION 'Only a manager or platform admin can approve subscription requests'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO _req FROM public.subscription_requests WHERE id = _request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription request not found' USING ERRCODE = 'no_data_found';
  END IF;

  /* Ідемпотентність: повторний клік не подовжує підписку вдруге. Це найдешевша
     помилка в цьому місці — менеджер тисне двічі, бо перший клік «завис». */
  IF _req.status = 'completed' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'tutor_id', _req.tutor_id);
  END IF;

  /* Скільки місяців. Явний аргумент має пріоритет; інакше — з плану заявки. */
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
   WHERE tutor_id = _req.tutor_id;

  IF NOT FOUND THEN
    INSERT INTO public.tutor_workspace_settings (tutor_id, subscription_status, subscription_until, current_plan)
    VALUES (_req.tutor_id, 'active', now() + (_m || ' months')::interval, _req.plan);
    _until := now() + (_m || ' months')::interval;
  ELSE
    /* Продовжуємо від більшої з двох дат: якщо підписка ще жива — додаємо
       зверху, якщо вже протухла — рахуємо від сьогодні. */
    _until := GREATEST(COALESCE(_cur.subscription_until, now()), now()) + (_m || ' months')::interval;
    UPDATE public.tutor_workspace_settings
       SET subscription_status = 'active',
           subscription_until  = _until,
           current_plan        = _req.plan,
           updated_at          = now()
     WHERE tutor_id = _req.tutor_id;
  END IF;

  /* Слід в аудиті: скільки днів і за що. Reason НЕ з переліку referral_* —
     get_referral_savings_uah його не рахує (див. 20260902140000). */
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

REVOKE ALL    ON FUNCTION public.approve_subscription_request(uuid, integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.approve_subscription_request(uuid, integer, text) TO authenticated;

COMMENT ON FUNCTION public.approve_subscription_request(uuid, integer, text) IS
  'Ставить заявку в completed І реально вмикає Pro (subscription_status/until/current_plan). '
  'Роль перевіряється всередині (manager або superadmin), бо функція обходить RLS. '
  'Ідемпотентна: повторний виклик на completed-заявці нічого не подовжує.';

/* ── Відмова: статус клієнт може поставити й сам (RLS дозволяє менеджеру
   UPDATE), але сповіщення репетитору з клієнта не піде — create_notification
   дедуплікує за типом, а головне: репетитор мусить дізнатися. Окрема
   функція, щоб обидва шляхи були симетричні й лишали handled_by. ── */
CREATE OR REPLACE FUNCTION public.reject_subscription_request(
  _request_id uuid,
  _response   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _req    record;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;
  IF NOT (public.has_role(_caller, 'manager'::app_role) OR public.is_superadmin()) THEN
    RAISE EXCEPTION 'Only a manager or platform admin can reject subscription requests'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO _req FROM public.subscription_requests WHERE id = _request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription request not found' USING ERRCODE = 'no_data_found';
  END IF;

  /* Уже опрацьовану заявку не «відмовляємо» — інакше одним кліком можна
     скасувати підтвердження, за яке людина заплатила (Pro при цьому лишиться,
     і стан стане суперечливим). */
  IF _req.status = 'completed' THEN
    RAISE EXCEPTION 'Cannot reject an already completed request' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.subscription_requests
     SET status           = 'rejected',
         handled_by       = _caller,
         handled_at       = now(),
         manager_response = COALESCE(NULLIF(_response, ''), manager_response),
         updated_at       = now()
   WHERE id = _request_id;

  PERFORM public.create_notification(
    _req.tutor_id,
    'subscription_rejected_' || _request_id::text,
    'Заявку на Pro не підтверджено',
    COALESCE(NULLIF(_response, ''), 'Напишіть у підтримку — розберемось.'),
    '/subscription'
  );

  RETURN jsonb_build_object('ok', true, 'tutor_id', _req.tutor_id);
END;
$$;

REVOKE ALL    ON FUNCTION public.reject_subscription_request(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reject_subscription_request(uuid, text) TO authenticated;