CREATE OR REPLACE FUNCTION public.get_wallet_balance(_tutor_id uuid, _student_id uuid)
RETURNS TABLE(lessons_balance integer, amount_balance numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'manager'::app_role)
    OR auth.uid() = _tutor_id
    OR auth.uid() = _student_id
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
    SELECT COALESCE(SUM(swt.lessons_delta), 0)::int,
           COALESCE(SUM(swt.amount_delta), 0)::numeric(12,2)
    FROM public.student_wallet_transactions swt
    WHERE swt.tutor_id = _tutor_id AND swt.student_id = _student_id;
END;
$function$;