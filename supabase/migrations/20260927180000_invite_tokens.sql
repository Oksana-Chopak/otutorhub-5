-- ═══════════════════════════════════════════════════════════════════════════
-- Ключ у листі-запрошенні (27.09, «Публічні двері», частина 2).
--
-- Що було: `confirm-pending-signup` (публічна, без JWT) підтверджувала пошту
-- будь-кого, хто (а) знає пошту запрошеного учня і (б) зареєструвався з нею
-- першим — без жодного доказу, що людина має доступ до цієї скриньки. Разом зі
-- злиттям запрошеного профілю це віддавало стороннім місце учня в репетитора
-- (уроки, домашки, чат) — досить знати адресу, яку розсилали батьки чи клас.
--
-- Що тепер: у листі-запрошенні є одноразовий ключ (`&invite=…`). Лист прийшов у
-- скриньку → ключ є лише в того, хто її відкрив. Підтвердити пошту без листа
-- (fast path) можна ЛИШЕ з ключем; без нього — звичайний лист підтвердження
-- від Supabase, як у всіх. Запрошення, розіслані до цієї міграції, без ключа —
-- ті учні реєструються через звичайний лист, нічого не втрачають.
--   • `pending_invite_tokens` — один живий ключ на запрошений профіль, 30 днів;
--   • `issue_invite_token(profile, email)` — видає (перевидає) ключ, service_role;
--   • `consume_invite_token(token, email)` — true лише якщо ключ живий, пошта та
--     сама, профіль досі запрошений; ключ гаситься назавжди.
-- Бізнес: продукт для дітей і їхніх батьків; «хтось чужий зайшов у чат з моїм
-- репетитором під іменем моєї дитини» — не той відгук, після якого лишаються.
-- Ідемпотентна. LIVE-MARKER: `consume_invite_token` у types.ts.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.pending_invite_tokens (
  profile_id uuid PRIMARY KEY,
  token      text NOT NULL UNIQUE,
  email      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  used_at    timestamptz
);
COMMENT ON TABLE public.pending_invite_tokens IS
  'Одноразові ключі з листа-запрошення: доказ доступу до скриньки для fast path підтвердження. Лише service_role.';
ALTER TABLE public.pending_invite_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pending_invite_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pending_invite_tokens TO service_role;

CREATE OR REPLACE FUNCTION public.issue_invite_token(_profile uuid, _email text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t text;
BEGIN
  IF _profile IS NULL OR coalesce(trim(_email), '') = '' THEN
    RAISE EXCEPTION 'INVITE_TOKEN_BAD_ARGS' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _profile AND is_pending = true) THEN
    RAISE EXCEPTION 'INVITE_TOKEN_NOT_PENDING' USING ERRCODE = 'check_violation';
  END IF;
  _t := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.pending_invite_tokens (profile_id, token, email)
  VALUES (_profile, _t, lower(trim(_email)))
  ON CONFLICT (profile_id) DO UPDATE
    SET token = EXCLUDED.token, email = EXCLUDED.email,
        created_at = now(), expires_at = now() + interval '30 days', used_at = NULL;
  RETURN _t;
END $$;
REVOKE EXECUTE ON FUNCTION public.issue_invite_token(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_invite_token(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.consume_invite_token(_token text, _email text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer;
BEGIN
  IF coalesce(_token, '') = '' OR coalesce(trim(_email), '') = '' THEN
    RETURN false;
  END IF;
  UPDATE public.pending_invite_tokens t
     SET used_at = now()
   WHERE t.token = _token
     AND t.email = lower(trim(_email))
     AND t.used_at IS NULL
     AND t.expires_at > now()
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = t.profile_id AND p.is_pending = true);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n = 1;
END $$;
REVOKE EXECUTE ON FUNCTION public.consume_invite_token(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_invite_token(text, text) TO service_role;

DO $$
DECLARE
  _p uuid := gen_random_uuid();
  _t text;
BEGIN
  IF has_function_privilege('anon', 'public.consume_invite_token(text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_invite_token(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ключі запрошень доступні з браузера — так не має бути';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.consume_invite_token(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role не може гасити ключ — fast path підтвердження лишиться зачиненим для всіх';
  END IF;
  INSERT INTO public.profiles (id, first_name, last_name, is_pending) VALUES (_p, 'Self', 'Check', true);
  _t := public.issue_invite_token(_p, 'Self.Check@Test.local');
  IF length(_t) < 60 THEN RAISE EXCEPTION 'ключ закороткий: %', _t; END IF;
  IF public.consume_invite_token(_t, 'other@test.local') THEN RAISE EXCEPTION 'ключ прийнято з чужою поштою'; END IF;
  IF NOT public.consume_invite_token(_t, 'self.check@test.local') THEN RAISE EXCEPTION 'живий ключ зі своєю поштою не прийнято'; END IF;
  IF public.consume_invite_token(_t, 'self.check@test.local') THEN RAISE EXCEPTION 'ключ спрацював двічі'; END IF;
  DELETE FROM public.pending_invite_tokens WHERE profile_id = _p;
  DELETE FROM public.profiles WHERE id = _p;
  RAISE NOTICE 'ключ у листі-запрошенні: видається, приймається лише зі своєю поштою і лише раз ✔';
END $$;
