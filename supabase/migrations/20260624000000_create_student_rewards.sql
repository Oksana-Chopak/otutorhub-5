/* ============================================================================
   Restore the student_rewards feature in prod.

   Discovered during the pre-release audit follow-up: public.student_rewards does NOT
   exist in prod (not in types.ts; to_regclass returned NULL). Its original migration
   20260525000002_student_rewards.sql was never applied — reward_theme is live only
   because a SEPARATE migration (20260531073033) re-added that column. So the rewards
   feature (emoji rewards awarded on lesson-complete and shown in StudentRewardsShelf —
   used by LessonWorkspace, DashboardPage, useStudentRewards) has silently never worked,
   and the #4 INSERT-policy hardening had no table to attach to.

   Re-create the table + indexes + RLS idempotently, with the HARDENED insert policy
   (tutor may only reward a student they actually teach — shared rate or lesson incl.
   group participant). Timestamp above the latest applied (ordering trap).
   ============================================================================ */

CREATE TABLE IF NOT EXISTS public.student_rewards (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  lesson_id  UUID        REFERENCES public.lessons(id) ON DELETE SET NULL,
  tutor_id   UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  emoji      TEXT        NOT NULL,
  theme      TEXT        NOT NULL DEFAULT 'fruits',
  earned_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS student_rewards_student_idx
  ON public.student_rewards(student_id, earned_at DESC);

ALTER TABLE public.student_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student_own_rewards_select" ON public.student_rewards;
CREATE POLICY "student_own_rewards_select" ON public.student_rewards
  FOR SELECT TO authenticated
  USING (auth.uid() = student_id);

/* Hardened insert (#4): require a real tutor↔student relationship, not just
   auth.uid() = tutor_id. */
DROP POLICY IF EXISTS "tutor_insert_rewards" ON public.student_rewards;
CREATE POLICY "tutor_insert_rewards" ON public.student_rewards
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = tutor_id
    AND (
      EXISTS (
        SELECT 1 FROM public.student_rates r
        WHERE r.tutor_id = auth.uid() AND r.student_id = student_rewards.student_id
      )
      OR EXISTS (
        SELECT 1 FROM public.lessons l
        WHERE l.tutor_id = auth.uid()
          AND (
            l.student_id = student_rewards.student_id
            OR EXISTS (
              SELECT 1 FROM public.lesson_participants lp
              WHERE lp.lesson_id = l.id AND lp.student_id = student_rewards.student_id
            )
          )
      )
    )
  );

/* Managers may read all rewards (parity with other tables; harmless gamification data). */
DROP POLICY IF EXISTS "manager_views_rewards" ON public.student_rewards;
CREATE POLICY "manager_views_rewards" ON public.student_rewards
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'manager'::app_role));
