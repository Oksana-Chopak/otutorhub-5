/* ============================================================================
   26.10 — ВЛАСНИЦІ В TELEGRAM: запит на репетитора · відгук · заявка на Pro
   (питання власниці: «чи можу я отримувати сповіщення в телеграм, коли хтось
   напише в чат підтримки або запит на репетиторів залишить?»)

   Було: запит на репетитора з застосунку → сповіщення менеджерам кликав КЛІЄНТ
   (`notify_managers`) з постійним type 'tutor_request', а `create_notification`
   дедуплікує за (user_id, type) на 24 год — тобто ДРУГИЙ запит за добу
   ковтався мовчки (ні дзвіночка, ні push). Запит з лендінгу й відгуки (з
   застосунку і з лендінгу) не повідомляли нікого — лежали до ранкового
   дайджесту чи відкриття «Вхідних». Підтримка (чат) уже йшла в Telegram.

   Тепер джерело правди — БАЗА: тригери на самих таблицях заявок створюють
   сповіщення (дзвіночок + push через наявний trg_send_push_on_notification),
   а `send-push` дублює ці типи в Telegram тим одержувачам, у кого він
   привʼязаний. Type несе id заявки (`tutor_request_<id>`), тож кожна заявка —
   окреме сповіщення, а повторні виклики (клієнтський fallback) дедуплікуються.

   Одержувачі: запит на репетитора → менеджери школи учня, інакше платформні
   адміни (та сама логіка, що в notify_managers); відгук і заявка на Pro →
   платформні адміни (автор-адмін себе не повідомляє).

   Запобіжник від шквалу: один автор — не більше 5 сповіщень на годину,
   уся платформа — не більше 60 на годину (`rate_limit_check`); понад стелю
   заявка лишається в «Запитах»/«Вхідних», а сповіщення не створюється.
   Тригери ніколи не ламають вставку заявки (EXCEPTION → WARNING).

   Ідемпотентно. -- LIVE-MARKER: owner_alert
   ============================================================================ */

