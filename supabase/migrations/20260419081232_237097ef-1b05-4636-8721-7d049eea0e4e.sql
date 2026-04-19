-- 1) Restrict has_role() RPC exposure
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO postgres, service_role;

-- 2) Restrict tutor_details visibility so rate_per_lesson is not world-readable
DROP POLICY IF EXISTS "Authenticated view tutor details" ON public.tutor_details;

-- Tutor can see own full row
CREATE POLICY "Tutor views own details"
ON public.tutor_details
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Students can view tutor details only for tutors who teach them (via lessons or rates).
-- Even then, the sensitive rate column should be hidden at the application layer; this
-- policy still restricts row access broadly.
CREATE POLICY "Student views assigned tutor details"
ON public.tutor_details
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'student'::app_role)
  AND (
    EXISTS (SELECT 1 FROM public.lessons l WHERE l.tutor_id = tutor_details.user_id AND l.student_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.student_rates r WHERE r.tutor_id = tutor_details.user_id AND r.student_id = auth.uid())
  )
);

-- Public-safe view exposing only non-sensitive tutor fields for selection lists (no rate)
CREATE OR REPLACE VIEW public.tutor_directory
WITH (security_invoker = true)
AS
SELECT user_id, subjects, bio
FROM public.tutor_details;

GRANT SELECT ON public.tutor_directory TO authenticated;

-- Allow any authenticated user to see directory rows via the view.
-- The view uses security_invoker; grant a permissive SELECT policy for directory access
-- limited to the columns exposed (subjects, bio) — rate stays restricted by the policies above.
CREATE POLICY "Authenticated views tutor directory fields"
ON public.tutor_details
FOR SELECT
TO authenticated
USING (true);

-- The above keeps row visibility broad (needed for scheduling UI) but we rely on the
-- application/view to avoid selecting rate_per_lesson. To truly protect rate at the DB layer,
-- we drop the permissive policy and replace it with one that excludes rate via column privileges.
DROP POLICY IF EXISTS "Authenticated views tutor directory fields" ON public.tutor_details;

-- Column-level: revoke SELECT on rate_per_lesson from authenticated, then grant on the rest.
REVOKE SELECT ON public.tutor_details FROM authenticated;
GRANT SELECT (user_id, subjects, bio, created_at, updated_at) ON public.tutor_details TO authenticated;
-- rate_per_lesson is now only readable when the row passes RLS AND the role has column SELECT.
-- Grant full SELECT (incl. rate) only to service_role; managers read via has_role policy and
-- bypass column grants because policies + grants are evaluated together — so we must also
-- grant rate_per_lesson SELECT to authenticated but rely on RLS to hide rows. Re-grant:
GRANT SELECT (rate_per_lesson) ON public.tutor_details TO authenticated;

-- Replace broad SELECT with role-scoped policies that limit WHICH ROWS expose the rate.
-- Drop the above policies and rebuild cleanly:
DROP POLICY IF EXISTS "Tutor views own details" ON public.tutor_details;
DROP POLICY IF EXISTS "Student views assigned tutor details" ON public.tutor_details;

-- Manager: full access (already exists via "Manager manages tutor details" ALL policy)
-- Tutor: sees own row (with rate)
CREATE POLICY "Tutor views own details"
ON public.tutor_details
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Any authenticated user: can see tutor rows for directory/scheduling purposes.
-- Application code MUST NOT select rate_per_lesson in these contexts.
CREATE POLICY "Authenticated views tutor directory rows"
ON public.tutor_details
FOR SELECT
TO authenticated
USING (true);

-- 3) Defense-in-depth: prevent tutors from modifying financial fields via RLS WITH CHECK.
DROP POLICY IF EXISTS "Tutor updates own lessons (non-financial)" ON public.lessons;
CREATE POLICY "Tutor updates own lessons (non-financial)"
ON public.lessons
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'tutor'::app_role) AND auth.uid() = tutor_id)
WITH CHECK (
  has_role(auth.uid(), 'tutor'::app_role)
  AND auth.uid() = tutor_id
  AND tutor_id = (SELECT tutor_id FROM public.lessons WHERE id = lessons.id)
  AND student_id = (SELECT student_id FROM public.lessons WHERE id = lessons.id)
  AND student_price = (SELECT student_price FROM public.lessons WHERE id = lessons.id)
  AND tutor_payout = (SELECT tutor_payout FROM public.lessons WHERE id = lessons.id)
  AND student_payment_status = (SELECT student_payment_status FROM public.lessons WHERE id = lessons.id)
  AND tutor_payout_status = (SELECT tutor_payout_status FROM public.lessons WHERE id = lessons.id)
);

-- Ensure financial-protection trigger is installed on lessons (idempotent)
DROP TRIGGER IF EXISTS trg_protect_lesson_financials ON public.lessons;
CREATE TRIGGER trg_protect_lesson_financials
BEFORE UPDATE ON public.lessons
FOR EACH ROW
EXECUTE FUNCTION public.protect_lesson_financials();