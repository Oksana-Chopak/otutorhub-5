
-- ============================================
-- PART 1: tutor_student_pairs incremental table
-- ============================================
CREATE TABLE IF NOT EXISTS public.tutor_student_pairs (
  tutor_id uuid NOT NULL,
  student_id uuid NOT NULL,
  from_lessons int NOT NULL DEFAULT 0,
  from_rates int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tutor_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_tsp_student ON public.tutor_student_pairs(student_id);
CREATE INDEX IF NOT EXISTS idx_tsp_tutor ON public.tutor_student_pairs(tutor_id);

ALTER TABLE public.tutor_student_pairs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tsp_manager_all" ON public.tutor_student_pairs
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "tsp_participants_select" ON public.tutor_student_pairs
  FOR SELECT TO authenticated
  USING (auth.uid() = tutor_id OR auth.uid() = student_id);

-- Backfill from existing data
INSERT INTO public.tutor_student_pairs (tutor_id, student_id, from_lessons, from_rates)
SELECT
  tutor_id,
  student_id,
  COALESCE(l_cnt, 0),
  COALESCE(r_cnt, 0)
FROM (
  SELECT tutor_id, student_id, COUNT(*)::int AS l_cnt FROM public.lessons GROUP BY tutor_id, student_id
) l
FULL OUTER JOIN (
  SELECT tutor_id, student_id, COUNT(*)::int AS r_cnt FROM public.student_rates GROUP BY tutor_id, student_id
) r USING (tutor_id, student_id)
WHERE tutor_id IS NOT NULL AND student_id IS NOT NULL
ON CONFLICT (tutor_id, student_id) DO NOTHING;

-- Trigger functions
CREATE OR REPLACE FUNCTION public.tsp_lessons_ins()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.tutor_student_pairs (tutor_id, student_id, from_lessons)
  VALUES (NEW.tutor_id, NEW.student_id, 1)
  ON CONFLICT (tutor_id, student_id) DO UPDATE
    SET from_lessons = public.tutor_student_pairs.from_lessons + 1;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tsp_lessons_del()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.tutor_student_pairs
    SET from_lessons = GREATEST(from_lessons - 1, 0)
    WHERE tutor_id = OLD.tutor_id AND student_id = OLD.student_id;
  DELETE FROM public.tutor_student_pairs
    WHERE tutor_id = OLD.tutor_id AND student_id = OLD.student_id
      AND from_lessons = 0 AND from_rates = 0;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public.tsp_rates_ins()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.tutor_student_pairs (tutor_id, student_id, from_rates)
  VALUES (NEW.tutor_id, NEW.student_id, 1)
  ON CONFLICT (tutor_id, student_id) DO UPDATE
    SET from_rates = public.tutor_student_pairs.from_rates + 1;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tsp_rates_del()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.tutor_student_pairs
    SET from_rates = GREATEST(from_rates - 1, 0)
    WHERE tutor_id = OLD.tutor_id AND student_id = OLD.student_id;
  DELETE FROM public.tutor_student_pairs
    WHERE tutor_id = OLD.tutor_id AND student_id = OLD.student_id
      AND from_lessons = 0 AND from_rates = 0;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_tsp_lessons_ins ON public.lessons;
CREATE TRIGGER trg_tsp_lessons_ins AFTER INSERT ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.tsp_lessons_ins();

DROP TRIGGER IF EXISTS trg_tsp_lessons_del ON public.lessons;
CREATE TRIGGER trg_tsp_lessons_del AFTER DELETE ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.tsp_lessons_del();

DROP TRIGGER IF EXISTS trg_tsp_rates_ins ON public.student_rates;
CREATE TRIGGER trg_tsp_rates_ins AFTER INSERT ON public.student_rates
  FOR EACH ROW EXECUTE FUNCTION public.tsp_rates_ins();

DROP TRIGGER IF EXISTS trg_tsp_rates_del ON public.student_rates;
CREATE TRIGGER trg_tsp_rates_del AFTER DELETE ON public.student_rates
  FOR EACH ROW EXECUTE FUNCTION public.tsp_rates_del();

-- ============================================
-- PART 2: updated_at triggers
-- ============================================
DROP TRIGGER IF EXISTS trg_chat_messages_updated ON public.chat_messages;
-- chat_messages has no updated_at column; skip if missing
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='chat_messages' AND column_name='updated_at') THEN
    CREATE TRIGGER trg_chat_messages_updated BEFORE UPDATE ON public.chat_messages
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_chat_threads_updated ON public.chat_threads;
CREATE TRIGGER trg_chat_threads_updated BEFORE UPDATE ON public.chat_threads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_lesson_details_updated ON public.lesson_details;
CREATE TRIGGER trg_lesson_details_updated BEFORE UPDATE ON public.lesson_details
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_lesson_feedback_updated ON public.lesson_feedback;
CREATE TRIGGER trg_lesson_feedback_updated BEFORE UPDATE ON public.lesson_feedback
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_availability_requests_updated ON public.availability_requests;
CREATE TRIGGER trg_availability_requests_updated BEFORE UPDATE ON public.availability_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- PART 3: Rewrite pair-based RLS to use tutor_student_pairs
-- ============================================

