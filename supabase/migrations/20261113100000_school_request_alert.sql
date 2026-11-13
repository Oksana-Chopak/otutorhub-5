/* ============================================================================
   Заявка «Керуєте школою?» приходить власниці платформи як заявка, а не як «відгук»
   (13.11, живий прохід сповіщень).

   Заявка лягає в скриньку звернень (`feedback_submissions`, category='school_request'),
   і тригер відгуків підписував її «💬 Відгук від …», двічі повторював ту саму пошту й
   дописував «/profile». Тепер: «🏫 Заявка на школу від …», контакт один раз, і дотик
   веде в адмінку «Школи», де школу й підключають.

   Ідемпотентно. -- LIVE-MARKER-NONE: перевипуск тіла наявної функції (types.ts його не бачить)
   ============================================================================ */

CREATE OR REPLACE FUNCTION public.notify_on_feedback()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _kind  text;
  _name  text;
  _title text;
  _body  text;
  _type  text := 'feedback_new_' || NEW.id::text;
  _rcpt  uuid;
BEGIN
  BEGIN
    IF NOT public.owner_alert_allowed(NEW.user_id) THEN
      RETURN NEW;
    END IF;
    _kind := CASE NEW.category
      WHEN 'bug'      THEN '🐞 Баг'
      WHEN 'idea'     THEN '💡 Ідея'
      WHEN 'question' THEN '❓ Питання'
      WHEN 'landing'  THEN '✉️ Звернення з лендінгу'
      WHEN 'school_request' THEN '🏫 Заявка на школу'
      ELSE '💬 Відгук' END;
    _name := CASE WHEN NEW.user_id IS NULL THEN NULL
                  ELSE coalesce(public.owner_alert_person(NEW.user_id), 'користувач') END;
    _title := concat(_kind,
                     CASE WHEN _name IS NOT NULL THEN ' від ' || _name ELSE '' END,
                     CASE WHEN NEW.rating IS NOT NULL THEN format(' · %s★', NEW.rating) ELSE '' END);
    _body := concat_ws(' · ',
      NULLIF(left(regexp_replace(coalesce(NEW.message, ''), '\s+', ' ', 'g'), 200), ''),
      NULLIF(trim(coalesce(NEW.contact, '')), ''),
      -- той самий контакт двічі не пишемо (заявка на школу кладе пошту акаунта в contact)
      CASE WHEN position(lower(trim(coalesce(NEW.contact, ''))) in lower(coalesce(public.owner_alert_contact(NEW.user_id), ''))) > 0
                AND trim(coalesce(NEW.contact, '')) <> ''
           THEN NULL ELSE NULLIF(public.owner_alert_contact(NEW.user_id), '') END,
      CASE WHEN NEW.category = 'school_request' THEN NULL ELSE NULLIF(trim(coalesce(NEW.page_url, '')), '') END);
    FOR _rcpt IN SELECT pa.user_id FROM public.platform_admins pa WHERE pa.user_id IS DISTINCT FROM NEW.user_id LOOP
      PERFORM public.owner_alert(_rcpt, _type, _title, _body, CASE WHEN NEW.category = 'school_request' THEN '/admin' ELSE '/feedback-inbox' END);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_on_feedback failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_on_feedback() FROM PUBLIC, anon, authenticated;
