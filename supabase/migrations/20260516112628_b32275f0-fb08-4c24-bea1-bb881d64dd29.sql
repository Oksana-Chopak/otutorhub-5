CREATE OR REPLACE FUNCTION public.is_independent_tutor(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND _user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.tutor_workspace_settings tws ON tws.tutor_id = ur.user_id
      WHERE ur.user_id = _user_id
        AND ur.role = 'tutor'::app_role
        AND COALESCE(tws.independent_workspace, false) = true
    )
$$;

CREATE OR REPLACE FUNCTION public.wallet_topup(
  _tutor_id uuid,
  _student_id uuid,
  _lessons_delta integer,
  _amount_delta numeric,
  _note text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _id uuid;
  _allowed boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;

  _allowed := public.has_role(auth.uid(), 'manager'::app_role)
    OR (
      auth.uid() = _tutor_id
      AND public.is_independent_tutor(auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.student_rates
        WHERE tutor_id = _tutor_id
          AND student_id = _student_id
          AND source = 'independent'
          AND archived_at IS NULL
      )
    );

  IF NOT _allowed THEN
    RAISE EXCEPTION 'Not allowed to top up this wallet';
  END IF;

  IF COALESCE(_lessons_delta, 0) < 0 OR COALESCE(_amount_delta, 0) < 0 THEN
    RAISE EXCEPTION 'Top-up values must be non-negative';
  END IF;

  IF COALESCE(_lessons_delta, 0) = 0 AND COALESCE(_amount_delta, 0) = 0 THEN
    RAISE EXCEPTION 'Nothing to top up';
  END IF;

  INSERT INTO public.student_wallet_transactions
    (tutor_id, student_id, kind, lessons_delta, amount_delta, note, created_by)
  VALUES
    (_tutor_id, _student_id, 'topup', COALESCE(_lessons_delta, 0), COALESCE(_amount_delta, 0), NULLIF(trim(_note), ''), auth.uid())
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;