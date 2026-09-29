-- ═══════════════════════════════════════════════════════════════════════════
-- Права виконання, від яких залежать edge-функції й реєстрація — перевидано
-- явно (29.09).
--
-- Що сталось: після вставки lovable-paste-27-09.sql Lovable сам «додав 5
-- перевірок безпеки» — у репо потрапив лише один рядок (REVOKE на тригерну
-- функцію), а на проді того ж дня зламались дві речі, які код не чіпав тижнями:
--   • confirm-pending-signup: «permission denied» на службовому виклику
--     (єдиний його виклик у базу — is_pending_email);
--   • telegram-poll: збій на КОЖНОМУ запуску (першим кроком читає
--     get_cron_shared_secret — без нього кожен запуск відкидається).
-- Обидва — SECURITY DEFINER-функції, які автоматична «перевірка безпеки»
-- бачить як ризик і забирає EXECUTE. Так уже було 26.09 (is_pending_email без
-- права для anon → запрошені не реєструвались).
--
-- Що тепер: права на КОЖНУ функцію, яку кличуть edge-функції (список =
-- scripts/db-replay/check-edge-rpc-grants.mjs) і клієнт, перевидано явно, і
-- вбудована перевірка падає, якщо хоч одне право зникло. Файл ідемпотентний —
-- його можна вставляти щоразу після будь-якого «Lovable пропонує виправити
-- security findings». Секрет крону лишається ЛИШЕ для service_role.
-- Бізнес: одна автоматична «перевірка безпеки» = Telegram мовчить, запрошені
-- не реєструються, і ніхто не знає чому.
-- Ідемпотентна. LIVE-MARKER-NONE: лише GRANT. Вручну (SQL Editor):
--   SELECT has_function_privilege('service_role','public.get_cron_shared_secret()','EXECUTE'),
--          has_function_privilege('anon','public.is_pending_email(text)','EXECUTE');  → t | t
-- ═══════════════════════════════════════════════════════════════════════════

-- Службові виклики з edge-функцій (service_role) — усі 15 RPC, які вони кличуть.
GRANT EXECUTE ON FUNCTION public.get_cron_shared_secret() TO service_role;
GRANT EXECUTE ON FUNCTION public.is_pending_email(text) TO service_role, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_manager_of_tutor(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_manager_of_user(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_user_role(uuid, app_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_email(text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_user_data(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.manager_purge_user(uuid) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_pro_days(uuid, integer, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_referral_pro_upgrade(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_marketing_recipients(text) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_telegram_link_code(uuid) TO service_role, authenticated;
-- Нові службові функції 27.09 (їх кличуть лише edge-функції)
GRANT EXECUTE ON FUNCTION public.rate_limit_check(text, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.user_id_by_email(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_call_gate(uuid, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_call_log(uuid, uuid, text, text, text, integer, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.job_run_record(text, boolean, integer, integer, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.job_health(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_invite_token(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_invite_token(text, text) TO service_role;
-- Секрет крону — нікому, крім service_role (перевірка безпеки тут має рацію).
REVOKE EXECUTE ON FUNCTION public.get_cron_shared_secret() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  _missing text := '';
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('service_role', 'public.get_cron_shared_secret()'),
      ('service_role', 'public.is_pending_email(text)'),
      ('anon',         'public.is_pending_email(text)'),
      ('service_role', 'public.is_manager_of_tutor(uuid, uuid)'),
      ('service_role', 'public.is_manager_of_user(uuid, uuid)'),
      ('service_role', 'public.check_user_role(uuid, app_role)'),
      ('service_role', 'public.enqueue_email(text, jsonb)'),
      ('service_role', 'public.delete_email(text, bigint)'),
      ('service_role', 'public.read_email_batch(text, integer, integer)'),
      ('service_role', 'public.move_to_dlq(text, text, bigint, jsonb)'),
      ('service_role', 'public.purge_user_data(uuid)'),
      ('service_role', 'public.manager_purge_user(uuid)'),
      ('service_role', 'public.grant_pro_days(uuid, integer, text, jsonb)'),
      ('service_role', 'public.mark_referral_pro_upgrade(uuid)'),
      ('service_role', 'public.get_marketing_recipients(text)'),
      ('service_role', 'public.generate_telegram_link_code(uuid)'),
      ('service_role', 'public.rate_limit_check(text, text, integer, integer)'),
      ('service_role', 'public.user_id_by_email(text)'),
      ('service_role', 'public.ai_call_gate(uuid, text, text, integer)'),
      ('service_role', 'public.job_run_record(text, boolean, integer, integer, jsonb, text)'),
      ('service_role', 'public.job_health(integer)'),
      ('service_role', 'public.issue_invite_token(uuid, text)'),
      ('service_role', 'public.consume_invite_token(text, text)')
    ) AS t(who, fn)
  LOOP
    IF NOT has_function_privilege(r.who, r.fn, 'EXECUTE') THEN
      _missing := _missing || r.who || ' → ' || r.fn || '; ';
    END IF;
  END LOOP;
  IF _missing <> '' THEN
    RAISE EXCEPTION 'бракує прав: %', _missing;
  END IF;
  IF has_function_privilege('anon', 'public.get_cron_shared_secret()', 'EXECUTE') THEN
    RAISE EXCEPTION 'секрет крону читається анонімно';
  END IF;
  RAISE NOTICE 'права edge-функцій і реєстрації перевидано: 23 перевірки пройдено, секрет крону лише service_role ✔';
END $$;
