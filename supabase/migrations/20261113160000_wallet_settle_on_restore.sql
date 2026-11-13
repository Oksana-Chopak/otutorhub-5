/* ============================================================================
   Повернутий зі скасованих урок одразу закривається передоплатою
   (13.11, прохід грошей у браузері після скарги «передплатила 8, оплачено 7»).

   Попередня міграція (20261113140000) повертає кредит у гаманець, коли оплачений
   з нього урок скасували. Зворотний бік: урок ПОВЕРНУЛИ зі скасованих («Скасовано →
   Заплановано») — він ставав неоплаченим, хоча в гаманці пари лежав кредит. Це
   порушує інваріант «передоплата не лежить без діла». Тепер повернення уроку
   запускає те саме авто-закриття, що й поповнення гаманця.

   Ідемпотентно. -- LIVE-MARKER: wallet_restore_settle_scope
   ============================================================================ */

CREATE OR REPLACE FUNCTION public.wallet_restore_settle_scope()
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'settle-on-uncancel'::text $$;
REVOKE ALL ON FUNCTION public.wallet_restore_settle_scope() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wallet_restore_settle_scope() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.wallet_settle_on_lesson_restore()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' AND NEW.student_id IS NOT NULL THEN
    PERFORM public.wallet_settle_pair(NEW.tutor_id, NEW.student_id);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.wallet_settle_on_lesson_restore() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_wallet_settle_on_restore ON public.lessons;
CREATE TRIGGER trg_wallet_settle_on_restore
  AFTER UPDATE OF status ON public.lessons
  FOR EACH ROW
  WHEN (OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION public.wallet_settle_on_lesson_restore();

-- Разово: пари, де є кредит і водночас неоплачені уроки (кредит лежав без діла).
DO $$
DECLARE _r record; _n int := 0;
BEGIN
  FOR _r IN
    SELECT DISTINCT w.tutor_id, w.student_id
      FROM public.student_wallet_transactions w
     GROUP BY w.tutor_id, w.student_id
    HAVING COALESCE(SUM(w.lessons_delta), 0) > 0 OR COALESCE(SUM(w.amount_delta), 0) > 0
  LOOP
    _n := _n + COALESCE(public.wallet_settle_pair(_r.tutor_id, _r.student_id), 0);
  END LOOP;
  RAISE NOTICE 'wallet_settle_on_restore: закрито уроків кредитом, що лежав без діла: %', _n;
END $$;
