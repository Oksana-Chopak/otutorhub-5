
-- Column-level lock: tutors keep UPDATE on everything EXCEPT the 3 payout columns.
REVOKE UPDATE ON public.lesson_details FROM authenticated, anon, PUBLIC;

GRANT UPDATE (
  student_price, student_payment_status, student_paid_at,
  homework, summary, student_notes,
  fireflies_status, fireflies_meeting_id, fireflies_requested_at,
  fireflies_completed_at, fireflies_summary, fireflies_transcript,
  fireflies_action_items, fireflies_audio_url, fireflies_recording_url
) ON public.lesson_details TO authenticated;

GRANT ALL ON public.lesson_details TO service_role;

-- Manager-only RPC to set tutor payout status on ONE hub lesson.
CREATE OR REPLACE FUNCTION public.set_lesson_tutor_payout_status(
  _lesson_id uuid,
  _status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'Only managers can set tutor payout status';
  END IF;
  IF _status NOT IN ('paid','unpaid') THEN
    RAISE EXCEPTION 'Invalid status: %', _status;
  END IF;

  UPDATE public.lesson_details ld
  SET tutor_payout_status = _status,
      tutor_paid_at = CASE WHEN _status = 'paid' THEN now() ELSE NULL END
  FROM public.lessons l
  WHERE ld.lesson_id = _lesson_id
    AND l.id = ld.lesson_id
    AND (l.source = 'hub' OR l.source IS NULL);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_lesson_tutor_payout_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_lesson_tutor_payout_status(uuid, text) TO authenticated;

-- Manager-only RPC for bulk "mark all paid/unpaid".
CREATE OR REPLACE FUNCTION public.set_lesson_tutor_payout_status_bulk(
  _lesson_ids uuid[],
  _status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'Only managers can set tutor payout status';
  END IF;
  IF _status NOT IN ('paid','unpaid') THEN
    RAISE EXCEPTION 'Invalid status: %', _status;
  END IF;

  UPDATE public.lesson_details ld
  SET tutor_payout_status = _status,
      tutor_paid_at = CASE WHEN _status = 'paid' THEN now() ELSE NULL END
  FROM public.lessons l
  WHERE ld.lesson_id = ANY(_lesson_ids)
    AND l.id = ld.lesson_id
    AND (l.source = 'hub' OR l.source IS NULL);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_lesson_tutor_payout_status_bulk(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_lesson_tutor_payout_status_bulk(uuid[], text) TO authenticated;
