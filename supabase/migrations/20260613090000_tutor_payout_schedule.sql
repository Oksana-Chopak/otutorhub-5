-- ГРАФІК ВИПЛАТ РЕПЕТИТОРАМ.
-- Кожен репетитор має власну періодичність (для кейсу менеджера: Олена — щоп'ятниці,
-- інший — щосереди, третій — раз на 2 тижні по понеділках). Зберігаємо на
-- tutor_details. День тижня 0..6 (нд..сб, як JS getDay), число місяця 1..28.

ALTER TABLE public.tutor_details
  ADD COLUMN IF NOT EXISTS payout_frequency text,        -- weekly | biweekly | monthly (NULL = без графіка)
  ADD COLUMN IF NOT EXISTS payout_weekday smallint,      -- 0..6 для weekly/biweekly
  ADD COLUMN IF NOT EXISTS payout_monthday smallint,     -- 1..28 для monthly
  ADD COLUMN IF NOT EXISTS payout_anchor date,           -- опорна дата для biweekly (від неї рахуємо парність тижнів)
  ADD COLUMN IF NOT EXISTS payout_last_marked_at timestamptz; -- коли востаннє позначали виплату (для антидублю нагадувань)

-- Масове позначення всіх невиплачених уроків репетитора як виплачених —
-- одним дотиком із задачі на дашборді. Тільки менеджер.
CREATE OR REPLACE FUNCTION public.mark_tutor_payouts_paid(_tutor_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'Only managers can mark payouts';
  END IF;

  UPDATE public.lesson_details ld
  SET tutor_payout_status = 'paid',
      tutor_paid_at = now()
  FROM public.lessons l
  WHERE l.id = ld.lesson_id
    AND l.tutor_id = _tutor_id
    AND COALESCE(ld.tutor_payout_status, 'unpaid') = 'unpaid'
    AND l.status <> 'cancelled';
  GET DIAGNOSTICS _n = ROW_COUNT;

  UPDATE public.tutor_details
  SET payout_last_marked_at = now()
  WHERE user_id = _tutor_id;

  RETURN _n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_tutor_payouts_paid(uuid) TO authenticated;
