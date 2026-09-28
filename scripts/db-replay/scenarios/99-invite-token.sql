-- Сценарій: ключ у листі-запрошенні (27.09).
-- (1) видача ключа запрошеному профілю; перевидача гасить попередній;
-- (2) ключ приймається лише зі своєю поштою (регістр байдуже) і лише раз;
-- (3) прострочений ключ не приймається;
-- (4) після реєстрації (профіль уже не запрошений) ключ не приймається;
-- (5) з браузера ключі не видати й не погасити.
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  ghost uuid := gen_random_uuid();
  ghost2 uuid := gen_random_uuid();
  real_user uuid := gen_random_uuid();
  t1 text; t2 text; t3 text;
BEGIN
  INSERT INTO public.profiles (id, first_name, last_name, is_pending) VALUES
    (ghost, 'Оля', 'Запрошена', true), (ghost2, 'Іван', 'Запрошений', true);
  INSERT INTO public.profile_contacts (user_id, email) VALUES (ghost, 'olya99@test.local'), (ghost2, 'ivan99@test.local')
    ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email;

  -- (1)
  t1 := public.issue_invite_token(ghost, 'Olya99@Test.local');
  t2 := public.issue_invite_token(ghost, 'olya99@test.local');
  IF t1 = t2 THEN RAISE EXCEPTION '(1) перевидача дала той самий ключ'; END IF;
  IF public.consume_invite_token(t1, 'olya99@test.local') THEN
    RAISE EXCEPTION '(1) старий ключ живий після перевидачі';
  END IF;
  RAISE NOTICE '✅ (1) ключ видано; перевидача гасить попередній';

  -- (2)
  IF public.consume_invite_token(t2, 'ivan99@test.local') THEN
    RAISE EXCEPTION '(2) ключ Олі прийнято з поштою Івана';
  END IF;
  IF NOT public.consume_invite_token(t2, '  OLYA99@test.local ') THEN
    RAISE EXCEPTION '(2) живий ключ зі своєю поштою (інший регістр, пробіли) не прийнято';
  END IF;
  IF public.consume_invite_token(t2, 'olya99@test.local') THEN
    RAISE EXCEPTION '(2) ключ спрацював двічі';
  END IF;
  RAISE NOTICE '✅ (2) ключ — лише зі своєю поштою і лише раз';

  -- (3)
  t3 := public.issue_invite_token(ghost2, 'ivan99@test.local');
  UPDATE public.pending_invite_tokens SET expires_at = now() - interval '1 minute' WHERE profile_id = ghost2;
  IF public.consume_invite_token(t3, 'ivan99@test.local') THEN
    RAISE EXCEPTION '(3) прострочений ключ прийнято';
  END IF;
  RAISE NOTICE '✅ (3) прострочений ключ не приймається';

  -- (4)
  t3 := public.issue_invite_token(ghost2, 'ivan99@test.local');
  UPDATE public.profiles SET is_pending = false WHERE id = ghost2;
  IF public.consume_invite_token(t3, 'ivan99@test.local') THEN
    RAISE EXCEPTION '(4) ключ прийнято для профілю, який уже не запрошений';
  END IF;
  RAISE NOTICE '✅ (4) для вже зареєстрованого профілю ключ мертвий';

  -- (5)
  IF has_function_privilege('authenticated', 'public.issue_invite_token(uuid, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.consume_invite_token(text, text)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.pending_invite_tokens', 'SELECT')
     OR has_table_privilege('authenticated', 'public.pending_invite_tokens', 'SELECT') THEN
    RAISE EXCEPTION '(5) ключі запрошень доступні з браузера';
  END IF;
  RAISE NOTICE '✅ (5) ключі — лише для service_role';
END $$;

ROLLBACK;
