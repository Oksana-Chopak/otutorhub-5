-- HOTFIX: 20260602000001_performance_indexes.sql переписав lessons_visible так,
-- що фінансові поля (student_price, student_payment_status, tutor_payout,
-- tutor_payout_status, paid_at) і homework/summary читались з legacy-колонок
-- ТАБЛИЦІ lessons (порожні дублікати), а не з lesson_details, куди реально пише
-- застосунок. Плюс незалежного репетитора випустили з умови видимості оплат
-- учня. Наслідок на проді: у Розкладі/Дашборді все «неоплачено», конспекти й
-- домашки порожні. ДАНІ ЦІЛІ — зламане лише «вікно».
--
-- Цей фікс зливає найкраще з обох версій:
--   • caller-CTE з перф-міграції (has_role рахується один раз на запит);
--   • LEFT JOIN lesson_details + правильні CASE-умови з еталона 20260505
--     (включно з «tutor бачить оплати учня для source='independent'»);
--   • повертає subject_id, загублений у перф-версії.

DROP VIEW IF EXISTS public.lessons_visible;

CREATE VIEW public.lessons_visible
WITH (security_invoker = true) AS
WITH caller AS (
  SELECT
    auth.uid() AS uid,
    public.has_role(auth.uid(), 'manager'::app_role) AS is_manager
)
SELECT
  l.id,
  l.tutor_id,
  l.student_id,
  l.created_by,
  l.subject,
  l.subject_id,
  l.starts_at,
  l.duration_minutes,
  l.status,
  l.notes,
  l.source,
  l.lesson_type,
  l.group_id,
  l.created_at,
  l.updated_at,
  l.meeting_url,
  ld.homework,
  ld.summary,
  CASE
    WHEN c.is_manager OR c.uid = l.student_id THEN ld.student_notes
    ELSE NULL::text
  END AS student_notes,
  CASE
    WHEN c.is_manager OR c.uid = l.student_id
         OR (c.uid = l.tutor_id AND l.source = 'independent'::text)
      THEN ld.student_price
    ELSE NULL::numeric
  END AS student_price,
  CASE
    WHEN c.is_manager OR c.uid = l.student_id
         OR (c.uid = l.tutor_id AND l.source = 'independent'::text)
      THEN ld.student_payment_status
    ELSE NULL::text
  END AS student_payment_status,
  CASE
    WHEN c.is_manager OR c.uid = l.student_id
         OR (c.uid = l.tutor_id AND l.source = 'independent'::text)
      THEN ld.student_paid_at
    ELSE NULL::timestamptz
  END AS student_paid_at,
  CASE
    WHEN c.is_manager OR c.uid = l.tutor_id THEN ld.tutor_payout
    ELSE NULL::numeric
  END AS tutor_payout,
  CASE
    WHEN c.is_manager OR c.uid = l.tutor_id THEN ld.tutor_payout_status
    ELSE NULL::text
  END AS tutor_payout_status,
  CASE
    WHEN c.is_manager OR c.uid = l.tutor_id THEN ld.tutor_paid_at
    ELSE NULL::timestamptz
  END AS tutor_paid_at
FROM public.lessons l
LEFT JOIN public.lesson_details ld ON ld.lesson_id = l.id
CROSS JOIN caller c;

GRANT SELECT ON public.lessons_visible TO authenticated;
