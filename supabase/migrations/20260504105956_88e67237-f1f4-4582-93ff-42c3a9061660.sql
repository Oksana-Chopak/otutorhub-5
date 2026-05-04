-- 1. Create lesson_details table to offload heavy/optional fields from lessons
CREATE TABLE public.lesson_details (
  lesson_id uuid PRIMARY KEY REFERENCES public.lessons(id) ON DELETE CASCADE,
  homework text,
  summary text,
  student_notes text,
  student_price numeric,
  student_payment_status text,
  tutor_payout numeric,
  tutor_payout_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Auto-update updated_at
CREATE TRIGGER trg_lesson_details_updated_at
BEFORE UPDATE ON public.lesson_details
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Enable RLS
ALTER TABLE public.lesson_details ENABLE ROW LEVEL SECURITY;

-- Tutor or student of the parent lesson can read
CREATE POLICY "lesson_details_select_participants"
ON public.lesson_details
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id = lesson_details.lesson_id
      AND (l.tutor_id = auth.uid() OR l.student_id = auth.uid())
  )
);

-- Manager can do anything
CREATE POLICY "lesson_details_manager_all"
ON public.lesson_details
FOR ALL
USING (public.has_role(auth.uid(), 'manager'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'manager'::app_role));

-- Tutor of the lesson can insert/update detail row
CREATE POLICY "lesson_details_tutor_insert"
ON public.lesson_details
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id = lesson_details.lesson_id AND l.tutor_id = auth.uid()
  )
);

CREATE POLICY "lesson_details_tutor_update"
ON public.lesson_details
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id = lesson_details.lesson_id AND l.tutor_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id = lesson_details.lesson_id AND l.tutor_id = auth.uid()
  )
);

-- 3. Backfill existing data from lessons (NO source columns are dropped)
INSERT INTO public.lesson_details (
  lesson_id, homework, summary, student_notes,
  student_price, student_payment_status,
  tutor_payout, tutor_payout_status
)
SELECT
  id, homework, summary, student_notes,
  student_price, student_payment_status::text,
  tutor_payout, tutor_payout_status::text
FROM public.lessons
ON CONFLICT (lesson_id) DO NOTHING;