/* ============================================================================
   Школа запрошує учня, який УЖЕ має акаунт (11.11, перша зовнішня школа).

   Менеджер додавав учня за поштою, а пошта вже зареєстрована (учень колись заходив
   сам або вчиться в самостійного репетитора) — і отримував «цей email вже
   зареєстровано». Глухий кут: у школу таку людину не міг додати ніхто, крім
   суперадміна руками в базі.

   Просто «додати за поштою» не можна: членство у школі відкриває менеджеру імʼя,
   контакти й уроки людини, тож знаючи чужу пошту, можна було б забрати її собі.
   Тому — запрошення зі згодою: менеджер надсилає, людина бачить «Школа X запрошує»
   і сама натискає «Приєднатись». Лише тоді вона стає учнем школи.

   Таблиця без політик — усе через три функції. Ідемпотентно.
   -- LIVE-MARKER: hub_invite_existing_student
   ============================================================================ */

CREATE TABLE IF NOT EXISTS public.hub_join_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id      uuid NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invited_by  uuid NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (hub_id, user_id)
);
ALTER TABLE public.hub_join_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hub_join_invites FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.hub_join_invites TO service_role;

-- Менеджер: запросити людину з акаунтом у свою школу як учня.
-- Відповідь словом, щоб екран сказав правду: sent · already_member · not_found · not_student · limit
CREATE OR REPLACE FUNCTION public.hub_invite_existing_student(_email text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _hub uuid; _hub_name text; _uid uuid; _invite uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'Only a school manager can invite' USING ERRCODE = 'insufficient_privilege';
  END IF;
  _hub := public.caller_hub_id();
  IF _hub IS NULL THEN
    RAISE EXCEPTION 'No school for this manager' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- стеля: перебирати чужі пошти цією функцією не вийде
  IF public.rate_limit_check('hub_invite', auth.uid()::text, 20, 3600) THEN   -- true = понад стелю
    RETURN 'limit';
  END IF;

  _uid := public.user_id_by_email(_email);
  IF _uid IS NULL OR _uid = auth.uid() THEN RETURN 'not_found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND r.role = 'student'::app_role) THEN
    RETURN 'not_student';
  END IF;
  IF EXISTS (SELECT 1 FROM public.hub_members m WHERE m.hub_id = _hub AND m.user_id = _uid) THEN
    RETURN 'already_member';
  END IF;

  INSERT INTO public.hub_join_invites (hub_id, user_id, invited_by)
  VALUES (_hub, _uid, auth.uid())
  ON CONFLICT (hub_id, user_id) DO UPDATE
    SET status = 'pending', invited_by = EXCLUDED.invited_by, created_at = now(), resolved_at = NULL
  RETURNING id INTO _invite;

  SELECT h.name INTO _hub_name FROM public.hubs h WHERE h.id = _hub;
  -- сповіщення напряму: create_notification дозволяє менеджеру писати лише СВОЇЙ школі,
  -- а ця людина ще не в ній — саме тому й запрошення
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_uid, 'hub_invite_' || _invite::text,
          format('Школа «%s» запрошує вас', coalesce(_hub_name, 'школа')),
          'Приєднайтесь, щоб бачити уроки, домашні завдання й оплати школи.',
          '/student-dashboard');
  RETURN 'sent';
END $$;
REVOKE ALL ON FUNCTION public.hub_invite_existing_student(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hub_invite_existing_student(text) TO authenticated;

-- Людина: які школи мене запрошують
CREATE OR REPLACE FUNCTION public.my_hub_invites()
RETURNS TABLE (id uuid, hub_name text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, h.name, i.created_at
    FROM public.hub_join_invites i
    JOIN public.hubs h ON h.id = i.hub_id
   WHERE i.user_id = auth.uid() AND i.status = 'pending'
   ORDER BY i.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.my_hub_invites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_hub_invites() TO authenticated;

-- Людина: прийняти чи відхилити. Членство зʼявляється лише тут і лише з її дії.
CREATE OR REPLACE FUNCTION public.resolve_hub_invite(_id uuid, _accept boolean)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _inv public.hub_join_invites%ROWTYPE; _who text;
BEGIN
  SELECT * INTO _inv FROM public.hub_join_invites
   WHERE id = _id AND user_id = auth.uid() AND status = 'pending'
   FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  UPDATE public.hub_join_invites
     SET status = CASE WHEN _accept THEN 'accepted' ELSE 'declined' END, resolved_at = now()
   WHERE id = _id;
  IF NOT _accept THEN RETURN 'declined'; END IF;

  INSERT INTO public.hub_members (hub_id, user_id) VALUES (_inv.hub_id, _inv.user_id)
  ON CONFLICT DO NOTHING;

  SELECT nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') INTO _who
    FROM public.profiles p WHERE p.id = _inv.user_id;
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_inv.invited_by, 'hub_invite_accepted_' || _id::text,
          format('%s приєднується до школи', coalesce(_who, 'Учень')),
          'Тепер можна призначити репетитора і ціну.',
          '/people?open=' || _inv.user_id::text);
  RETURN 'accepted';
END $$;
REVOKE ALL ON FUNCTION public.resolve_hub_invite(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_hub_invite(uuid, boolean) TO authenticated;
