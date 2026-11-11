/* ============================================================================
   Репетитор школи не бачить цін школи — КРОК 2 (11.11, рішення власниці).

   Крок 1 (20261111150000) дав вʼю `student_pairs_visible`: ті самі пари, але ціна й
   реквізити репетиторові школи — NULL, і клієнт читає пари через неї. Тут закриваємо
   сам вхід: рядки `student_rates` школи репетитор більше не читає НАПРЯМУ (ні з
   застосунку, ні запитом повз нього). Свої самостійні пари він читає, як і раніше.

   ⚠️ Вставляти ЛИШЕ після того, як збірка з `pairsRel()` опублікована: стара збірка
   читає таблицю, і репетитор школи побачив би порожній список учнів у формі уроку.

   Ідемпотентно. -- LIVE-MARKER: student_rates_tutor_scope
   ============================================================================ */

-- Маркер для check-db-sync: функція, яку видно в types.ts після вставки.
CREATE OR REPLACE FUNCTION public.student_rates_tutor_scope()
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'independent-only'::text $$;
REVOKE ALL ON FUNCTION public.student_rates_tutor_scope() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_rates_tutor_scope() TO authenticated, service_role;

DO $$
BEGIN
  IF to_regclass('public.student_pairs_visible') IS NULL THEN
    RAISE EXCEPTION 'Спершу вставте 20261111150000_school_roles_money (немає student_pairs_visible)';
  END IF;
END $$;

DROP POLICY IF EXISTS "Tutor views own student rates" ON public.student_rates;
CREATE POLICY "Tutor views own student rates" ON public.student_rates
  FOR SELECT TO authenticated
  USING (auth.uid() = tutor_id AND source = 'independent');