-- ── Внутрішній помічник: одне сповіщення, без дублів за (user, type) ─────────
CREATE OR REPLACE FUNCTION public.owner_alert(_user uuid, _type text, _title text, _body text, _link text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _user IS NULL OR coalesce(_type, '') = '' OR coalesce(_title, '') = '' THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = _user AND n.type = _type) THEN
    RETURN false;
  END IF;
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_user, _type, left(_title, 200), NULLIF(left(coalesce(_body, ''), 600), ''), _link);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.owner_alert(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;

-- Хто отримує: менеджери школи людини, інакше платформні адміни.
CREATE OR REPLACE FUNCTION public.owner_alert_recipients(_about uuid)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH hub AS (
    SELECT hm.hub_id FROM public.hub_members hm WHERE _about IS NOT NULL AND hm.user_id = _about
    ORDER BY hm.created_at LIMIT 1
  )
  SELECT m.user_id FROM public.hub_managers m WHERE m.hub_id = (SELECT hub_id FROM hub)
  UNION
  SELECT pa.user_id FROM public.platform_admins pa WHERE NOT EXISTS (SELECT 1 FROM hub);
$$;
REVOKE ALL ON FUNCTION public.owner_alert_recipients(uuid) FROM PUBLIC, anon, authenticated;

-- Стеля на автора й на платформу (понад — тихо, заявка лишається у списках).
CREATE OR REPLACE FUNCTION public.owner_alert_allowed(_author uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _author IS NOT NULL AND public.rate_limit_check('owner_alert_author', _author::text, 5, 3600) THEN
    RETURN false;
  END IF;
  IF public.rate_limit_check('owner_alert_all', 'platform', 60, 3600) THEN
    RETURN false;
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.owner_alert_allowed(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.owner_alert_person(_user uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NULLIF(trim(concat(p.first_name, ' ', p.last_name)), '')
    FROM public.profiles p WHERE p.id = _user;
$$;
REVOKE ALL ON FUNCTION public.owner_alert_person(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.owner_alert_contact(_user uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT concat_ws(' · ', NULLIF(c.phone, ''), NULLIF(c.email, ''))
    FROM public.profile_contacts c WHERE c.user_id = _user;
$$;
REVOKE ALL ON FUNCTION public.owner_alert_contact(uuid) FROM PUBLIC, anon, authenticated;

-- ── 1. Запит на репетитора (застосунок, онбординг, анкета лендінгу) ──────────
CREATE OR REPLACE FUNCTION public.notify_on_tutor_request()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _name    text;
  _contact text;
  _title   text;
  _body    text;
  _type    text := 'tutor_request_' || NEW.id::text;
  _rcpt    uuid;
BEGIN
  BEGIN
    IF NOT public.owner_alert_allowed(NEW.student_id) THEN
      RETURN NEW;
    END IF;
    _name := coalesce(public.owner_alert_person(NEW.student_id), NULLIF(trim(coalesce(NEW.lead_name, '')), ''), 'Учень');
    _contact := concat_ws(' · ',
      NULLIF(trim(coalesce(NEW.lead_phone, '')), ''),
      NULLIF(trim(coalesce(NEW.lead_email, '')), ''),
      NULLIF(public.owner_alert_contact(NEW.student_id), ''));
    _title := format('🙋 %s шукає репетитора · %s', _name, coalesce(NULLIF(trim(coalesce(NEW.subject, '')), ''), '—'));
    _body := concat_ws(' · ',
      CASE WHEN NEW.source = 'landing_quiz' THEN 'з лендінгу' ELSE NULL END,
      NULLIF(trim(coalesce(NEW.preferred_level, '')), ''),
      NULLIF(trim(coalesce(NEW.preferred_times, '')), ''),
      NULLIF(left(regexp_replace(coalesce(NEW.message, ''), '\s+', ' ', 'g'), 160), ''),
      NULLIF(_contact, ''));
    FOR _rcpt IN SELECT * FROM public.owner_alert_recipients(NEW.student_id) LOOP
      PERFORM public.owner_alert(_rcpt, _type, _title, _body, '/referrals');
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_on_tutor_request failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_on_tutor_request() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_on_tutor_request ON public.tutor_referral_requests;
CREATE TRIGGER trg_notify_on_tutor_request
  AFTER INSERT ON public.tutor_referral_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_tutor_request();

-- ── 2. Заявка на Pro (лише незалежні репетитори → платформні адміни) ─────────
CREATE OR REPLACE FUNCTION public.notify_on_subscription_request()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _name  text;
  _title text;
  _body  text;
  _type  text := 'pro_request_' || NEW.id::text;
  _rcpt  uuid;
BEGIN
  BEGIN
    IF NOT public.owner_alert_allowed(NEW.tutor_id) THEN
      RETURN NEW;
    END IF;
    _name := coalesce(public.owner_alert_person(NEW.tutor_id), 'Репетитор');
    _title := format('👑 %s хоче підписку · %s', _name, coalesce(NULLIF(trim(coalesce(NEW.plan, '')), ''), 'Pro'));
    _body := concat_ws(' · ',
      CASE WHEN NEW.price IS NOT NULL THEN format('%s ₴', trim(to_char(NEW.price, 'FM999999990.##'))) END,
      NULLIF(left(regexp_replace(coalesce(NEW.message, ''), '\s+', ' ', 'g'), 160), ''),
      NULLIF(public.owner_alert_contact(NEW.tutor_id), ''));
    FOR _rcpt IN SELECT pa.user_id FROM public.platform_admins pa WHERE pa.user_id IS DISTINCT FROM NEW.tutor_id LOOP
      PERFORM public.owner_alert(_rcpt, _type, _title, _body, '/subscription-requests');
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_on_subscription_request failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_on_subscription_request() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_on_subscription_request ON public.subscription_requests;
CREATE TRIGGER trg_notify_on_subscription_request
  AFTER INSERT ON public.subscription_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_subscription_request();

-- ── 3. Відгук / звернення (застосунок і лендінг) → платформні адміни ─────────
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
      ELSE '💬 Відгук' END;
    _name := CASE WHEN NEW.user_id IS NULL THEN NULL
                  ELSE coalesce(public.owner_alert_person(NEW.user_id), 'користувач') END;
    _title := concat(_kind,
                     CASE WHEN _name IS NOT NULL THEN ' від ' || _name ELSE '' END,
                     CASE WHEN NEW.rating IS NOT NULL THEN format(' · %s★', NEW.rating) ELSE '' END);
    _body := concat_ws(' · ',
      NULLIF(left(regexp_replace(coalesce(NEW.message, ''), '\s+', ' ', 'g'), 200), ''),
      NULLIF(trim(coalesce(NEW.contact, '')), ''),
      NULLIF(public.owner_alert_contact(NEW.user_id), ''),
      NULLIF(trim(coalesce(NEW.page_url, '')), ''));
    FOR _rcpt IN SELECT pa.user_id FROM public.platform_admins pa WHERE pa.user_id IS DISTINCT FROM NEW.user_id LOOP
      PERFORM public.owner_alert(_rcpt, _type, _title, _body, '/feedback-inbox');
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_on_feedback failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_on_feedback() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_on_feedback ON public.feedback_submissions;
CREATE TRIGGER trg_notify_on_feedback
  AFTER INSERT ON public.feedback_submissions
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_feedback();

COMMENT ON FUNCTION public.owner_alert(uuid, text, text, text, text) IS
  'Сповіщення менеджеру/власниці про заявку (26.10): одне на (user, type); далі trg_send_push_on_notification → push, а send-push дублює типи tutor_request_* / pro_request_* / feedback_new_* у Telegram тим, у кого він привʼязаний.';
