-- Streak freeze ("рятівник"): protect a streak when a tutor misses a day.
-- Each tutor gets 1 free freeze per month, auto-consumed when a gap > 1 day occurs.

ALTER TABLE public.tutor_streaks
  ADD COLUMN IF NOT EXISTS freezes_available integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS freezes_granted_month text,
  ADD COLUMN IF NOT EXISTS last_freeze_used_at timestamptz;

-- Replace the streak trigger function to support freezes.
CREATE OR REPLACE FUNCTION public.update_tutor_streak()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _today date := (NEW.starts_at AT TIME ZONE 'Europe/Kyiv')::date;
  _row record;
  _new_current int;
  _gap int;
  _freezes_used int := 0;
  _current_month text := to_char(now() AT TIME ZONE 'Europe/Kyiv', 'YYYY-MM');
BEGIN
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF OLD.status = 'completed' THEN RETURN NEW; END IF;

  SELECT * INTO _row FROM public.tutor_streaks WHERE tutor_id = NEW.tutor_id;
  IF NOT FOUND THEN
    INSERT INTO public.tutor_streaks
      (tutor_id, current_streak, longest_streak, last_lesson_date,
       freezes_available, freezes_granted_month)
    VALUES (NEW.tutor_id, 1, 1, _today, 1, _current_month);
    RETURN NEW;
  END IF;

  -- Auto-grant 1 freeze per calendar month (Europe/Kyiv).
  IF _row.freezes_granted_month IS DISTINCT FROM _current_month THEN
    UPDATE public.tutor_streaks
       SET freezes_available = LEAST(_row.freezes_available + 1, 2),
           freezes_granted_month = _current_month
     WHERE tutor_id = NEW.tutor_id;
    SELECT * INTO _row FROM public.tutor_streaks WHERE tutor_id = NEW.tutor_id;
  END IF;

  IF _row.last_lesson_date = _today THEN
    RETURN NEW;
  END IF;

  _gap := _today - _row.last_lesson_date;

  IF _gap = 1 THEN
    _new_current := _row.current_streak + 1;
  ELSIF _gap > 1 AND _row.freezes_available > 0 AND _row.current_streak > 0 THEN
    -- Use one freeze to skip missed days, keep streak alive and increment.
    _new_current := _row.current_streak + 1;
    _freezes_used := 1;
  ELSE
    _new_current := 1;
  END IF;

  UPDATE public.tutor_streaks
     SET current_streak = _new_current,
         longest_streak = GREATEST(longest_streak, _new_current),
         last_lesson_date = _today,
         freezes_available = freezes_available - _freezes_used,
         last_freeze_used_at = CASE WHEN _freezes_used > 0 THEN now() ELSE last_freeze_used_at END,
         updated_at = now()
   WHERE tutor_id = NEW.tutor_id;

  -- Bonus: 30+ day streak grants +30 days Pro (max once per month).
  IF _new_current >= 30 AND (_row.bonus_granted_at IS NULL OR _row.bonus_granted_at < now() - interval '30 days') THEN
    PERFORM public.grant_pro_days(NEW.tutor_id, 30, 'streak_30_days', jsonb_build_object('streak', _new_current));
    UPDATE public.tutor_streaks SET bonus_granted_at = now() WHERE tutor_id = NEW.tutor_id;
  END IF;

  RETURN NEW;
END;
$function$;