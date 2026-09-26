ALTER TABLE public.feedback_submissions
  ADD COLUMN IF NOT EXISTS answer      text,
  ADD COLUMN IF NOT EXISTS answered_at timestamptz,
  ADD COLUMN IF NOT EXISTS answered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.feedback_submissions.answer IS
  'Відповідь підтримки (26.09). Пишеться лише через answer_feedback(); людині надсилається сповіщення.';

CREATE OR REPLACE FUNCTION public.guard_feedback_answer_writes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('app.allow_feedback_answer', true) = '1' THEN
    RETURN NEW;
  END IF;
  IF NEW.answer IS DISTINCT FROM OLD.answer
     OR NEW.answered_at IS DISTINCT FROM OLD.answered_at
     OR NEW.answered_by IS DISTINCT FROM OLD.answered_by THEN
    RAISE EXCEPTION 'answer is written only by answer_feedback() (it also notifies the author)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_feedback_answer_writes ON public.feedback_submissions;
CREATE TRIGGER guard_feedback_answer_writes
  BEFORE UPDATE ON public.feedback_submissions
  FOR EACH ROW EXECUTE FUNCTION public.guard_feedback_answer_writes();

CREATE OR REPLACE FUNCTION public.answer_feedback(_id uuid, _text text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row   record;
  _clean text := btrim(coalesce(_text, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;
  IF NOT (public.has_role(auth.uid(), 'manager'::app_role) AND public.is_superadmin()) THEN
    RAISE EXCEPTION 'Not authorized to answer feedback' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(_clean) < 2 THEN
    RAISE EXCEPTION 'answer is empty' USING ERRCODE = 'check_violation';
  END IF;
  _clean := left(_clean, 2000);

  SELECT id, user_id INTO _row FROM public.feedback_submissions WHERE id = _id;
  IF _row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  PERFORM set_config('app.allow_feedback_answer', '1', true);
  UPDATE public.feedback_submissions
     SET answer      = _clean,
         answered_at = now(),
         answered_by = auth.uid(),
         status      = 'resolved',
         updated_at  = now()
   WHERE id = _id;

  IF _row.user_id IS NULL THEN
    PERFORM set_config('app.allow_feedback_answer', NULL, true);
    RETURN jsonb_build_object('ok', true, 'delivered', false, 'reason', 'anonymous');
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body)
  VALUES (_row.user_id, 'feedback_reply', 'Відповідь від підтримки', _clean);

  PERFORM set_config('app.allow_feedback_answer', NULL, true);
  RETURN jsonb_build_object('ok', true, 'delivered', true);
END $$;

REVOKE ALL ON FUNCTION public.answer_feedback(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.answer_feedback(uuid, text) TO authenticated;