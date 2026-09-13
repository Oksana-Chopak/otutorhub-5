-- ═══════════════════════════════════════════════════════════════════════════
-- Edge-функції під service role мусять мати EXECUTE на своїх RPC (13.09)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Симптом у логах: confirm-pending-signup → `permission denied for function
-- is_pending_email` → «not pending» → запрошений учень застрягає на
-- підтвердженні і ніколи не прив'язується до акаунта.
--
-- Причина: 20260501123039 (Lovable, «security hardening») зробив
-- `REVOKE EXECUTE ... FROM anon, authenticated, public` на низці функцій.
-- Для функцій, створених без явного гранту service_role (а Supabase дає його
-- лише через default privileges, які не завжди спрацьовують для функцій,
-- створених іншим власником), це прибрало право І в service_role — тобто в
-- самих edge-функцій, заради яких ці RPC існують.
--
-- Тут — ЯВНИЙ GRANT service_role на кожну RPC, яку викликають edge-функції
-- під service role. Права anon/authenticated НЕ чіпаємо (grant_pro_days так
-- само лишається недоступним авторизованим — інваріант CLAUDE.md).
-- Ідемпотентно; відсутню функцію пропускаємо з NOTICE, а не падаємо.
--
-- LIVE-MARKER-NONE: SELECT has_function_privilege('service_role', 'public.is_pending_email(text)', 'EXECUTE') → true
DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'public.is_pending_email(text)',
    'public.is_pending_profile(uuid)',
    'public.check_user_role(uuid, public.app_role)',
    'public.enqueue_email(text, jsonb)',
    'public.read_email_batch(text, integer, integer)',
    'public.delete_email(text, bigint)',
    'public.move_to_dlq(text, text, bigint, jsonb)',
    'public.grant_pro_days(uuid, integer, text, jsonb)',
    'public.mark_referral_pro_upgrade(uuid)',
    'public.purge_user_data(uuid)',
    'public.manager_purge_user(uuid)',
    'public.get_marketing_recipients(text)',
    'public.get_cron_shared_secret()',
    'public.generate_telegram_link_code(uuid)',
    'public.is_manager_of_tutor(uuid, uuid)',
    'public.is_manager_of_user(uuid, uuid)'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    BEGIN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    EXCEPTION WHEN undefined_function OR undefined_object THEN
      RAISE NOTICE 'service_role grant: функції % немає — пропускаю', fn;
    END;
  END LOOP;
END $$;
