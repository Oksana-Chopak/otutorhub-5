-- ============================================================================
-- №15+№21 (ідеї 01.09): вечірній підсумок дня.
--
-- «Сьогодні: 3 уроки, 1 200 грн, 2 конспекти чекають» — одна приємна причина
-- на день згадати про застосунок. Ранковий дайджест був opt-in і вимкнений за
-- замовчуванням, тож більшість користувачів не отримувала від продукту
-- ЖОДНОГО повідомлення. Вечірній — увімкнений за замовчуванням, з чесним
-- перемикачем у профілі; шле сповіщення в дзвіночок (тригер БД сам робить
-- web-push тим, хто дозволив) + Telegram, якщо привʼязаний.
--
-- ПОБІЧНА ЗНАХІДКА, виправлена тут же: колонку dismissed_tasks (20260828)
-- додали в таблицю, але НЕ додали в явний список колонок
-- update_my_workspace_settings — «прибрати плитку» на дашборді писалось у
-- нікуди і плитка поверталась після перезавантаження. Додано в список.
-- ============================================================================

-- 1. Перемикач (безпечна колонка, редагована тьютором через RPC)
ALTER TABLE public.tutor_workspace_settings
  ADD COLUMN IF NOT EXISTS evening_summary_enabled boolean NOT NULL DEFAULT true;

-- 2. update_my_workspace_settings: + evening_summary_enabled, + dismissed_tasks
--    (7 привілейованих колонок далі зрізаються, як і раніше — НЕ чіпати).
CREATE OR REPLACE FUNCTION public.update_my_workspace_settings(_patch jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _safe jsonb;
  _merged public.tutor_workspace_settings;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Auth required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.tutor_workspace_settings (tutor_id)
  VALUES (_uid)
  ON CONFLICT (tutor_id) DO NOTHING;

  _safe := _patch
    - 'subscription_status' - 'subscription_until' - 'current_plan'
    - 'independent_workspace' - 'liqpay_recurring_active' - 'liqpay_card_token'
    - 'trial_until' - 'tutor_id' - 'created_at' - 'updated_at';

  SELECT (jsonb_populate_record(t, _safe)).*
  INTO _merged
  FROM public.tutor_workspace_settings t
  WHERE t.tutor_id = _uid;

  UPDATE public.tutor_workspace_settings AS t SET
    ai_notes_auto              = _merged.ai_notes_auto,
    ai_notes_auto_send         = _merged.ai_notes_auto_send,
    auto_complete_lessons      = _merged.auto_complete_lessons,
    auto_complete_prompted     = _merged.auto_complete_prompted,
    cancel_fee_percent         = _merged.cancel_fee_percent,
    cancel_free_hours          = _merged.cancel_free_hours,
    custom_currencies          = _merged.custom_currencies,
    daily_digest_enabled       = _merged.daily_digest_enabled,
    dismissed_tasks            = _merged.dismissed_tasks,
    evening_summary_enabled    = _merged.evening_summary_enabled,
    free_reschedules_per_month = _merged.free_reschedules_per_month,
    marketing_opt_in           = _merged.marketing_opt_in,
    noshow_charge              = _merged.noshow_charge,
    notify_email               = _merged.notify_email,
    notify_telegram            = _merged.notify_telegram,
    onboarding_completed       = _merged.onboarding_completed,
    onboarding_step            = _merged.onboarding_step,
    payment_due_days           = _merged.payment_due_days,
    payment_due_mode           = _merged.payment_due_mode,
    payment_reminder_enabled   = _merged.payment_reminder_enabled,
    payment_rules_configured   = _merged.payment_rules_configured,
    reward_theme               = _merged.reward_theme,
    updated_at                 = now()
  WHERE t.tutor_id = _uid;
END;
$$;

-- 3. CRON: щодня о 18:00 UTC (21:00 EEST / 20:00 EET)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname = 'tutor-evening-summary';

SELECT cron.schedule(
  'tutor-evening-summary',
  '0 18 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/tutor-evening-summary',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || public.get_cron_shared_secret()
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);
