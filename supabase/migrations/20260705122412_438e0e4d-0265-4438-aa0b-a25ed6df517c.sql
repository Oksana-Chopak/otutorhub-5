/* GROUP hub-money lockdown, part 2 of 2 — READ MASKING (audit HIGH, MON-2). */

DROP VIEW IF EXISTS public.lesson_participants_visible;
CREATE VIEW public.lesson_participants_visible WITH (security_invoker = false) AS
SELECT
  lp.id, lp.lesson_id, lp.student_id, lp.attendance_status, lp.created_at, lp.currency,
  l.tutor_id, l.starts_at, l.subject, l.status, l.source,
  CASE WHEN (
    (public.has_role(auth.uid(), 'manager'::app_role) AND (l.source = 'hub' OR l.source IS NULL))
    OR lp.student_id = auth.uid()
    OR (l.tutor_id = auth.uid() AND l.source = 'independent')
  ) THEN lp.student_price END AS student_price,
  CASE WHEN (
    (public.has_role(auth.uid(), 'manager'::app_role) AND (l.source = 'hub' OR l.source IS NULL))
    OR lp.student_id = auth.uid()
    OR (l.tutor_id = auth.uid() AND l.source = 'independent')
  ) THEN lp.student_payment_status END AS student_payment_status,
  CASE WHEN (
    (public.has_role(auth.uid(), 'manager'::app_role) AND (l.source = 'hub' OR l.source IS NULL))
    OR lp.student_id = auth.uid()
    OR (l.tutor_id = auth.uid() AND l.source = 'independent')
  ) THEN lp.student_paid_at END AS student_paid_at
FROM public.lesson_participants lp
JOIN public.lessons l ON l.id = lp.lesson_id
WHERE
  l.tutor_id = auth.uid()
  OR lp.student_id = auth.uid()
  OR (public.has_role(auth.uid(), 'manager'::app_role) AND (l.source = 'hub' OR l.source IS NULL));

REVOKE ALL ON public.lesson_participants_visible FROM PUBLIC, anon;
GRANT SELECT ON public.lesson_participants_visible TO authenticated;

DROP VIEW IF EXISTS public.group_enrollments_visible;
CREATE VIEW public.group_enrollments_visible WITH (security_invoker = false) AS
SELECT
  e.id, e.group_id, e.student_id, e.status, e.currency, e.joined_at, e.created_at, e.updated_at,
  g.tutor_id,
  CASE WHEN (
    e.student_id = auth.uid()
    OR (
      public.has_role(auth.uid(), 'manager'::app_role)
      AND NOT EXISTS (
        SELECT 1 FROM public.tutor_workspace_settings ws
        WHERE ws.tutor_id = g.tutor_id AND ws.independent_workspace = true
      )
    )
    OR (
      g.tutor_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.tutor_workspace_settings ws
        WHERE ws.tutor_id = g.tutor_id AND ws.independent_workspace = true
      )
    )
  ) THEN e.price_per_lesson END AS price_per_lesson
FROM public.group_enrollments e
JOIN public.lesson_groups g ON g.id = e.group_id
WHERE
  g.tutor_id = auth.uid()
  OR e.student_id = auth.uid()
  OR (
    public.has_role(auth.uid(), 'manager'::app_role)
    AND NOT EXISTS (
      SELECT 1 FROM public.tutor_workspace_settings ws
      WHERE ws.tutor_id = g.tutor_id AND ws.independent_workspace = true
    )
  );

REVOKE ALL ON public.group_enrollments_visible FROM PUBLIC, anon;
GRANT SELECT ON public.group_enrollments_visible TO authenticated;

CREATE OR REPLACE FUNCTION public.fill_group_participant_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _price numeric;
  _currency text;
BEGIN
  IF NEW.student_price IS NULL THEN
    SELECT e.price_per_lesson, e.currency INTO _price, _currency
    FROM public.lessons l
    JOIN public.group_enrollments e
      ON e.group_id = l.group_id AND e.student_id = NEW.student_id
    WHERE l.id = NEW.lesson_id
    LIMIT 1;
    IF _price IS NOT NULL THEN
      NEW.student_price := _price;
      IF _currency IS NOT NULL THEN NEW.currency := _currency; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_group_participant_price ON public.lesson_participants;
CREATE TRIGGER trg_fill_group_participant_price
BEFORE INSERT ON public.lesson_participants
FOR EACH ROW EXECUTE FUNCTION public.fill_group_participant_price();

REVOKE SELECT ON public.lesson_participants FROM authenticated;
GRANT SELECT (id, lesson_id, student_id, attendance_status, created_at, currency)
  ON public.lesson_participants TO authenticated;

REVOKE SELECT ON public.group_enrollments FROM authenticated;
GRANT SELECT (id, group_id, student_id, status, currency, joined_at, created_at, updated_at)
  ON public.group_enrollments TO authenticated;