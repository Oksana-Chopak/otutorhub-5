/* ============================================================================
   Публічна сторінка школи: «Записатись до школи X» (11.11, перша зовнішня школа).

   У шляху школи не було жодного моменту «поділитись»: школа не мала посилання,
   яке можна поставити в Instagram чи надіслати батькам, а заявки приймала в
   особистих повідомленнях. Тепер менеджер вмикає сторінку школи (вимкнена, доки
   він сам не ввімкне) — на ній назва, кілька слів про школу, предмети й форма
   заявки. Заявка лягає школі, менеджерам приходить сповіщення.

   Це публічні двері, тому:
   · сторінка показує ЛИШЕ назву, опис і предмети — жодних імен репетиторів, цін, учнів;
   · анонім нічого не пише в профілі й не створює акаунтів — заявка живе окремим рядком;
   · стелі в базі: 5 заявок на годину з однієї адреси, 40 на годину на школу;
   · посилання й домени з імені та коментаря вирізаються (вони йдуть у заголовок сповіщення);
   · таблиця заявок без політик — менеджер читає лише через функцію, лише свою школу.

   Ідемпотентно. -- LIVE-MARKER: hub_public_page
   ============================================================================ */

ALTER TABLE public.hubs
  ADD COLUMN IF NOT EXISTS public_slug    text,
  ADD COLUMN IF NOT EXISTS public_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_about   text;
CREATE UNIQUE INDEX IF NOT EXISTS hubs_public_slug_uniq ON public.hubs (public_slug) WHERE public_slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.hub_leads (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id     uuid NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  name       text NOT NULL,
  contact    text NOT NULL,
  subject    text,
  note       text,
  status     text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'done')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hub_leads_hub_created_idx ON public.hub_leads (hub_id, created_at DESC);
ALTER TABLE public.hub_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hub_leads FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.hub_leads TO service_role;

-- Текст від сторонньої людини: без посилань і доменів, без переносів, обрізаний.
CREATE OR REPLACE FUNCTION public.lead_text_clean(_t text, _max int)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT nullif(left(trim(regexp_replace(regexp_replace(
           coalesce(_t, ''),
           '(https?://|www\.)\S+|\S+\.(com|ua|net|org|ru|io|me|app|info|biz|xyz|top|site|online|link)(/\S*)?', '', 'gi'),
           '\s+', ' ', 'g')), _max), '');
$$;

-- Адреса сторінки: латиниця з назви, інакше — короткий код.
CREATE OR REPLACE FUNCTION public.hub_make_slug(_name text)
RETURNS text LANGUAGE plpgsql VOLATILE SET search_path = public AS $$
DECLARE
  _base text := trim(both '-' from regexp_replace(lower(coalesce(_name, '')), '[^a-z0-9]+', '-', 'g'));
  _slug text; _i int := 0;
BEGIN
  IF length(_base) < 3 THEN _base := 'school'; END IF;
  _base := left(_base, 40);
  _slug := _base;
  WHILE EXISTS (SELECT 1 FROM public.hubs h WHERE h.public_slug = _slug) LOOP
    _i := _i + 1;
    _slug := _base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 4);
    EXIT WHEN _i > 20;
  END LOOP;
  RETURN _slug;
END $$;
REVOKE ALL ON FUNCTION public.hub_make_slug(text) FROM PUBLIC, anon, authenticated;

