CREATE OR REPLACE FUNCTION public.set_tutor_payout_schedule(
  _tutor_id uuid,
  _frequency text,
  _weekday int,
  _monthday int,
  _anchor date
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'manager') THEN
    RAISE EXCEPTION 'Only managers can set tutor payout schedule';
  END IF;

  IF _frequency IS NOT NULL AND _frequency NOT IN ('weekly','biweekly','monthly') THEN
    RAISE EXCEPTION 'Invalid payout frequency: %', _frequency;
  END IF;

  INSERT INTO public.tutor_details (user_id, payout_frequency, payout_weekday, payout_monthday, payout_anchor)
  VALUES (_tutor_id, _frequency, _weekday, _monthday, _anchor)
  ON CONFLICT (user_id) DO UPDATE
    SET payout_frequency = EXCLUDED.payout_frequency,
        payout_weekday   = EXCLUDED.payout_weekday,
        payout_monthday  = EXCLUDED.payout_monthday,
        payout_anchor    = EXCLUDED.payout_anchor;
END $$;

REVOKE EXECUTE ON FUNCTION public.set_tutor_payout_schedule(uuid, text, int, int, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_tutor_payout_schedule(uuid, text, int, int, date) TO authenticated;