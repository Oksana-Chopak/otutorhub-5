-- ═══════════════════════════════════════════════════════════════════════════
-- Видалення акаунта було зламане для ВСІХ (14.09)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Симптом (скарга живого користувача): людина зареєструвалась як учень
-- помилково, захотіла видалити акаунт — і отримала «Сервіс видалення
-- тимчасово недоступний. Напишіть нам».
--
-- Причина: у `purge_user_data` один рядок із 53 звертався до
-- `marketing_unsubscribe_tokens.user_id` — колонки, якої в цій таблиці немає
-- (вона ключується `email`). PL/pgSQL падає на ньому, транзакція
-- відкочується ЦІЛКОМ, edge `delete-account` повертає 500, а клієнт показує
-- «напишіть нам». Тобто видалити акаунт не міг жоден користувач — ні учень,
-- ні репетитор. Для сторів це пряма вимога (App Store 5.1.1(v), Google Play).
--
-- Перевірено на локальній копії схеми: з 53 інструкцій функції зламана рівно
-- одна; після правки повне видалення проходить, і пошта звільняється —
-- людина може зареєструватись нею ж у потрібній ролі.
--
-- LIVE-MARKER-NONE: SELECT public.purge_user_data('<uuid тестового акаунта>') → без помилки

CREATE OR REPLACE FUNCTION public.purge_user_data(_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'user_id required'; END IF;
  IF auth.uid() IS NOT NULL
     AND auth.uid() <> _user_id
     AND NOT (public.has_role(auth.uid(), 'manager'::app_role) AND public.is_hub_member(_user_id)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  PERFORM set_config('app.pending_profile_merge', 'on', true);
  DELETE FROM public.lesson_feedback
   WHERE tutor_id = _user_id OR student_id = _user_id
      OR lesson_id IN (SELECT id FROM public.lessons WHERE tutor_id = _user_id OR student_id = _user_id);
  DELETE FROM public.lesson_reminders
   WHERE tutor_id = _user_id OR student_id = _user_id
      OR lesson_id IN (SELECT id FROM public.lessons WHERE tutor_id = _user_id OR student_id = _user_id);
  DELETE FROM public.student_rewards WHERE student_id = _user_id OR tutor_id = _user_id;
  DELETE FROM public.lesson_attachments
   WHERE uploader_id = _user_id
      OR lesson_id IN (SELECT id FROM public.lessons WHERE tutor_id = _user_id OR student_id = _user_id);
  DELETE FROM public.lesson_participants WHERE student_id = _user_id;
  DELETE FROM public.lesson_payment_reminders WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.lesson_change_requests   WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.lessons WHERE tutor_id = _user_id OR student_id = _user_id OR created_by = _user_id;
  DELETE FROM public.group_enrollments WHERE student_id = _user_id;
  DELETE FROM public.group_enrollments WHERE group_id IN (SELECT id FROM public.lesson_groups WHERE tutor_id = _user_id);
  DELETE FROM public.lesson_groups WHERE tutor_id = _user_id;
  DELETE FROM public.chat_message_reactions WHERE user_id = _user_id;
  DELETE FROM public.chat_message_attachments
   WHERE uploader_id = _user_id
      OR thread_id IN (SELECT id FROM public.chat_threads WHERE tutor_id = _user_id OR student_id = _user_id);
  DELETE FROM public.chat_messages
   WHERE sender_id = _user_id
      OR thread_id IN (SELECT id FROM public.chat_threads WHERE tutor_id = _user_id OR student_id = _user_id);
  DELETE FROM public.chat_reads
   WHERE user_id = _user_id
      OR thread_id IN (SELECT id FROM public.chat_threads WHERE tutor_id = _user_id OR student_id = _user_id);
  DELETE FROM public.chat_threads WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.student_rates       WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.tutor_subject_rates WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_availability_weekly    WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_availability_overrides WHERE tutor_id = _user_id;
  DELETE FROM public.availability_requests WHERE tutor_id = _user_id OR requester_id = _user_id;
  DELETE FROM public.tutor_referral_requests WHERE student_id = _user_id;
  DELETE FROM public.tutor_student_defaults  WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.tutor_student_pairs     WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.student_intake_quiz     WHERE student_id = _user_id;
  DELETE FROM public.student_wallet_transactions WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.subscription_requests   WHERE tutor_id = _user_id;
  DELETE FROM public.liqpay_payments         WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_workspace_settings WHERE tutor_id = _user_id;
  DELETE FROM public.manager_notes WHERE subject_user_id = _user_id OR author_id = _user_id;
  DELETE FROM public.paywall_events WHERE user_id = _user_id;
  DELETE FROM public.user_telegram_links WHERE user_id = _user_id;
  DELETE FROM public.notifications WHERE user_id = _user_id;
  DELETE FROM public.referrals WHERE referrer_id = _user_id OR referred_id = _user_id;
  DELETE FROM public.referral_codes WHERE tutor_id = _user_id;
  DELETE FROM public.pro_bonus_ledger WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_streaks WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_badges WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_notes WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_daily_digests WHERE tutor_id = _user_id;
  DELETE FROM public.google_calendar_tokens WHERE user_id = _user_id;
  DELETE FROM public.feedback_submissions WHERE user_id = _user_id;
  -- 14.09: тут стояло `WHERE user_id = _user_id`, а в цій таблиці колонки
  -- user_id НЕМАЄ — вона ключується поштою. PL/pgSQL валиться на цьому рядку,
  -- і ВСЯ функція відкочується: жодне з 53 видалень не застосовується.
  -- Наслідок: edge `delete-account` отримував 500, а людина бачила
  -- «сервіс недоступний, напишіть нам». Видалити акаунт не міг НІХТО.
  DELETE FROM public.marketing_unsubscribe_tokens
  WHERE email IN (
    SELECT lower(btrim(c.email)) FROM public.profile_contacts c
    WHERE c.user_id = _user_id AND c.email IS NOT NULL
    UNION
    SELECT lower(btrim(u.email)) FROM auth.users u
    WHERE u.id = _user_id AND u.email IS NOT NULL
  );
  DELETE FROM public.platform_admins WHERE user_id = _user_id;
  DELETE FROM public.hub_members WHERE user_id = _user_id;
  DELETE FROM public.hub_managers WHERE user_id = _user_id;
  BEGIN
    DELETE FROM storage.objects WHERE bucket_id = 'avatars' AND name LIKE _user_id::text || '/%';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  DELETE FROM public.tutor_details   WHERE user_id = _user_id;
  DELETE FROM public.student_details WHERE user_id = _user_id;
  DELETE FROM public.profile_financial_contacts WHERE user_id = _user_id;
  DELETE FROM public.profile_contacts WHERE user_id = _user_id;
  DELETE FROM public.user_roles WHERE user_id = _user_id;
  DELETE FROM public.profiles WHERE id = _user_id;
  PERFORM set_config('app.pending_profile_merge', '', true);
END;
$function$

;
