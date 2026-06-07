-- Створює тригер який після INSERT в chat_messages викликає edge-функцію
-- notify-chat-message, яка надсилає Telegram-сповіщення отримувачу.
--
-- Передумови (виконати в Supabase Dashboard → Settings → Edge Functions → Secrets):
--   TELEGRAM_BOT_TOKEN       — токен бота @oTutorHubBot
--   SUPABASE_SERVICE_ROLE_KEY — вже є автоматично
--
-- Якщо функція вже є в БД але була створена вручну — цей скрипт перезапише її.

CREATE OR REPLACE FUNCTION public.notify_chat_message_via_telegram()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Викликаємо edge-функцію асинхронно (pg_net) — не блокуємо INSERT
  PERFORM net.http_post(
    url     := 'https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/notify-chat-message',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true)
    ),
    body    := jsonb_build_object('message_id', NEW.id::text)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Ніколи не блокуємо вставку повідомлення через помилку нотифікації
  RAISE WARNING 'notify_chat_message_via_telegram failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- Trigger: AFTER INSERT — по одному рядку
DROP TRIGGER IF EXISTS trg_notify_chat_telegram ON public.chat_messages;
CREATE TRIGGER trg_notify_chat_telegram
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_chat_message_via_telegram();

-- Revoke direct calls (тільки тригер має викликати)
REVOKE EXECUTE ON FUNCTION public.notify_chat_message_via_telegram() FROM anon, authenticated, public;

-- ── Schedule telegram-poll via pg_cron (runs every minute to process /start) ──
-- Цей cron запускає бота і обробляє /start команди від нових юзерів.
-- Без нього "Підключити Telegram" не працює (бот не бачить повідомлень).
SELECT cron.schedule(
  'telegram-poll-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/telegram-poll',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true)
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
) ON CONFLICT (jobname) DO UPDATE SET schedule = '* * * * *';
