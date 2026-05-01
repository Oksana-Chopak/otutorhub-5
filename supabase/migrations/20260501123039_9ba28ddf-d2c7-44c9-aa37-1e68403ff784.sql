-- 1) Fix realtime policy: deny by default
DROP POLICY IF EXISTS "Subscription requests realtime scoped" ON realtime.messages;

CREATE POLICY "Subscription requests realtime scoped"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  (realtime.topic() LIKE 'subscription-requests:%')
  AND (
    public.has_role(auth.uid(), 'manager'::public.app_role)
    OR (auth.uid())::text = split_part(realtime.topic(), ':', 2)
  )
);

-- 2) Revoke EXECUTE on internal SECURITY DEFINER functions from anon/authenticated
DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'public.handle_new_user()',
    'public.merge_pending_profile(uuid, text, text)',
    'public.manager_purge_user(uuid)',
    'public.notify_chat_message_via_telegram()',
    'public.update_tutor_streak()',
    'public.set_subscription_request_handled()',
    'public.touch_chat_thread()',
    'public.touch_lesson_change_request()',
    'public.set_payment_dates()',
    'public.autofill_lesson_prices()',
    'public.protect_lesson_financials()',
    'public.protect_lesson_fields()',
    'public.guard_user_roles_writes()',
    'public.guard_tutor_workspace_settings_update()',
    'public.log_profile_deletions()',
    'public.log_user_role_changes()',
    'public.log_lesson_financial_changes()',
    'public.move_to_dlq(text, text, bigint, jsonb)',
    'public.enqueue_email(text, jsonb)',
    'public.read_email_batch(text, integer, integer)',
    'public.delete_email(text, bigint)',
    'public.grant_pro_days(uuid, integer, text, jsonb)',
    'public.mark_referral_pro_upgrade(uuid)',
    'public.is_pending_email(text)',
    'public.is_pending_profile(uuid)',
    'public.check_user_role(uuid, public.app_role)'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated, public', fn);
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'Skipping missing function %', fn;
    END;
  END LOOP;
END $$;