-- Менеджер: увімкнути/вимкнути сторінку своєї школи, задати опис. Повертає стан.
CREATE OR REPLACE FUNCTION public.set_hub_public_page(_enabled boolean, _about text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _hub uuid; _row public.hubs%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'Only a school manager can do this' USING ERRCODE = 'insufficient_privilege';
  END IF;
  _hub := public.caller_hub_id();
  IF _hub IS NULL THEN
    RAISE EXCEPTION 'No school for this manager' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO _row FROM public.hubs WHERE id = _hub FOR UPDATE;
  UPDATE public.hubs
     SET public_enabled = coalesce(_enabled, false),
         public_about   = CASE WHEN _about IS NULL THEN public_about ELSE public.lead_text_clean(_about, 400) END,
         public_slug    = coalesce(public_slug, public.hub_make_slug(_row.name))
   WHERE id = _hub
   RETURNING * INTO _row;
  RETURN jsonb_build_object('enabled', _row.public_enabled, 'slug', _row.public_slug, 'about', _row.public_about, 'name', _row.name);
END $$;
REVOKE ALL ON FUNCTION public.set_hub_public_page(boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_hub_public_page(boolean, text) TO authenticated;

-- Менеджер: стан сторінки і заявки своєї школи.
CREATE OR REPLACE FUNCTION public.my_hub_public_page()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _hub uuid; _row public.hubs%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'manager'::app_role) THEN RETURN NULL; END IF;
  _hub := public.caller_hub_id();
  IF _hub IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _row FROM public.hubs WHERE id = _hub;
  RETURN jsonb_build_object(
    'enabled', _row.public_enabled, 'slug', _row.public_slug, 'about', _row.public_about, 'name', _row.name,
    'leads', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'contact', l.contact, 'subject', l.subject,
                                          'note', l.note, 'status', l.status, 'created_at', l.created_at)
                       ORDER BY l.created_at DESC)
        FROM (SELECT * FROM public.hub_leads WHERE hub_id = _hub ORDER BY created_at DESC LIMIT 100) l), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.my_hub_public_page() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_hub_public_page() TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_hub_lead(_id uuid, _done boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _hub uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'Only a school manager can do this' USING ERRCODE = 'insufficient_privilege';
  END IF;
  _hub := public.caller_hub_id();
  UPDATE public.hub_leads SET status = CASE WHEN _done THEN 'done' ELSE 'new' END
   WHERE id = _id AND hub_id = _hub;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.resolve_hub_lead(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_hub_lead(uuid, boolean) TO authenticated;

-- Будь-хто: що показати на сторінці школи. Лише назва, опис, предмети.
CREATE OR REPLACE FUNCTION public.hub_public_page(_slug text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'name', h.name,
    'about', h.public_about,
    'subjects', coalesce((
      SELECT jsonb_agg(s ORDER BY s) FROM (
        SELECT DISTINCT r.subject AS s
          FROM public.tutor_subject_rates r
          JOIN public.tutor_workspace_settings w ON w.tutor_id = r.tutor_id
         WHERE w.hub_id = h.id AND coalesce(trim(r.subject), '') <> ''
        UNION
        SELECT DISTINCT x AS s
          FROM public.tutor_details d
          JOIN public.tutor_workspace_settings w ON w.tutor_id = d.user_id
          CROSS JOIN LATERAL unnest(coalesce(d.subjects, '{}'::text[])) x
         WHERE w.hub_id = h.id AND coalesce(trim(x), '') <> ''
      ) q), '[]'::jsonb))
    FROM public.hubs h
   WHERE h.public_slug = lower(trim(_slug)) AND h.public_enabled;
$$;
REVOKE ALL ON FUNCTION public.hub_public_page(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_public_page(text) TO anon, authenticated;

-- Будь-хто: залишити заявку школі. Відповідь словом: ok · limit · invalid · closed
CREATE OR REPLACE FUNCTION public.hub_public_lead(_slug text, _name text, _contact text, _subject text DEFAULT NULL, _note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _hub uuid; _hub_name text; _id uuid;
  _n text := public.lead_text_clean(_name, 60);
  _c text := nullif(left(trim(regexp_replace(coalesce(_contact, ''), '\s+', ' ', 'g')), 80), '');
  _s text := public.lead_text_clean(_subject, 60);
  _t text := public.lead_text_clean(_note, 300);
  _ip text;
BEGIN
  SELECT h.id, h.name INTO _hub, _hub_name FROM public.hubs h
   WHERE h.public_slug = lower(trim(_slug)) AND h.public_enabled;
  IF _hub IS NULL THEN RETURN 'closed'; END IF;
  -- контакт — телефон або пошта, не довільний текст
  IF _n IS NULL OR _c IS NULL OR NOT (_c ~ '^\+?[0-9 ()\-]{7,20}$' OR _c ~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$') THEN
    RETURN 'invalid';
  END IF;

  BEGIN
    _ip := split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1);
  EXCEPTION WHEN OTHERS THEN _ip := '';
  END;
  IF public.rate_limit_check('hub_lead_ip', coalesce(nullif(trim(_ip), ''), 'unknown'), 5, 3600)
     OR public.rate_limit_check('hub_lead_hub', _hub::text, 40, 3600) THEN
    RETURN 'limit';
  END IF;

  INSERT INTO public.hub_leads (hub_id, name, contact, subject, note)
  VALUES (_hub, _n, _c, _s, _t) RETURNING id INTO _id;

  BEGIN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT hm.user_id, 'hub_lead_' || _id::text,
           format('Нова заявка до школи: %s', _n),
           concat_ws(' · ', _s, _c),
           '/profile?school=1'
      FROM public.hub_managers hm WHERE hm.hub_id = _hub;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'hub_public_lead: сповіщення не створено: %', SQLERRM;   -- заявка важливіша за дзвіночок
  END;
  RETURN 'ok';
END $$;
REVOKE ALL ON FUNCTION public.hub_public_lead(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_public_lead(text, text, text, text, text) TO anon, authenticated;
