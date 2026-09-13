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