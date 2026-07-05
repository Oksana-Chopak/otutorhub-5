CREATE OR REPLACE FUNCTION public.mark_tutor_payouts_paid(_tutor_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'Only managers can mark payouts';
  END IF;
  UPDATE public.lesson_details ld
  SET tutor_payout_status = 'paid', tutor_paid_at = now()
  FROM public.lessons l
  WHERE l.id = ld.lesson_id AND l.tutor_id = _tutor_id
    AND COALESCE(ld.tutor_payout_status,'unpaid') = 'unpaid'
    AND l.status <> 'cancelled'
    AND l.status <> 'pending'
    AND (l.status = 'completed' OR l.starts_at <= now());
  GET DIAGNOSTICS _n = ROW_COUNT;
  UPDATE public.tutor_details SET payout_last_marked_at = now() WHERE user_id = _tutor_id;
  RETURN _n;
END; $$;

REVOKE EXECUTE ON FUNCTION public.mark_tutor_payouts_paid(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mark_tutor_payouts_paid(uuid) TO authenticated;