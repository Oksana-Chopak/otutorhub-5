-- Fix: Add financial constraints to tutor INSERT policy
-- First drop existing policy
DROP POLICY IF EXISTS "Tutor creates own lessons" ON public.lessons;

-- Create restrictive policy for tutor INSERT to prevent financial manipulation
-- Financial values are set automatically via trigger or by manager UPDATE
CREATE POLICY "Tutor creates own lessons with default financials"
ON public.lessons
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'tutor')
  AND tutor_id = auth.uid()
  AND created_by = auth.uid()
  -- Force financial fields to their defaults (prevent manipulation)
  AND student_price = 0
  AND tutor_payout = 0
  AND student_payment_status = 'unpaid'
  AND tutor_payout_status = 'unpaid'
);

-- Create separate manager policy with full access
DROP POLICY IF EXISTS "Manager creates any lessons" ON public.lessons;
CREATE POLICY "Manager creates any lessons"
ON public.lessons
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'manager')
);

-- Student insert policy: add explicit check for student_price = 0
DROP POLICY IF EXISTS "Student creates own lessons" ON public.lessons;
CREATE POLICY "Student creates own lessons with default financials"
ON public.lessons
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'student')
  AND student_id = auth.uid()
  AND created_by = auth.uid()
  -- Force financial fields to their defaults (prevent manipulation)
  AND student_price = 0
  AND tutor_payout = 0
  AND student_payment_status = 'unpaid'
  AND tutor_payout_status = 'unpaid'
);

-- Realtime security fix: Revoke direct access to realtime.messages
-- Users should use the realtime API through Supabase client which validates JWT
REVOKE ALL ON realtime.messages FROM authenticated, anon;
REVOKE ALL ON realtime.messages FROM PUBLIC;