-- availability_requests INSERT
DROP POLICY IF EXISTS "Manager or related student creates request" ON public.availability_requests;
CREATE POLICY "Manager or related student creates request" ON public.availability_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    (auth.uid() = requester_id) AND (
      has_role(auth.uid(), 'manager'::app_role)
      OR (
        has_role(auth.uid(), 'student'::app_role)
        AND EXISTS (
          SELECT 1 FROM public.tutor_student_pairs p
          WHERE p.tutor_id = availability_requests.tutor_id AND p.student_id = auth.uid()
        )
      )
    )
  );

-- chat_threads INSERT
DROP POLICY IF EXISTS "Participant creates own thread" ON public.chat_threads;
CREATE POLICY "Participant creates own thread" ON public.chat_threads
  FOR INSERT TO authenticated
  WITH CHECK (
    ((auth.uid() = tutor_id) OR (auth.uid() = student_id))
    AND EXISTS (
      SELECT 1 FROM public.tutor_student_pairs p
      WHERE p.tutor_id = chat_threads.tutor_id AND p.student_id = chat_threads.student_id
    )
  );

-- profiles SELECT (visibility scoped to relationships)
DROP POLICY IF EXISTS "Profiles visibility scoped to relationships" ON public.profiles;
CREATE POLICY "Profiles visibility scoped to relationships" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'manager'::app_role)
    OR auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM public.tutor_student_pairs p
      WHERE (p.tutor_id = auth.uid() AND p.student_id = profiles.id)
         OR (p.student_id = auth.uid() AND p.tutor_id = profiles.id)
    )
    OR EXISTS (
      SELECT 1 FROM public.chat_threads t
      WHERE ((t.tutor_id = auth.uid()) AND (t.student_id = profiles.id))
         OR ((t.student_id = auth.uid()) AND (t.tutor_id = profiles.id))
    )
  );

-- profile_contacts SELECT (Tutors view contacts of active students)
DROP POLICY IF EXISTS "Tutors view contacts of active students" ON public.profile_contacts;
CREATE POLICY "Tutors view contacts of active students" ON public.profile_contacts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tutor_student_pairs p
      WHERE p.tutor_id = auth.uid() AND p.student_id = profile_contacts.user_id
    )
  );

-- student_details SELECT (Tutor views own students details)
DROP POLICY IF EXISTS "Tutor views own students details" ON public.student_details;
CREATE POLICY "Tutor views own students details" ON public.student_details
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'tutor'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.tutor_student_pairs p
      WHERE p.tutor_id = auth.uid() AND p.student_id = student_details.user_id
    )
  );
