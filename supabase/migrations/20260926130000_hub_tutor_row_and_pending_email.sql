/* ============================================================================
   26.09 — ДВІ ДІРКИ, ЯКІ ЗНАЙШОВ ЗВІТ РОБОТА З ЖИВОГО ПРОДУ.

   ── 1. Хабовий репетитор бачив «Не вдалося завантажити» у «Фінансах» ────────
   Робот назвав головне: на тому екрані база НЕ відповіла жодною помилкою —
   ані 400, ані 401, ані 429. Отже читання пройшло, а рядка
   `tutor_workspace_settings` у людини просто НЕМА, і застосунок не знав
   персону («хабовий чи самостійний?») → малював помилку.

   Чому рядка немає. `handle_new_user` створює його при РЕЄСТРАЦІЇ репетитора,
   а тригер `ensure_hub_tutor_workspace` — коли менеджер ВСТАВЛЯЄ роль
   'tutor'. Але `user_roles` має `UNIQUE (user_id)` — рівно одна роль на
   людину, і `handle_new_user` уже вставив свою. Тобто менеджер, який робить
   репетитора з людини, зареєстрованої як УЧЕНЬ, виконує **UPDATE**, а тригер
   висів лише на `AFTER INSERT` — рядок налаштувань не створювався НІКОЛИ.
   Людина отримувала роль репетитора і зламані «Фінанси».

   Лікування: (а) тригер тепер і на `UPDATE OF role`; (б) школу беремо з
   контексту менеджера АБО з членства самої людини (`hub_members`) — щоб
   спрацьовувало і тоді, коли роль міняє суперадмін; (в) разовий бекфіл для
   тих, кому вже зламали — лише для ЧЛЕНІВ школи (для решти пишемо NOTICE і
   НЕ вигадуємо їм воркспейс: підписка й тріал — не те, що роздають тихо).

   ── 2. Запрошені люди не могли завершити реєстрацію ─────────────────────────
   Робот зафіксував із браузера: `POST /rest/v1/rpc/is_pending_email` → 401
   `permission denied for function is_pending_email`. Це та сама скарга зі
   скану Lovable («confirm-pending-signup blocked»), тільки тепер із доказом і
   на КЛІЄНТСЬКОМУ боці: `AuthPage` кличе цю функцію в чотирьох місцях, щоб
   відрізнити запрошену людину (pending-профіль) від нової. Права після
   20260913090000 має лише `service_role`, тож у браузері вона відмовляє —
   і запрошений учень застрягає на підтвердженні, а людина, яка просто
   помилилась паролем, не чує, що її взагалі запрошували.

   Свідома межа: функція віддає ЛИШЕ true/false про pending-профіль (не про
   зареєстрованих користувачів) і не повертає жодних даних. Це та сама
   інформація, що вже є в листі-запрошенні; ціна відмови — зламана воронка
   запрошень, тож EXECUTE для `anon` виправданий.

   Ідемпотентно: CREATE OR REPLACE + GRANT + бекфіл з NOT EXISTS.
   -- LIVE-MARKER-NONE: гранти й тригери поза types.ts. Вручну:
   --   SELECT has_function_privilege('anon','public.is_pending_email(text)','EXECUTE');  → true
   --   SELECT count(*) FROM pg_trigger WHERE tgname='ensure_hub_tutor_workspace';        → 1
   ============================================================================ */

-- ── 1. Права на is_pending_email для браузера ────────────────────────────────
GRANT EXECUTE ON FUNCTION public.is_pending_email(text) TO anon, authenticated;

-- ── 2. Рядок налаштувань для репетитора школи: і на INSERT, і на UPDATE ролі ─
CREATE OR REPLACE FUNCTION public.ensure_hub_tutor_workspace()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _hub uuid := public.caller_hub_id();
BEGIN
  IF NEW.role = 'manager'::app_role THEN
    RETURN NEW; -- менеджерів прикріплює лише create_hub
  END IF;
  -- Школа з контексту менеджера, а якщо його немає (роль міняє суперадмін або
  -- службовий шлях) — зі членства самої людини.
  IF _hub IS NULL THEN
    SELECT hm.hub_id INTO _hub FROM public.hub_members hm WHERE hm.user_id = NEW.user_id LIMIT 1;
  END IF;
  IF _hub IS NULL THEN
    RETURN NEW; -- ні школи менеджера, ні членства: це не хабовий шлях
  END IF;
  INSERT INTO public.hub_members (hub_id, user_id) VALUES (_hub, NEW.user_id)
  ON CONFLICT DO NOTHING;
  IF NEW.role = 'tutor'::app_role THEN
    INSERT INTO public.tutor_workspace_settings (tutor_id, independent_workspace, subscription_status, hub_id)
    VALUES (NEW.user_id, false, 'free', _hub)
    ON CONFLICT (tutor_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ensure_hub_tutor_workspace ON public.user_roles;
CREATE TRIGGER ensure_hub_tutor_workspace
  AFTER INSERT OR UPDATE OF role ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.ensure_hub_tutor_workspace();

-- ── 3. Разовий бекфіл: кому вже зламали ─────────────────────────────────────
DO $$
DECLARE _fixed int; _orphans int;
BEGIN
  WITH ins AS (
    INSERT INTO public.tutor_workspace_settings (tutor_id, independent_workspace, subscription_status, hub_id)
    SELECT ur.user_id, false, 'free', hm.hub_id
      FROM public.user_roles ur
      JOIN public.hub_members hm ON hm.user_id = ur.user_id
     WHERE ur.role = 'tutor'::app_role
       AND NOT EXISTS (SELECT 1 FROM public.tutor_workspace_settings s WHERE s.tutor_id = ur.user_id)
    ON CONFLICT (tutor_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO _fixed FROM ins;

  SELECT count(*) INTO _orphans
    FROM public.user_roles ur
   WHERE ur.role = 'tutor'::app_role
     AND NOT EXISTS (SELECT 1 FROM public.tutor_workspace_settings s WHERE s.tutor_id = ur.user_id);

  RAISE NOTICE 'hub tutor workspace: створено рядків %, лишилось репетиторів без рядка і без школи % (їм воркспейс не вигадуємо)', _fixed, _orphans;
END $$;

-- ── 4. Вбудована перевірка: тригер справді слухає UPDATE ролі ───────────────
DO $$
DECLARE _upd boolean;
BEGIN
  SELECT (tgtype & 16) > 0 INTO _upd  -- 16 = UPDATE
    FROM pg_trigger WHERE tgname = 'ensure_hub_tutor_workspace' AND tgrelid = 'public.user_roles'::regclass;
  IF _upd IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ensure_hub_tutor_workspace не слухає UPDATE — дірка не закрита';
  END IF;
  IF NOT has_function_privilege('anon', 'public.is_pending_email(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'is_pending_email досі без EXECUTE для anon — запрошення не працюватимуть';
  END IF;
  RAISE NOTICE 'перевірка: тригер слухає UPDATE ролі ✓, is_pending_email доступна браузеру ✓';
END $$;
