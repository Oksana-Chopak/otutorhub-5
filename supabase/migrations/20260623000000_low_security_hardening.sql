/* ============================================================================
   LOW-severity audit hardening. Timestamp above the latest applied (ordering trap).
   Idempotent.
   ============================================================================ */

/* (#4) student_rewards INSERT only checked auth.uid() = tutor_id, so any tutor could
   award a reward to ANY student (arbitrary student_id) they don't teach. Require a real
   tutor↔student relationship (a shared rate, or a shared lesson incl. group participant). */
DROP POLICY IF EXISTS "tutor_insert_rewards" ON public.student_rewards;
CREATE POLICY "tutor_insert_rewards" ON public.student_rewards
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = tutor_id
    AND (
      EXISTS (
        SELECT 1 FROM public.student_rates r
        WHERE r.tutor_id = auth.uid() AND r.student_id = student_rewards.student_id
      )
      OR EXISTS (
        SELECT 1 FROM public.lessons l
        WHERE l.tutor_id = auth.uid()
          AND (
            l.student_id = student_rewards.student_id
            OR EXISTS (
              SELECT 1 FROM public.lesson_participants lp
              WHERE lp.lesson_id = l.id AND lp.student_id = student_rewards.student_id
            )
          )
      )
    )
  );

/* (#6) SECURITY DEFINER read functions accepted an arbitrary _tutor_id with no caller
   check, leaking another tutor's stats. Add an auth predicate so only the tutor
   themselves or a manager gets real data; everyone else gets 0 (empty aggregate). */
CREATE OR REPLACE FUNCTION public.get_tutor_independent_student_count(_tutor_id UUID)
RETURNS INTEGER
LANGUAGE SQL
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(DISTINCT student_id)::INTEGER
  FROM public.student_rates
  WHERE tutor_id = _tutor_id
    AND source = 'independent'
    AND (_tutor_id = auth.uid() OR public.has_role(auth.uid(), 'manager'::app_role));
$$;

CREATE OR REPLACE FUNCTION public.get_referral_savings_uah(_tutor_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(ROUND(SUM(days_granted)::numeric * 129 / 30), 0)::numeric
  FROM public.pro_bonus_ledger
  WHERE tutor_id = _tutor_id
    AND reason IN ('referral_pro_upgrade', 'referral_3_pro_in_month', 'referral_signup_referrer')
    AND (_tutor_id = auth.uid() OR public.has_role(auth.uid(), 'manager'::app_role));
$$;
