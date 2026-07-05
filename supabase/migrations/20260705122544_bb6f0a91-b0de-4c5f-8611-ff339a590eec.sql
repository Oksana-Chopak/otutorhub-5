ALTER TABLE public.lesson_details
  ADD COLUMN IF NOT EXISTS is_cancellation_fee boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.update_lesson_details_safe(_lesson_id uuid, _patch jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tutor      uuid;
  v_source     text;
  v_is_mgr     boolean;
  v_mgr_hub    boolean;
  v_student_ok boolean;
BEGIN
  IF _lesson_id IS NULL THEN RAISE EXCEPTION 'lesson_id required'; END IF;
  IF _patch IS NULL OR jsonb_typeof(_patch) <> 'object' THEN RAISE EXCEPTION 'patch must be a jsonb object'; END IF;

  SELECT tutor_id, source INTO v_tutor, v_source FROM public.lessons WHERE id = _lesson_id;
  IF v_tutor IS NULL THEN RAISE EXCEPTION 'lesson not found'; END IF;

  v_is_mgr     := public.has_role(auth.uid(), 'manager');
  IF NOT (auth.uid() = v_tutor OR v_is_mgr) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_mgr_hub    := v_is_mgr AND (v_source = 'hub' OR v_source IS NULL);
  v_student_ok := v_mgr_hub OR (v_source = 'independent' AND auth.uid() = v_tutor);

  INSERT INTO public.lesson_details (lesson_id) VALUES (_lesson_id)
  ON CONFLICT (lesson_id) DO NOTHING;

  UPDATE public.lesson_details SET
    homework               = CASE WHEN _patch ? 'homework'               THEN NULLIF(_patch->>'homework','')                 ELSE homework END,
    summary                = CASE WHEN _patch ? 'summary'                THEN NULLIF(_patch->>'summary','')                  ELSE summary END,
    student_notes          = CASE WHEN _patch ? 'student_notes'          THEN NULLIF(_patch->>'student_notes','')            ELSE student_notes END,
    student_price          = CASE WHEN v_student_ok AND _patch ? 'student_price'
                                  THEN NULLIF(_patch->>'student_price','')::numeric ELSE student_price END,
    student_payment_status = CASE WHEN v_student_ok AND _patch ? 'student_payment_status'
                                  THEN NULLIF(_patch->>'student_payment_status','') ELSE student_payment_status END,
    student_paid_at        = CASE
                               WHEN v_student_ok AND _patch ? 'student_paid_at'
                                 THEN NULLIF(_patch->>'student_paid_at','')::timestamptz
                               WHEN v_student_ok AND _patch ? 'student_payment_status'
                                 THEN CASE WHEN NULLIF(_patch->>'student_payment_status','') = 'paid'
                                           THEN COALESCE(student_paid_at, now())
                                           ELSE NULL END
                               ELSE student_paid_at
                             END,
    is_cancellation_fee    = CASE WHEN v_student_ok AND _patch ? 'is_cancellation_fee'
                                  THEN COALESCE((_patch->>'is_cancellation_fee')::boolean, false)
                                  ELSE is_cancellation_fee END,
    tutor_payout           = CASE WHEN v_mgr_hub AND _patch ? 'tutor_payout'
                                  THEN NULLIF(_patch->>'tutor_payout','')::numeric ELSE tutor_payout END,
    tutor_payout_status    = CASE WHEN v_mgr_hub AND _patch ? 'tutor_payout_status'
                                  THEN NULLIF(_patch->>'tutor_payout_status','') ELSE tutor_payout_status END,
    tutor_paid_at          = CASE
                               WHEN v_mgr_hub AND _patch ? 'tutor_payout_status'
                                 THEN CASE WHEN NULLIF(_patch->>'tutor_payout_status','') = 'paid'
                                           THEN COALESCE(tutor_paid_at, now())
                                           ELSE NULL END
                               ELSE tutor_paid_at
                             END,
    fireflies_meeting_id   = CASE WHEN _patch ? 'fireflies_meeting_id'   THEN NULLIF(_patch->>'fireflies_meeting_id','')     ELSE fireflies_meeting_id END,
    fireflies_requested_at = CASE WHEN _patch ? 'fireflies_requested_at' THEN NULLIF(_patch->>'fireflies_requested_at','')::timestamptz ELSE fireflies_requested_at END,
    fireflies_status       = CASE WHEN _patch ? 'fireflies_status'       THEN NULLIF(_patch->>'fireflies_status','')         ELSE fireflies_status END,
    updated_at             = now()
  WHERE lesson_id = _lesson_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.update_lesson_details_safe(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_lesson_details_safe(uuid, jsonb) TO authenticated;

DROP VIEW IF EXISTS public.lessons_visible;
CREATE VIEW public.lessons_visible WITH (security_invoker = false) AS
WITH caller AS (
  SELECT auth.uid() AS uid, public.has_role(auth.uid(),'manager'::app_role) AS is_manager
)
SELECT l.id, l.tutor_id, l.student_id, l.created_by, l.subject, l.subject_id,
  l.starts_at, l.duration_minutes, l.status, l.notes, l.source, l.lesson_type,
  l.group_id, l.created_at, l.updated_at, l.meeting_url, ld.homework, ld.summary,
  CASE WHEN c.is_manager OR c.uid=l.student_id THEN ld.student_notes ELSE NULL::text END AS student_notes,
  CASE WHEN c.is_manager OR c.uid=l.student_id OR (c.uid=l.tutor_id AND l.source='independent') THEN ld.student_price ELSE NULL::numeric END AS student_price,
  CASE WHEN c.is_manager OR c.uid=l.student_id OR (c.uid=l.tutor_id AND l.source='independent') THEN ld.student_payment_status ELSE NULL::text END AS student_payment_status,
  CASE WHEN c.is_manager OR c.uid=l.student_id OR (c.uid=l.tutor_id AND l.source='independent') THEN ld.student_paid_at ELSE NULL::timestamptz END AS student_paid_at,
  CASE WHEN c.is_manager OR c.uid=l.student_id OR (c.uid=l.tutor_id AND l.source='independent') THEN ld.is_cancellation_fee ELSE NULL::boolean END AS is_cancellation_fee,
  CASE WHEN c.is_manager OR c.uid=l.tutor_id THEN ld.tutor_payout ELSE NULL::numeric END AS tutor_payout,
  CASE WHEN c.is_manager OR c.uid=l.tutor_id THEN ld.tutor_payout_status ELSE NULL::text END AS tutor_payout_status,
  CASE WHEN c.is_manager OR c.uid=l.tutor_id THEN ld.tutor_paid_at ELSE NULL::timestamptz END AS tutor_paid_at
FROM public.lessons l
LEFT JOIN public.lesson_details ld ON ld.lesson_id = l.id
CROSS JOIN caller c
WHERE (
  (c.is_manager AND (l.source = 'hub' OR l.source IS NULL))
  OR c.uid = l.tutor_id
  OR c.uid = l.student_id
  OR (l.lesson_type IN ('pair','group') AND l.group_id IS NOT NULL AND public.is_group_active_student(l.group_id, c.uid))
);

REVOKE ALL ON public.lessons_visible FROM PUBLIC, anon;
GRANT SELECT ON public.lessons_visible TO authenticated;

DROP VIEW IF EXISTS public.lesson_details_student;
CREATE VIEW public.lesson_details_student
WITH (security_invoker = false) AS
SELECT
  ld.lesson_id,
  ld.homework,
  COALESCE(NULLIF(TRIM(ld.summary), ''), ld.fireflies_summary) AS summary,
  ld.student_price,
  ld.student_payment_status,
  ld.student_paid_at,
  ld.is_cancellation_fee,
  ld.created_at,
  ld.updated_at
FROM public.lesson_details ld
JOIN public.lessons l ON l.id = ld.lesson_id
WHERE
  l.student_id = auth.uid()
  OR (l.group_id IS NOT NULL AND public.is_group_active_student(l.group_id, auth.uid()))
  OR EXISTS (
    SELECT 1 FROM public.lesson_participants lp
    WHERE lp.lesson_id = l.id AND lp.student_id = auth.uid()
  );

REVOKE ALL ON public.lesson_details_student FROM PUBLIC, anon;
GRANT SELECT ON public.lesson_details_student TO authenticated;