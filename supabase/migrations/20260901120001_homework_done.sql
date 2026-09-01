-- ============================================================================
-- №16 (ідеї 01.09): «Домашку виконано» стає СПРАВЖНЬОЮ.
--
-- Було: homeworkDone.ts зберігав позначку в localStorage ПРИСТРОЮ — учень
-- тисне «виконано», лічильник падає, а репетитор не дізнається ніколи, і на
-- іншому телефоні позначка зникає. Найдешевша петля «учень зробив → репетитор
-- побачив → похвалив» була обірвана посередині.
--
-- Тепер: таблиця homework_done. Учень пише/знімає позначку лише для СВОГО
-- уроку (індивідуального або групового через lesson_participants); репетитор
-- уроку і менеджер читають. Сповіщення репетитору шле клієнт через
-- create_notification (дедуплікація 24h вже там).
-- ============================================================================

-- FK з CASCADE: видалення уроку або purge профілю учня прибирає й позначки —
-- жодних сиріт (урок FULL-AUDIT про purge_user_data, який лишав хвости).
CREATE TABLE public.homework_done (
  lesson_id uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  done_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lesson_id, student_id)
);

CREATE INDEX idx_homework_done_student ON public.homework_done(student_id, done_at DESC);
CREATE INDEX idx_homework_done_lesson ON public.homework_done(lesson_id);

ALTER TABLE public.homework_done ENABLE ROW LEVEL SECURITY;

-- Учень бачить свої позначки.
CREATE POLICY "Student views own homework done"
  ON public.homework_done FOR SELECT TO authenticated
  USING (auth.uid() = student_id);

-- Учень позначає ЛИШЕ свій урок: індивідуальний (lessons.student_id) або
-- груповий (учасник у lesson_participants).
CREATE POLICY "Student marks own homework done"
  ON public.homework_done FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = student_id
    AND EXISTS (
      SELECT 1 FROM public.lessons l
      WHERE l.id = homework_done.lesson_id
        AND (
          l.student_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.lesson_participants p
            WHERE p.lesson_id = l.id AND p.student_id = auth.uid()
          )
        )
    )
  );

-- Зняти позначку теж може лише сам учень.
CREATE POLICY "Student unmarks own homework done"
  ON public.homework_done FOR DELETE TO authenticated
  USING (auth.uid() = student_id);

-- Репетитор уроку бачить, хто виконав.
CREATE POLICY "Tutor views homework done for own lessons"
  ON public.homework_done FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id = homework_done.lesson_id AND l.tutor_id = auth.uid()
  ));

-- Менеджер бачить усе (грошей тут немає; узгоджено з менеджерськими
-- політиками на lessons).
CREATE POLICY "Manager views homework done"
  ON public.homework_done FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));
