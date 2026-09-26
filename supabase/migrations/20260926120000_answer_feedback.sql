/* ============================================================================
   26.09 — СКРИНЬКА ЗВЕРНЕНЬ БУЛА В ОДИН БІК.

   Живий випадок власниці: у «Запитах» лежить звернення від 14 вересня —
   «Есть ли у вас чат поддержки?» — і відповісти на нього НІЯК. Сторінка вміє
   лише міняти статус (нове → в роботі → вирішено), тобто людина написала, а
   відповіді не побачить ніколи. Саме через це 15.09 інший користувач і питав
   «Нет чата, где можно связаться с тобой?»: чат підтримки в застосунку є
   (меню → Допомога → Чат підтримки, Telegram), але той, хто скористався
   ФОРМОЮ, лишається без відповіді. Питання без відповіді — це відтік.

   Рішення: відповідь пишеться там, де прочитане звернення, і приходить людині
   у її ж застосунок — дзвіночком, як усі інші сповіщення.

   Чому окрема функція, а не `create_notification`:
     • `create_notification` дозволяє сповіщати лише «своїх» (учень репетитора,
       член школи, менеджер своєї школи). Автор звернення може бути НІЧИЙ —
       самостійний репетитор чи учень без школи, — і тоді вона законно
       відмовляє. Звернення ж читає суперадмін платформи, і відповідати він
       мусить будь-кому;
     • у неї є дедуп «той самий type за 24 години → повертаємо старе»: друга
       відповідь тій самій людині за добу мовчки не дійшла б. Для відповіді
       підтримки це неприпустимо.

   Межі:
     • викликати може ЛИШЕ той, хто цю скриньку бачить: `has_role(manager)` +
       `is_superadmin()` — дослівно скоуп політик читання (20260907125000);
     • пише лише в `feedback_submissions` (текст відповіді + автор + час,
       статус → resolved) і ОДИН рядок у `notifications`;
     • анонімне звернення (user_id IS NULL) відповідь ЗБЕРІГАЄ, але доставити
       нікуди — повертає `delivered: false`, і сторінка каже це словами
       (інваріант «відсутнє рендериться як відсутнє»).

   Ідемпотентно: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE.
   -- LIVE-MARKER: answer_feedback
   ============================================================================ */

ALTER TABLE public.feedback_submissions
  ADD COLUMN IF NOT EXISTS answer      text,
  ADD COLUMN IF NOT EXISTS answered_at timestamptz,
  ADD COLUMN IF NOT EXISTS answered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.feedback_submissions.answer IS
  'Відповідь підтримки (26.09). Пишеться лише через answer_feedback(); людині надсилається сповіщення.';

/* Ніхто, крім функції, не пише відповідь напряму: інакше в базі зʼявився б
   «відповіджено» без сповіщення — тиха брехня для того, хто питав. Колонковий
   REVOKE тут НЕ працює (у Postgres табличний GRANT UPDATE перекриває
   колонкові відкликання), тож інваріант тримає тригер із транзакційним
   прапорцем — той самий прийом, що й у гардах воркспейсу. */
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
  -- Дослівно той самий скоуп, що й ЧИТАННЯ скриньки (політики
  -- feedback_select_own_or_manager / feedback_update_manager із 20260907125000):
  -- хто бачить звернення, той і відповідає. Жодної нової поверхні.
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
    -- Звернення без акаунта: відповідь збережена, доставити нікуди.
    PERFORM set_config('app.allow_feedback_answer', NULL, true);
    RETURN jsonb_build_object('ok', true, 'delivered', false, 'reason', 'anonymous');
  END IF;

  -- Прямий INSERT (а не create_notification) — свідомо: без дедупу по type,
  -- щоб друга відповідь за добу дійшла, і без обмеження «лише свої».
  INSERT INTO public.notifications (user_id, type, title, body)
  VALUES (_row.user_id, 'feedback_reply', 'Відповідь від підтримки', _clean);

  PERFORM set_config('app.allow_feedback_answer', NULL, true);
  RETURN jsonb_build_object('ok', true, 'delivered', true);
END $$;

REVOKE ALL ON FUNCTION public.answer_feedback(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.answer_feedback(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.answer_feedback(uuid, text) IS
  'Відповідь суперадміна на звернення: зберігає текст і надсилає сповіщення автору (26.09).';
