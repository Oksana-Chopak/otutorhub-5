-- 1) Tighten "Tutor updates own lessons" RLS policy
DROP POLICY IF EXISTS "Tutor updates own lessons (non-financial)" ON public.lessons;

CREATE POLICY "Tutor updates own lessons (non-financial)"
ON public.lessons
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'tutor'::app_role)
  AND auth.uid() = tutor_id
)
WITH CHECK (
  public.has_role(auth.uid(), 'tutor'::app_role)
  AND auth.uid() = tutor_id
  AND tutor_id   = (SELECT l.tutor_id   FROM public.lessons l WHERE l.id = lessons.id)
  AND student_id = (SELECT l.student_id FROM public.lessons l WHERE l.id = lessons.id)
  AND student_price          = (SELECT l.student_price          FROM public.lessons l WHERE l.id = lessons.id)
  AND tutor_payout           = (SELECT l.tutor_payout           FROM public.lessons l WHERE l.id = lessons.id)
  AND student_payment_status = (SELECT l.student_payment_status FROM public.lessons l WHERE l.id = lessons.id)
  AND tutor_payout_status    = (SELECT l.tutor_payout_status    FROM public.lessons l WHERE l.id = lessons.id)
  AND student_paid_at IS NOT DISTINCT FROM (SELECT l.student_paid_at FROM public.lessons l WHERE l.id = lessons.id)
  AND tutor_paid_at   IS NOT DISTINCT FROM (SELECT l.tutor_paid_at   FROM public.lessons l WHERE l.id = lessons.id)
);

-- 2) Restrict public listing of the avatars bucket
DROP POLICY IF EXISTS "Public read avatars" ON storage.objects;

CREATE POLICY "Public read avatar files"
ON storage.objects
FOR SELECT
TO public
USING (
  bucket_id = 'avatars'
  AND name IS NOT NULL
  AND position('/' in name) > 0
);

-- 3) Remove duplicate triggers on public.lessons
DROP TRIGGER IF EXISTS trg_lessons_autofill_prices ON public.lessons;
DROP TRIGGER IF EXISTS trg_protect_lesson_financials ON public.lessons;
DROP TRIGGER IF EXISTS trg_lessons_updated ON public.lessons;
DROP TRIGGER IF EXISTS trg_set_payment_dates ON public.lessons;

-- 4) Drop legacy duplicate INSERT policy on lessons
DROP POLICY IF EXISTS "Manager creates any lessons" ON public.lessons;

-- 5) Drop duplicate restrictive role policies
DROP POLICY IF EXISTS "Only managers can delete roles (restrictive)" ON public.user_roles;
DROP POLICY IF EXISTS "Only managers can insert roles (restrictive)" ON public.user_roles;
DROP POLICY IF EXISTS "Only managers can update roles (restrictive)" ON public.user_roles;