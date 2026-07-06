/* ============================================================================
   TWO manager-money fixes found in the owner's manual retest (2026-07-06).

   (1) ISOLATION LEAK (P0): "Manager views all wallet tx" let ANY manager SELECT
       EVERY row of student_wallet_transactions across the whole DB — including an
       INDEPENDENT tutor's students' wallets. The P0 isolation sweep (20260621000000)
       scoped lessons/rates/attachments to hub-only for managers but MISSED the
       wallet ledger. student_wallet_balances is a security_invoker view over this
       table, so it leaked too. Re-scope the manager SELECT to HUB tutors only
       (exclude independent_workspace tutors), mirroring the proven pattern used for
       student_rates + group_enrollments_visible.

   (2) tutor_payout = 0 on real hub lessons: autofill_lesson_details_prices fills
       tutor_payout ONLY at lesson_details INSERT and ONLY when it is currently 0.
       If a tutor's rate is set AFTER their lessons already exist, those lessons keep
       payout 0 forever (margin overstated, tutor under-owed). Fix:
       (2a) one-time backfill of unpaid hub lessons from the tutor's CURRENT rate;
       (2b) a manager-callable RPC backfill_tutor_payouts_for_tutor(_tutor_id) so
            saving/updating a tutor's rate propagates to their existing unpaid
            lessons (the frontend calls it after upserting rates).
       Rate source mirrors the autofill exactly: tutor_subject_rates by subject →
       tutor_details.rate_per_lesson fallback. NEVER touches paid payouts and never
       overwrites a non-zero payout.

   Idempotent. Timestamp strictly above 20260722000000.
   ============================================================================ */

/* ── (1) Wallet-transaction isolation: managers see HUB wallets only ───────── */
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
-- The "Tutor views own wallet tx" / "Student views own wallet tx" policies are
-- unchanged: an independent tutor still sees their OWN students' wallets.

/* ── (2b) Manager RPC: propagate a tutor's current rate to their unpaid hub
   lessons (fills only tutor_payout that is still 0/NULL and not yet paid). ──── */
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
    AND (l.source = 'hub' OR l.source IS NULL)   -- independents have no hub payout
    AND COALESCE(ld.tutor_payout, 0) = 0          -- never overwrite a real payout
    AND COALESCE(ld.tutor_payout_status, 'unpaid') <> 'paid'  -- never touch paid ones
    AND pick.rate IS NOT NULL;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

REVOKE EXECUTE ON FUNCTION public.backfill_tutor_payouts_for_tutor(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.backfill_tutor_payouts_for_tutor(uuid) TO authenticated;

/* ── (2a) One-time backfill of ALL tutors' unpaid hub lessons ──────────────── */
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
