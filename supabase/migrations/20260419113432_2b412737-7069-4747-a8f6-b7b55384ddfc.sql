
-- 1) Replace overly broad authenticated read on avatars with owner-only access
DROP POLICY IF EXISTS "Authenticated read avatars" ON storage.objects;
DROP POLICY IF EXISTS "Owner reads own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Manager reads any avatar" ON storage.objects;

CREATE POLICY "Owner reads own avatar"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'avatars'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Manager reads any avatar"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'avatars'
  AND public.has_role(auth.uid(), 'manager'::public.app_role)
);

-- 2) Tighten student lesson INSERT: force zero financial fields, autofill trigger sets real values
DROP POLICY IF EXISTS "Student requests lesson" ON public.lessons;

CREATE POLICY "Student requests lesson"
ON public.lessons
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'student'::public.app_role)
  AND auth.uid() = student_id
  AND auth.uid() = created_by
  AND status = 'pending'::public.lesson_status
  AND student_payment_status = 'unpaid'::public.payment_status
  AND tutor_payout_status = 'unpaid'::public.payment_status
  AND student_price = 0
  AND tutor_payout = 0
);

-- 3) Defense-in-depth: non-negative financial fields
ALTER TABLE public.lessons
  DROP CONSTRAINT IF EXISTS lessons_student_price_nonneg,
  DROP CONSTRAINT IF EXISTS lessons_tutor_payout_nonneg;

ALTER TABLE public.lessons
  ADD CONSTRAINT lessons_student_price_nonneg CHECK (student_price >= 0),
  ADD CONSTRAINT lessons_tutor_payout_nonneg CHECK (tutor_payout >= 0);
