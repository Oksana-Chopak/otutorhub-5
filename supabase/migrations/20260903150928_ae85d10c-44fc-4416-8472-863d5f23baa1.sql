-- M4: валюта уроку в lessons_visible.
--
-- Плата за скасування (TutorChangeRequestsCard:477) і борг у контексті чату
-- (ChatsPage:290, :1388) читали (activeLesson as any).currency з в'ю, у якій
-- такої колонки НЕМАЄ → завжди undefined → завжди «₴». Для репетитора зі
-- шведськими чи польськими учнями це брехня на екрані та в сповіщенні учневі.
--
-- Валюта живе в student_rates (валюта пари tutor↔student). Тягнемо її сюди
-- через LEFT JOIN по парі; для групових уроків беремо валюту учасника з
-- lesson_participants.currency там, де читач — учасник. Маскування грошей
-- не змінюється: валюта — не сума, вона видима всім, хто бачить сам урок.
--
-- Визначення в'ю ДОСЛІВНО повторює 20260721000000 + одна колонка. Таймстемп
-- вищий за 20260902170000, інакше Lovable мовчки пропустить (пастка 2.2).

-- LIVE-MARKER-IN: lessons_visible :: currency: string
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
  CASE WHEN c.is_manager OR c.uid=l.tutor_id THEN ld.tutor_paid_at ELSE NULL::timestamptz END AS tutor_paid_at,
  -- M4: валюта пари; для групового уроку — валюта участі читача, інакше UAH
  COALESCE(sr.currency, lp.currency, 'UAH')::text AS currency
FROM public.lessons l
LEFT JOIN public.lesson_details ld ON ld.lesson_id = l.id
CROSS JOIN caller c
LEFT JOIN public.student_rates sr
  ON sr.tutor_id = l.tutor_id AND sr.student_id = l.student_id AND sr.archived_at IS NULL
LEFT JOIN public.lesson_participants lp
  ON lp.lesson_id = l.id AND lp.student_id = c.uid
WHERE (
  (c.is_manager AND (l.source = 'hub' OR l.source IS NULL))
  OR c.uid = l.tutor_id
  OR c.uid = l.student_id
  OR (l.lesson_type IN ('pair','group') AND l.group_id IS NOT NULL AND public.is_group_active_student(l.group_id, c.uid))
);
REVOKE ALL ON public.lessons_visible FROM PUBLIC, anon;
GRANT SELECT ON public.lessons_visible TO authenticated;