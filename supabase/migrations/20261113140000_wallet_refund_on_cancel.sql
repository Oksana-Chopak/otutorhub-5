/* ============================================================================
   Передоплата повертається, коли оплачений з неї урок СКАСОВАНО без штрафу
   (13.11, скарга власниці: «передплатила 8 уроків, а оплаченими позначено 7 —
   це ж гроші»).

   Передоплата закриває найближчі неоплачені уроки пари. Якщо один із них потім
   скасовували, списання лишалось на скасованому уроці: кредит «зʼїдав» урок, якого
   не було, а справжній восьмий урок лишався неоплаченим. У грошах скасований без
   штрафу урок ніде не рахується — тобто один оплачений урок просто зникав.

   Тепер: статус уроку → «скасовано», штрафу немає, урок був оплачений ІЗ ГАМАНЦЯ →
   списання повертається в гаманець (наявний тригер повернення), і гаманець одразу
   закриває наступний неоплачений урок пари (наявний тригер авто-закриття).
   Не чіпаємо: урок, позначений оплаченим руками без гаманця (це рішення людини);
   скасування-штраф (is_cancellation_fee); пізнє скасування самим учнем, коли в
   репетитора ввімкнено штраф, — там списання лишається, як і було.

   Наприкінці — разове виправлення вже наявних таких уроків.

   Ідемпотентно. -- LIVE-MARKER: wallet_cancel_refund_scope
   ============================================================================ */

-- Маркер для check-db-sync: функція, яку видно в types.ts після вставки.
CREATE OR REPLACE FUNCTION public.wallet_cancel_refund_scope()
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'wallet-charged-no-fee'::text $$;
REVOKE ALL ON FUNCTION public.wallet_cancel_refund_scope() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wallet_cancel_refund_scope() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.wallet_refund_on_lesson_cancel()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _fee boolean;
  _net_l int;
  _net_a numeric;
  _free_hours numeric;
  _fee_pct numeric;
BEGIN
  IF NEW.status <> 'cancelled' OR OLD.status = 'cancelled' OR NEW.student_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(d.is_cancellation_fee, false) INTO _fee
    FROM public.lesson_details d WHERE d.lesson_id = NEW.id;
  IF COALESCE(_fee, false) THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(lessons_delta), 0), COALESCE(SUM(amount_delta), 0) INTO _net_l, _net_a
    FROM public.student_wallet_transactions
   WHERE lesson_id = NEW.id AND kind IN ('lesson_charge', 'refund');
  IF _net_l = 0 AND _net_a = 0 THEN RETURN NEW; END IF;   -- з гаманця не списувалось

  -- пізнє скасування самим учнем при ввімкненому штрафі: списання лишається
  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.student_id THEN
    SELECT s.cancel_free_hours, s.cancel_fee_percent INTO _free_hours, _fee_pct
      FROM public.tutor_workspace_settings s WHERE s.tutor_id = NEW.tutor_id;
    IF COALESCE(_fee_pct, 0) > 0
       AND EXTRACT(EPOCH FROM (NEW.starts_at - now())) / 3600.0 < COALESCE(_free_hours, 0) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- «оплачено → не оплачено» запускає наявне повернення в гаманець,
  -- а воно — авто-закриття наступного неоплаченого уроку пари
  UPDATE public.lesson_details
     SET student_payment_status = 'unpaid', student_paid_at = NULL
   WHERE lesson_id = NEW.id AND student_payment_status = 'paid';
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.wallet_refund_on_lesson_cancel() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_wallet_refund_on_cancel ON public.lessons;
CREATE TRIGGER trg_wallet_refund_on_cancel
  AFTER UPDATE OF status ON public.lessons
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION public.wallet_refund_on_lesson_cancel();

-- Разово: уже скасовані без штрафу уроки, на яких досі висить списання з гаманця.
DO $$
DECLARE
  _r record;
  _n int := 0;
BEGIN
  FOR _r IN
    SELECT l.id
      FROM public.lessons l
      JOIN public.lesson_details d ON d.lesson_id = l.id
     WHERE l.status = 'cancelled'
       AND l.student_id IS NOT NULL
       AND COALESCE(d.is_cancellation_fee, false) = false
       AND d.student_payment_status = 'paid'
       AND EXISTS (
         SELECT 1 FROM public.student_wallet_transactions w
          WHERE w.lesson_id = l.id AND w.kind IN ('lesson_charge', 'refund')
          GROUP BY w.lesson_id
         HAVING COALESCE(SUM(w.lessons_delta), 0) <> 0 OR COALESCE(SUM(w.amount_delta), 0) <> 0)
     ORDER BY l.starts_at
  LOOP
    UPDATE public.lesson_details
       SET student_payment_status = 'unpaid', student_paid_at = NULL
     WHERE lesson_id = _r.id;
    _n := _n + 1;
  END LOOP;
  RAISE NOTICE 'wallet_refund_on_cancel: повернуто в гаманець списань зі скасованих уроків: %', _n;
END $$;
