/* Wallet-tx manager isolation to hub-only + backfill_tutor_payouts_for_tutor RPC + one-time payout backfill for unpaid hub lessons. Idempotent. */

DROP POLICY IF EXISTS "Manager views all wallet tx"      ON public.student_wallet_transactions;
DROP POLICY IF EXISTS "Manager views hub wallet tx only" ON public.student_wallet_transactions;
CREATE POLICY "Manager views hub wallet tx only"
ON public.student_wallet_transactions
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'manager'::app_role)
  AND NOT EXISTS (
    SELECT 1 FROM public.tutor_workspace_settings ws
    WHERE ws.tutor_id = student_wallet_transactions.tutor_id
      AND ws.independent_workspace = true
  )
);

CREATE OR REPLACE FUNCTION public.backfill_tutor_payouts_for_tutor(_tutor_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'Only managers can backfill payouts';
  END IF;
  IF _tutor_id IS NULL THEN RETURN 0; END IF;

  UPDATE public.lesson_details ld
  SET tutor_payout = pick.rate
  FROM public.lessons l
  JOIN LATERAL (
    SELECT COALESCE(
      (SELECT tsr.rate_per_lesson FROM public.tutor_subject_rates tsr
        WHERE tsr.tutor_id = l.tutor_id
          AND lower(btrim(tsr.subject)) = lower(btrim(COALESCE(l.subject,'')))
          AND COALESCE(tsr.rate_per_lesson,0) > 0
        LIMIT 1),
      (SELECT td.rate_per_lesson FROM public.tutor_details td
        WHERE td.user_id = l.tutor_id AND COALESCE(td.rate_per_lesson,0) > 0)
    ) AS rate
  ) pick ON true
  WHERE l.id = ld.lesson_id
    AND l.tutor_id = _tutor_id
    AND (l.source = 'hub' OR l.source IS NULL)
    AND COALESCE(ld.tutor_payout, 0) = 0
    AND COALESCE(ld.tutor_payout_status, 'unpaid') <> 'paid'
    AND pick.rate IS NOT NULL;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

REVOKE EXECUTE ON FUNCTION public.backfill_tutor_payouts_for_tutor(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.backfill_tutor_payouts_for_tutor(uuid) TO authenticated;

UPDATE public.lesson_details ld
SET tutor_payout = pick.rate
FROM public.lessons l
JOIN LATERAL (
  SELECT COALESCE(
    (SELECT tsr.rate_per_lesson FROM public.tutor_subject_rates tsr
      WHERE tsr.tutor_id = l.tutor_id
        AND lower(btrim(tsr.subject)) = lower(btrim(COALESCE(l.subject,'')))
        AND COALESCE(tsr.rate_per_lesson,0) > 0
      LIMIT 1),
    (SELECT td.rate_per_lesson FROM public.tutor_details td
      WHERE td.user_id = l.tutor_id AND COALESCE(td.rate_per_lesson,0) > 0)
  ) AS rate
) pick ON true
WHERE l.id = ld.lesson_id
  AND (l.source = 'hub' OR l.source IS NULL)
  AND COALESCE(ld.tutor_payout, 0) = 0
  AND COALESCE(ld.tutor_payout_status, 'unpaid') <> 'paid'
  AND pick.rate IS NOT NULL;
