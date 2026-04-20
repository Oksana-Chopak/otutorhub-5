-- =========================================================
-- 1) BANK CARD: store only last4 + optional bank name
-- =========================================================
ALTER TABLE public.profile_contacts
  ADD COLUMN IF NOT EXISTS bank_card_last4 text,
  ADD COLUMN IF NOT EXISTS bank_name text;

-- Migrate existing data: keep only last 4 digits
UPDATE public.profile_contacts
SET bank_card_last4 = RIGHT(regexp_replace(bank_card, '\D', '', 'g'), 4)
WHERE bank_card IS NOT NULL
  AND bank_card_last4 IS NULL
  AND length(regexp_replace(bank_card, '\D', '', 'g')) >= 4;

-- Drop the plaintext PAN column
ALTER TABLE public.profile_contacts DROP COLUMN IF EXISTS bank_card;

-- Constrain last4 format
ALTER TABLE public.profile_contacts
  DROP CONSTRAINT IF EXISTS profile_contacts_bank_card_last4_chk;
ALTER TABLE public.profile_contacts
  ADD CONSTRAINT profile_contacts_bank_card_last4_chk
  CHECK (bank_card_last4 IS NULL OR bank_card_last4 ~ '^[0-9]{4}$');

-- =========================================================
-- 2) LESSONS: column-level confidentiality between parties
--    Students must not see tutor_payout / tutor_payout_status / tutor_paid_at
--    Tutors must not see student_price / student_payment_status / student_paid_at
--    Managers (via has_role) retain full visibility through their policies,
--    but column-level GRANTs apply to all roles uniformly. To keep manager
--    visibility while restricting counterparties, we expose financials
--    through a SECURITY DEFINER function and revoke direct SELECT on those
--    columns from authenticated.
-- =========================================================

-- Revoke direct column SELECT for the sensitive financial columns
REVOKE SELECT (student_price, student_payment_status, student_paid_at,
               tutor_payout,  tutor_payout_status,  tutor_paid_at)
  ON public.lessons FROM authenticated;

-- Re-grant SELECT only to managers via a security-definer view-style function.
-- Provide a helper function that returns the financial columns only to
-- the appropriate role for a given lesson.
CREATE OR REPLACE FUNCTION public.get_lesson_financials(_lesson_id uuid)
RETURNS TABLE (
  id uuid,
  student_price numeric,
  student_payment_status payment_status,
  student_paid_at timestamptz,
  tutor_payout numeric,
  tutor_payout_status payment_status,
  tutor_paid_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_manager boolean;
  _is_tutor   boolean;
  _is_student boolean;
  _row        public.lessons%ROWTYPE;
BEGIN
  SELECT * INTO _row FROM public.lessons WHERE public.lessons.id = _lesson_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  _is_manager := public.has_role(auth.uid(), 'manager'::app_role);
  _is_tutor   := (auth.uid() = _row.tutor_id);
  _is_student := (auth.uid() = _row.student_id);

  IF _is_manager THEN
    RETURN QUERY SELECT _row.id,
      _row.student_price, _row.student_payment_status, _row.student_paid_at,
      _row.tutor_payout,  _row.tutor_payout_status,  _row.tutor_paid_at;
  ELSIF _is_tutor THEN
    -- Tutor sees only their own payout, not student price
    RETURN QUERY SELECT _row.id,
      NULL::numeric, NULL::payment_status, NULL::timestamptz,
      _row.tutor_payout, _row.tutor_payout_status, _row.tutor_paid_at;
  ELSIF _is_student THEN
    -- Student sees only their own price, not tutor payout
    RETURN QUERY SELECT _row.id,
      _row.student_price, _row.student_payment_status, _row.student_paid_at,
      NULL::numeric, NULL::payment_status, NULL::timestamptz;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_lesson_financials(uuid) TO authenticated;

-- Bulk variant for list pages (returns rows accessible by RLS, plus role-scoped financials)
CREATE OR REPLACE FUNCTION public.list_lesson_financials()
RETURNS TABLE (
  id uuid,
  student_price numeric,
  student_payment_status payment_status,
  student_paid_at timestamptz,
  tutor_payout numeric,
  tutor_payout_status payment_status,
  tutor_paid_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_manager boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  _is_manager := public.has_role(auth.uid(), 'manager'::app_role);

  IF _is_manager THEN
    RETURN QUERY
      SELECT l.id,
             l.student_price, l.student_payment_status, l.student_paid_at,
             l.tutor_payout,  l.tutor_payout_status,  l.tutor_paid_at
      FROM public.lessons l;
  ELSE
    RETURN QUERY
      SELECT l.id,
             CASE WHEN l.student_id = auth.uid() THEN l.student_price          ELSE NULL END,
             CASE WHEN l.student_id = auth.uid() THEN l.student_payment_status ELSE NULL END,
             CASE WHEN l.student_id = auth.uid() THEN l.student_paid_at        ELSE NULL END,
             CASE WHEN l.tutor_id   = auth.uid() THEN l.tutor_payout           ELSE NULL END,
             CASE WHEN l.tutor_id   = auth.uid() THEN l.tutor_payout_status    ELSE NULL END,
             CASE WHEN l.tutor_id   = auth.uid() THEN l.tutor_paid_at          ELSE NULL END
      FROM public.lessons l
      WHERE l.tutor_id = auth.uid() OR l.student_id = auth.uid();
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_lesson_financials() TO authenticated;