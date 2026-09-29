-- Сценарій: права, від яких залежать edge-функції й реєстрація (29.09).
-- Автоматична «перевірка безпеки» Lovable забирає EXECUTE у SECURITY DEFINER-функцій
-- (26.09 — is_pending_email/anon; 29.09 — телеграм і підтвердження реєстрації).
-- Тут — репо-правда про права: якщо хтось у майбутній міграції їх забере,
-- прогін стане червоним ДО того, як це побачить клієнт.
BEGIN;
SET LOCAL client_min_messages = notice;
DO $$
DECLARE r record; bad text := '';
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('service_role', 'public.get_cron_shared_secret()'),
      ('service_role', 'public.is_pending_email(text)'),
      ('anon',         'public.is_pending_email(text)'),
      ('authenticated','public.is_pending_email(text)'),
      ('service_role', 'public.check_user_role(uuid, app_role)'),
      ('service_role', 'public.enqueue_email(text, jsonb)'),
      ('service_role', 'public.read_email_batch(text, integer, integer)'),
      ('service_role', 'public.grant_pro_days(uuid, integer, text, jsonb)'),
      ('service_role', 'public.generate_telegram_link_code(uuid)'),
      ('service_role', 'public.consume_invite_token(text, text)'),
      ('service_role', 'public.job_run_record(text, boolean, integer, integer, jsonb, text)')
    ) AS t(who, fn)
  LOOP
    IF NOT has_function_privilege(r.who, r.fn, 'EXECUTE') THEN bad := bad || r.who || '→' || r.fn || ' '; END IF;
  END LOOP;
  IF bad <> '' THEN RAISE EXCEPTION 'бракує прав: %', bad; END IF;
  IF has_function_privilege('anon', 'public.get_cron_shared_secret()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.get_cron_shared_secret()', 'EXECUTE') THEN
    RAISE EXCEPTION 'секрет крону читається з браузера';
  END IF;
  RAISE NOTICE '✅ права edge-функцій і реєстрації на місці; секрет крону — лише service_role';
END $$;
ROLLBACK;
