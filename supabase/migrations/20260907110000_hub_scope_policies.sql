-- ═══════════════════════════════════════════════════════════════════════════
-- ХАБ — етап B: скоуп менеджерських політик і в'ю на школу.  (ІДЕМПОТЕНТНО)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ЗАСТОСОВУВАТИ ПІСЛЯ 20260907100000 (етап A: hubs, hub_managers, hub_members,
-- is_hub_scoped / is_hub_member). Один файл = одна транзакція в Lovable.
--
-- Три частини:
--   1. 60 політик — згенеровано скриптом із ЖИВИХ визначень (остання CREATE
--      мінус DROP по всій історії міграцій; тест migration-policy-names
--      гарантує, що кожне імʼя існує; звірка 07.09: тіла = живі слово в слово).
--      Перетворення одне й механічне:
--          has_role(auth.uid(),'manager')  →  (has_role(...) AND <скоуп>)
--      де скоуп із мапи «таблиця → ключ»:
--          tutor_id       → is_hub_scoped(tutor_id)
--          lesson_id      → is_hub_scoped((SELECT tutor_id FROM lessons WHERE id=lesson_id))
--          group_id       → is_hub_scoped(репетитор групи)
--          user_id / id   → is_hub_member(...)   (репетитор, учень, pending школи)
--      Усе інше в тілі — дослівно. Менеджер продовжує бачити й робити все, що
--      бачив і робив, — але лише в межах своєї школи. Два свідомі відхилення
--      від механіки: profiles INSERT пускає pending (членство ставить тригер
--      етапу A), group_enrollments скоупиться репетитором групи, не учнем.
--   2. 18 армів поза свіпом — кожен окреме рішення (коментарі при кожному):
--      файли уроків, нотатки й журнал менеджера, запити «знайти репетитора»,
--      платформенні таблиці (бот, розсилки, реферали) → суперадмін.
--   3. Три DEFINER-в'ю (lessons_visible, lesson_participants_visible,
--      group_enrollments_visible) — це головний шлях читання грошей у
--      застосунку і вони мають ВЛАСНИЙ manager-арм, якого не бачить жоден
--      скан політик. Перевипущено дослівно + is_hub_scoped(репетитор уроку).
--
-- Поки школа одна — поведінка ідентична (усі хабові репетитори й учні
-- прикріплені до неї бекфілом етапу A; суперадмін бачить усе). Різниця
-- з'явиться з другою школою — і саме тоді вона потрібна.
--
-- LIVE-MARKER-NONE: політики й в'ю не змінюють форму types.ts. Перевірка
--   вручну: SELECT count(*) FROM pg_policies WHERE qual ILIKE '%is_hub_%'
--   OR with_check ILIKE '%is_hub_%'  → ≥ 70; менеджер другої (тестової) школи
--   на /people не бачить людей першої.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Свіп: 60 політик ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Manager or related student creates request" ON public.availability_requests;
CREATE POLICY "Manager or related student creates request" ON public.availability_requests FOR INSERT TO authenticated
  WITH CHECK (
    (auth.uid() = requester_id) AND (
      (public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id))
      OR (
        has_role(auth.uid(), 'student'::app_role)
        AND EXISTS (
          SELECT 1 FROM public.tutor_student_pairs p
          WHERE p.tutor_id = availability_requests.tutor_id AND p.student_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS "Manager views all requests" ON public.availability_requests;
CREATE POLICY "Manager views all requests" ON public.availability_requests FOR SELECT TO authenticated
  USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "Requester or manager deletes request" ON public.availability_requests;
CREATE POLICY "Requester or manager deletes request" ON public.availability_requests FOR DELETE TO authenticated
  USING (auth.uid() = requester_id OR (public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "Tutor or manager updates request" ON public.availability_requests;
CREATE POLICY "Tutor or manager updates request" ON public.availability_requests FOR UPDATE TO authenticated
  USING (auth.uid() = tutor_id OR (public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)))
  WITH CHECK (auth.uid() = tutor_id OR (public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "Manager manages hub enrollments only" ON public.group_enrollments;
CREATE POLICY "Manager manages hub enrollments only" ON public.group_enrollments FOR ALL TO authenticated
  USING (
    (public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped((SELECT g.tutor_id FROM public.lesson_groups g WHERE g.id = group_id)))
    AND EXISTS (
      SELECT 1 FROM public.lesson_groups g
      WHERE g.id = group_enrollments.group_id
        AND NOT EXISTS (SELECT 1 FROM public.tutor_workspace_settings ws
                        WHERE ws.tutor_id = g.tutor_id AND ws.independent_workspace = true)
    )
  )
  WITH CHECK (
    (public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped((SELECT g.tutor_id FROM public.lesson_groups g WHERE g.id = group_id)))
    AND EXISTS (
      SELECT 1 FROM public.lesson_groups g
      WHERE g.id = group_enrollments.group_id
        AND NOT EXISTS (SELECT 1 FROM public.tutor_workspace_settings ws
                        WHERE ws.tutor_id = g.tutor_id AND ws.independent_workspace = true)
    )
  );

DROP POLICY IF EXISTS "Manager views homework done" ON public.homework_done;
CREATE POLICY "Manager views homework done" ON public.homework_done FOR SELECT TO authenticated
  USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped((SELECT l.tutor_id FROM public.lessons l WHERE l.id = lesson_id))));

DROP POLICY IF EXISTS "Lesson participants add attachments" ON public.lesson_attachments;
CREATE POLICY "Lesson participants add attachments" ON public.lesson_attachments FOR INSERT
TO authenticated
WITH CHECK (
  uploader_id = auth.uid()
  AND (
    (public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped((SELECT l.tutor_id FROM public.lessons l WHERE l.id = lesson_id)))
    OR EXISTS (
      SELECT 1 FROM public.lessons l
      WHERE l.id = lesson_attachments.lesson_id
        AND (
          auth.uid() = l.tutor_id
          OR auth.uid() = l.student_id
          OR (
            l.group_id IS NOT NULL
            AND public.is_group_active_student(l.group_id, auth.uid())
          )
          OR EXISTS (
            SELECT 1 FROM public.lesson_participants lp
            WHERE lp.lesson_id = l.id AND lp.student_id = auth.uid()
          )
        )
    )
  )
);

DROP POLICY IF EXISTS "Lesson participants view attachments" ON public.lesson_attachments;
CREATE POLICY "Lesson participants view attachments" ON public.lesson_attachments FOR SELECT TO authenticated
USING (
  (
    (public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped((SELECT l.tutor_id FROM public.lessons l WHERE l.id = lesson_id)))
    AND EXISTS (
      SELECT 1 FROM public.lessons lm
      WHERE lm.id = lesson_attachments.lesson_id
        AND (lm.source = 'hub' OR lm.source IS NULL)
    )
  )
  OR EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id = lesson_attachments.lesson_id
      AND (
        auth.uid() = l.tutor_id
        OR auth.uid() = l.student_id
        OR (l.group_id IS NOT NULL AND public.is_group_active_student(l.group_id, auth.uid()))
        OR EXISTS (
          SELECT 1 FROM public.lesson_participants lp
          WHERE lp.lesson_id = l.id AND lp.student_id = auth.uid()
        )
      )
  )
);

DROP POLICY IF EXISTS "Uploader tutor or manager deletes attachment" ON public.lesson_attachments;
CREATE POLICY "Uploader tutor or manager deletes attachment" ON public.lesson_attachments FOR DELETE
TO authenticated
USING (
  (public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped((SELECT l.tutor_id FROM public.lessons l WHERE l.id = lesson_id)))
  OR uploader_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id = lesson_attachments.lesson_id
      AND auth.uid() = l.tutor_id
  )
);

DROP POLICY IF EXISTS "Manager manages change requests" ON public.lesson_change_requests;
CREATE POLICY "Manager manages change requests" ON public.lesson_change_requests FOR ALL TO authenticated
USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)))
WITH CHECK ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "Manager views all change requests" ON public.lesson_change_requests;
CREATE POLICY "Manager views all change requests" ON public.lesson_change_requests FOR SELECT TO authenticated
USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "lesson_details_manager_hub_only" ON public.lesson_details;
CREATE POLICY "lesson_details_manager_hub_only" ON public.lesson_details FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id = lesson_details.lesson_id
      AND (public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped((SELECT l.tutor_id FROM public.lessons l WHERE l.id = lesson_id)))
      AND (l.source = 'hub' OR l.source IS NULL)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id = lesson_details.lesson_id
      AND (public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped((SELECT l.tutor_id FROM public.lessons l WHERE l.id = lesson_id)))
      AND (l.source = 'hub' OR l.source IS NULL)
  )
);

DROP POLICY IF EXISTS "lesson_details_restrict_direct_select" ON public.lesson_details;
CREATE POLICY "lesson_details_restrict_direct_select" ON public.lesson_details AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped((SELECT l.tutor_id FROM public.lessons l WHERE l.id = lesson_id)))
    OR EXISTS (
      SELECT 1 FROM public.lessons l
      WHERE l.id = lesson_details.lesson_id AND l.tutor_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Manager deletes feedback" ON public.lesson_feedback;
CREATE POLICY "Manager deletes feedback" ON public.lesson_feedback FOR DELETE TO authenticated
USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "Manager views all feedback" ON public.lesson_feedback;
CREATE POLICY "Manager views all feedback" ON public.lesson_feedback FOR SELECT TO authenticated
USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "Manager manages hub groups only" ON public.lesson_groups;
CREATE POLICY "Manager manages hub groups only" ON public.lesson_groups FOR ALL TO authenticated
  USING (
    (public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id))
    AND NOT EXISTS (SELECT 1 FROM public.tutor_workspace_settings ws
                    WHERE ws.tutor_id = lesson_groups.tutor_id AND ws.independent_workspace = true)
  )
  WITH CHECK (
    (public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id))
    AND NOT EXISTS (SELECT 1 FROM public.tutor_workspace_settings ws
                    WHERE ws.tutor_id = lesson_groups.tutor_id AND ws.independent_workspace = true)
  );

DROP POLICY IF EXISTS "manager_manages_hub_participants_only" ON public.lesson_participants;
CREATE POLICY "manager_manages_hub_participants_only" ON public.lesson_participants FOR ALL TO authenticated
  USING (
    (public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped((SELECT l.tutor_id FROM public.lessons l WHERE l.id = lesson_id)))
    AND EXISTS (SELECT 1 FROM public.lessons l
                WHERE l.id = lesson_participants.lesson_id AND (l.source = 'hub' OR l.source IS NULL))
  )
  WITH CHECK (
    (public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped((SELECT l.tutor_id FROM public.lessons l WHERE l.id = lesson_id)))
    AND EXISTS (SELECT 1 FROM public.lessons l
                WHERE l.id = lesson_participants.lesson_id AND (l.source = 'hub' OR l.source IS NULL))
  );

DROP POLICY IF EXISTS "Manager views all reminders" ON public.lesson_payment_reminders;
CREATE POLICY "Manager views all reminders" ON public.lesson_payment_reminders FOR SELECT TO authenticated
USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "Manager views all lesson reminders" ON public.lesson_reminders;
CREATE POLICY "Manager views all lesson reminders" ON public.lesson_reminders FOR SELECT TO authenticated
USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "Manager creates hub lessons" ON public.lessons;
CREATE POLICY "Manager creates hub lessons" ON public.lessons FOR INSERT TO authenticated
WITH CHECK ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)) AND (source = 'hub' OR source IS NULL));

DROP POLICY IF EXISTS "Manager deletes hub lessons" ON public.lessons;
CREATE POLICY "Manager deletes hub lessons" ON public.lessons FOR DELETE TO authenticated
USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)) AND (source = 'hub' OR source IS NULL));

DROP POLICY IF EXISTS "Manager updates hub lessons" ON public.lessons;
CREATE POLICY "Manager updates hub lessons" ON public.lessons FOR UPDATE TO authenticated
USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)) AND (source = 'hub' OR source IS NULL))
WITH CHECK ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)) AND (source = 'hub' OR source IS NULL));

DROP POLICY IF EXISTS "lessons_select" ON public.lessons;
CREATE POLICY "lessons_select" ON public.lessons FOR SELECT TO authenticated
USING (
  ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)) AND (source = 'hub' OR source IS NULL))
  OR auth.uid() = tutor_id
  OR auth.uid() = student_id
  OR (
    lesson_type IN ('pair', 'group')
    AND group_id IS NOT NULL
    AND public.is_group_active_student(group_id, auth.uid())
  )
);

DROP POLICY IF EXISTS "Manager manages contacts" ON public.profile_contacts;
CREATE POLICY "Manager manages contacts" ON public.profile_contacts FOR ALL TO authenticated
  USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_member(user_id)))
  WITH CHECK ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_member(user_id)));

DROP POLICY IF EXISTS "Manager views all contacts" ON public.profile_contacts;
CREATE POLICY "Manager views all contacts" ON public.profile_contacts FOR SELECT TO authenticated
  USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_member(user_id)));

DROP POLICY IF EXISTS "Manager deletes any profile" ON public.profiles;
CREATE POLICY "Manager deletes any profile" ON public.profiles FOR DELETE TO authenticated
  USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_member(id)));

DROP POLICY IF EXISTS "Manager inserts profiles" ON public.profiles;
-- Свіжий pending-профіль ще не член школи (членство ставить AFTER-тригер
-- attach_hub_member_on_profile), тому менеджер може вставляти ЛИШЕ pending.
CREATE POLICY "Manager inserts profiles" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK ((public.has_role(auth.uid(),'manager'::app_role) AND (public.is_hub_member(id) OR is_pending = true)));

DROP POLICY IF EXISTS "Manager updates any profile" ON public.profiles;
CREATE POLICY "Manager updates any profile" ON public.profiles FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_member(id)));

DROP POLICY IF EXISTS "Profiles visibility scoped to relationships" ON public.profiles;
CREATE POLICY "Profiles visibility scoped to relationships" ON public.profiles FOR SELECT TO authenticated
  USING (
    (public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_member(id))
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

DROP POLICY IF EXISTS "Manager manages all codes" ON public.referral_codes;
CREATE POLICY "Manager manages all codes" ON public.referral_codes FOR ALL TO authenticated USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id))) WITH CHECK ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "Manager manages student details" ON public.student_details;
CREATE POLICY "Manager manages student details" ON public.student_details FOR ALL TO authenticated
  USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_member(user_id)))
  WITH CHECK ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_member(user_id)));

DROP POLICY IF EXISTS "Manager views all student details" ON public.student_details;
CREATE POLICY "Manager views all student details" ON public.student_details FOR SELECT TO authenticated USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_member(user_id)));

DROP POLICY IF EXISTS "Manager manages all quiz" ON public.student_intake_quiz;
CREATE POLICY "Manager manages all quiz" ON public.student_intake_quiz FOR ALL TO authenticated
  USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_member(student_id)))
  WITH CHECK ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_member(student_id)));

DROP POLICY IF EXISTS "Manager manages hub rates only" ON public.student_rates;
CREATE POLICY "Manager manages hub rates only" ON public.student_rates FOR ALL TO authenticated
USING (
  (public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id))
  AND student_rates.source IS DISTINCT FROM 'independent'
  AND NOT EXISTS (
    SELECT 1 FROM public.tutor_workspace_settings ws
    WHERE ws.tutor_id = student_rates.tutor_id
      AND ws.independent_workspace = true
  )
)
WITH CHECK (
  (public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id))
  AND student_rates.source IS DISTINCT FROM 'independent'
  AND NOT EXISTS (
    SELECT 1 FROM public.tutor_workspace_settings ws
    WHERE ws.tutor_id = student_rates.tutor_id
      AND ws.independent_workspace = true
  )
);

DROP POLICY IF EXISTS "Managers insert rewards" ON public.student_rewards;
CREATE POLICY "Managers insert rewards" ON public.student_rewards FOR INSERT TO authenticated
  WITH CHECK ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "Managers view all rewards" ON public.student_rewards;
CREATE POLICY "Managers view all rewards" ON public.student_rewards FOR SELECT TO authenticated
  USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "manager_views_rewards" ON public.student_rewards;
CREATE POLICY "manager_views_rewards" ON public.student_rewards FOR SELECT TO authenticated
  USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "Manager views hub wallet tx only" ON public.student_wallet_transactions;
CREATE POLICY "Manager views hub wallet tx only" ON public.student_wallet_transactions FOR SELECT TO authenticated
USING (
  (public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id))
  AND NOT EXISTS (
    SELECT 1 FROM public.tutor_workspace_settings ws
    WHERE ws.tutor_id = student_wallet_transactions.tutor_id
      AND ws.independent_workspace = true
  )
);

DROP POLICY IF EXISTS "Manager deletes subscription requests" ON public.subscription_requests;
CREATE POLICY "Manager deletes subscription requests" ON public.subscription_requests FOR DELETE TO authenticated
  USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "Manager updates subscription requests" ON public.subscription_requests;
CREATE POLICY "Manager updates subscription requests" ON public.subscription_requests FOR UPDATE TO authenticated
  USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)))
  WITH CHECK ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "Manager views all subscription requests" ON public.subscription_requests;
CREATE POLICY "Manager views all subscription requests" ON public.subscription_requests FOR SELECT TO authenticated
  USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "Manager manages all overrides" ON public.tutor_availability_overrides;
CREATE POLICY "Manager manages all overrides" ON public.tutor_availability_overrides FOR ALL TO authenticated
  USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)))
  WITH CHECK ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "Manager manages all weekly availability" ON public.tutor_availability_weekly;
CREATE POLICY "Manager manages all weekly availability" ON public.tutor_availability_weekly FOR ALL TO authenticated
  USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)))
  WITH CHECK ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "Manager manages badges" ON public.tutor_badges;
CREATE POLICY "Manager manages badges" ON public.tutor_badges FOR ALL TO authenticated USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id))) WITH CHECK ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "Manager views all badges" ON public.tutor_badges;
CREATE POLICY "Manager views all badges" ON public.tutor_badges FOR SELECT TO authenticated USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "Manager views all digests" ON public.tutor_daily_digests;
CREATE POLICY "Manager views all digests" ON public.tutor_daily_digests FOR SELECT TO authenticated
  USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "Manager manages tutor details" ON public.tutor_details;
CREATE POLICY "Manager manages tutor details" ON public.tutor_details FOR ALL TO authenticated
  USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_member(user_id)))
  WITH CHECK ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_member(user_id)));

DROP POLICY IF EXISTS "Restrict tutor_details visibility (restrictive)" ON public.tutor_details;
CREATE POLICY "Restrict tutor_details visibility (restrictive)" ON public.tutor_details AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    (public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_member(user_id))
    OR auth.uid() = user_id
  );

DROP POLICY IF EXISTS "Manager views all notes" ON public.tutor_notes;
CREATE POLICY "Manager views all notes" ON public.tutor_notes FOR SELECT
TO authenticated
USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "Manager manages streaks" ON public.tutor_streaks;
CREATE POLICY "Manager manages streaks" ON public.tutor_streaks FOR ALL TO authenticated USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id))) WITH CHECK ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "Manager views all streaks" ON public.tutor_streaks;
CREATE POLICY "Manager views all streaks" ON public.tutor_streaks FOR SELECT TO authenticated USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "Manager manages defaults" ON public.tutor_student_defaults;
CREATE POLICY "Manager manages defaults" ON public.tutor_student_defaults FOR ALL TO authenticated
  USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)))
  WITH CHECK ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "tsp_manager_all" ON public.tutor_student_pairs;
CREATE POLICY "tsp_manager_all" ON public.tutor_student_pairs FOR ALL TO authenticated
  USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)))
  WITH CHECK ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "Manager manages tutor subject rates" ON public.tutor_subject_rates;
CREATE POLICY "Manager manages tutor subject rates" ON public.tutor_subject_rates FOR ALL
TO authenticated
USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)))
WITH CHECK ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "Manager manages all workspace settings" ON public.tutor_workspace_settings;
CREATE POLICY "Manager manages all workspace settings" ON public.tutor_workspace_settings FOR ALL
TO authenticated
USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)))
WITH CHECK ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_scoped(tutor_id)));

DROP POLICY IF EXISTS "Manager deletes roles" ON public.user_roles;
CREATE POLICY "Manager deletes roles" ON public.user_roles FOR DELETE TO authenticated USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_member(user_id)));

DROP POLICY IF EXISTS "Manager inserts roles" ON public.user_roles;
CREATE POLICY "Manager inserts roles" ON public.user_roles FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_member(user_id)));

DROP POLICY IF EXISTS "Manager updates roles" ON public.user_roles;
CREATE POLICY "Manager updates roles" ON public.user_roles FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_member(user_id)));

DROP POLICY IF EXISTS "Manager views all roles" ON public.user_roles;
CREATE POLICY "Manager views all roles" ON public.user_roles FOR SELECT TO authenticated USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_member(user_id)));

DROP POLICY IF EXISTS "Manager views all links" ON public.user_telegram_links;
CREATE POLICY "Manager views all links" ON public.user_telegram_links FOR SELECT
  TO authenticated
  USING ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_member(user_id)));

-- ── 18 менеджерських армів ПОЗА механічним свіпом (кожен — окреме рішення) ──

-- Аватари: бакет публічний (URL читається без політики), а API-читання менеджера —
-- лише аватари членів своєї школи (шлях у бакеті = <user_id>/…).
DROP POLICY IF EXISTS "Manager reads any avatar" ON storage.objects;
CREATE POLICY "Manager reads any avatar" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'avatars'
    AND public.has_role(auth.uid(), 'manager'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id::text = (storage.foldername(name))[1] AND public.is_hub_member(p.id)
    )
  );

-- Нотатки менеджера про людину: бачать/правлять менеджери школи, де ця людина.
DROP POLICY IF EXISTS "Managers view all notes" ON public.manager_notes;
CREATE POLICY "Managers view all notes" ON public.manager_notes FOR SELECT TO authenticated
  USING ((public.has_role(auth.uid(), 'manager'::app_role) AND public.is_hub_member(subject_user_id)));
DROP POLICY IF EXISTS "Managers insert notes" ON public.manager_notes;
CREATE POLICY "Managers insert notes" ON public.manager_notes FOR INSERT TO authenticated
  WITH CHECK ((public.has_role(auth.uid(), 'manager'::app_role) AND public.is_hub_member(subject_user_id)) AND auth.uid() = author_id);
DROP POLICY IF EXISTS "Managers update notes" ON public.manager_notes;
CREATE POLICY "Managers update notes" ON public.manager_notes FOR UPDATE TO authenticated
  USING ((public.has_role(auth.uid(), 'manager'::app_role) AND public.is_hub_member(subject_user_id)))
  WITH CHECK ((public.has_role(auth.uid(), 'manager'::app_role) AND public.is_hub_member(subject_user_id)));
DROP POLICY IF EXISTS "Managers delete notes" ON public.manager_notes;
CREATE POLICY "Managers delete notes" ON public.manager_notes FOR DELETE TO authenticated
  USING ((public.has_role(auth.uid(), 'manager'::app_role) AND public.is_hub_member(subject_user_id)));

-- Журнал дій: свої дії + дії менеджерів своєї школи; суперадмін — усе.
DROP POLICY IF EXISTS "Managers view audit log" ON public.manager_audit_log;
CREATE POLICY "Managers view audit log" ON public.manager_audit_log FOR SELECT TO authenticated
  USING ((public.has_role(auth.uid(), 'manager'::app_role) AND public.is_hub_member(actor_id)));

-- Файли уроків (шлях = <lesson_id>/…): менеджер — лише уроки репетиторів своєї школи.
DROP POLICY IF EXISTS "Lesson participants upload attachment files" ON storage.objects;
CREATE POLICY "Lesson participants upload attachment files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'lesson-attachments'
    AND (
      (public.has_role(auth.uid(), 'manager'::app_role) AND public.is_hub_scoped(
        (SELECT l.tutor_id FROM public.lessons l WHERE (l.id)::text = (storage.foldername(objects.name))[1])))
      OR EXISTS (
        SELECT 1 FROM public.lessons l
        WHERE (l.id)::text = (storage.foldername(objects.name))[1]
          AND (
            l.tutor_id = auth.uid()
            OR l.student_id = auth.uid()
            OR (l.group_id IS NOT NULL AND public.is_group_active_student(l.group_id, auth.uid()))
            OR EXISTS (
              SELECT 1 FROM public.lesson_participants lp
              WHERE lp.lesson_id = l.id AND lp.student_id = auth.uid()
            )
          )
      )
    )
  );
DROP POLICY IF EXISTS "Tutor or manager deletes attachment files" ON storage.objects;
CREATE POLICY "Tutor or manager deletes attachment files" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'lesson-attachments'
    AND (
      (public.has_role(auth.uid(), 'manager'::app_role) AND public.is_hub_scoped(
        (SELECT l.tutor_id FROM public.lessons l WHERE l.id::text = (storage.foldername(name))[1])))
      OR EXISTS (
        SELECT 1 FROM public.lessons l
        WHERE l.id::text = (storage.foldername(name))[1]
          AND auth.uid() = l.tutor_id
      )
      OR auth.uid() = owner
    )
  );
DROP POLICY IF EXISTS "Lesson participants read lesson-attachments" ON storage.objects;
CREATE POLICY "Lesson participants read lesson-attachments" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'lesson-attachments'
    AND (
      (
        public.has_role(auth.uid(), 'manager'::app_role)
        AND EXISTS (
          SELECT 1
          FROM public.lesson_attachments am
          JOIN public.lessons lm ON lm.id = am.lesson_id
          WHERE am.storage_path = storage.objects.name
            AND (lm.source = 'hub' OR lm.source IS NULL)
            AND public.is_hub_scoped(lm.tutor_id)
        )
      )
      OR EXISTS (
        SELECT 1
        FROM public.lesson_attachments a
        JOIN public.lessons l ON l.id = a.lesson_id
        WHERE a.storage_path = storage.objects.name
          AND (
            auth.uid() = l.tutor_id
            OR auth.uid() = l.student_id
            OR (l.group_id IS NOT NULL AND public.is_group_active_student(l.group_id, auth.uid()))
            OR EXISTS (
              SELECT 1 FROM public.lesson_participants lp
              WHERE lp.lesson_id = l.id AND lp.student_id = auth.uid()
            )
          )
      )
    )
  );

-- Запити «знайти репетитора»: школа бачить запити СВОЇХ учнів; запити без
-- школи (самореєстрація, лід із лендінгу: student_id NULL) — суперадмін, який
-- і розводить їх по школах (notify_managers шле саме йому).
DROP POLICY IF EXISTS "Manager views all referral requests" ON public.tutor_referral_requests;
CREATE POLICY "Manager views all referral requests" ON public.tutor_referral_requests FOR SELECT TO authenticated
  USING ((public.has_role(auth.uid(), 'manager'::app_role) AND (public.is_superadmin() OR public.is_hub_member(student_id))));
DROP POLICY IF EXISTS "Manager updates referral requests" ON public.tutor_referral_requests;
CREATE POLICY "Manager updates referral requests" ON public.tutor_referral_requests FOR UPDATE TO authenticated
  USING ((public.has_role(auth.uid(), 'manager'::app_role) AND (public.is_superadmin() OR public.is_hub_member(student_id))))
  WITH CHECK ((public.has_role(auth.uid(), 'manager'::app_role) AND (public.is_superadmin() OR public.is_hub_member(student_id))));
DROP POLICY IF EXISTS "Manager deletes referral requests" ON public.tutor_referral_requests;
CREATE POLICY "Manager deletes referral requests" ON public.tutor_referral_requests FOR DELETE TO authenticated
  USING ((public.has_role(auth.uid(), 'manager'::app_role) AND (public.is_superadmin() OR public.is_hub_member(student_id))));

-- Платформенне (один бот, одна розсилка, одна реферальна програма на всіх):
-- лише суперадмін. Менеджер школи до цього не має стосунку.
DROP POLICY IF EXISTS "Manager views bot state" ON public.telegram_bot_state;
CREATE POLICY "Manager views bot state" ON public.telegram_bot_state FOR SELECT TO authenticated
  USING ((public.has_role(auth.uid(), 'manager'::app_role) AND public.is_superadmin()));
DROP POLICY IF EXISTS "Manager manages referrals" ON public.referrals;
CREATE POLICY "Manager manages referrals" ON public.referrals FOR ALL TO authenticated
  USING ((public.has_role(auth.uid(), 'manager'::app_role) AND public.is_superadmin()))
  WITH CHECK ((public.has_role(auth.uid(), 'manager'::app_role) AND public.is_superadmin()));
DROP POLICY IF EXISTS "Managers manage campaigns" ON public.marketing_campaigns;
CREATE POLICY "Managers manage campaigns" ON public.marketing_campaigns FOR ALL TO authenticated
  USING ((public.has_role(auth.uid(), 'manager'::app_role) AND public.is_superadmin()))
  WITH CHECK ((public.has_role(auth.uid(), 'manager'::app_role) AND public.is_superadmin()));
DROP POLICY IF EXISTS "Managers view unsubscribes" ON public.marketing_unsubscribes;
CREATE POLICY "Managers view unsubscribes" ON public.marketing_unsubscribes FOR SELECT TO authenticated
  USING ((public.has_role(auth.uid(), 'manager'::app_role) AND public.is_superadmin()));

-- Realtime «subscription-requests:<tutor_id>»: менеджер слухає лише свою школу.
DROP POLICY IF EXISTS "Subscription requests realtime scoped" ON realtime.messages;
CREATE POLICY "Subscription requests realtime scoped" ON realtime.messages FOR SELECT TO authenticated
  USING (
    (realtime.topic() LIKE 'subscription-requests:%')
    AND (
      (public.has_role(auth.uid(), 'manager'::public.app_role)
        AND (public.is_superadmin() OR public.is_hub_scoped(
          (SELECT p.id FROM public.profiles p WHERE p.id::text = split_part(realtime.topic(), ':', 2)))))
      OR (auth.uid())::text = split_part(realtime.topic(), ':', 2)
    )
  );

-- Словник предметів — спільний для всіх шкіл: додавати може будь-який менеджер,
-- правити/видаляти (це зачепить чужі уроки) — лише суперадмін.
DROP POLICY IF EXISTS "subjects_manager_write" ON public.subjects;
CREATE POLICY "subjects_manager_write" ON public.subjects FOR INSERT TO authenticated
  WITH CHECK ((public.has_role(auth.uid(), 'manager') AND public.is_hub_member(auth.uid())));
DROP POLICY IF EXISTS "subjects_superadmin_edit" ON public.subjects;
CREATE POLICY "subjects_superadmin_edit" ON public.subjects FOR UPDATE TO authenticated
  USING ((public.has_role(auth.uid(), 'manager') AND public.is_superadmin()))
  WITH CHECK ((public.has_role(auth.uid(), 'manager') AND public.is_superadmin()));
DROP POLICY IF EXISTS "subjects_superadmin_delete" ON public.subjects;
CREATE POLICY "subjects_superadmin_delete" ON public.subjects FOR DELETE TO authenticated
  USING ((public.has_role(auth.uid(), 'manager') AND public.is_superadmin()));

-- ── 3. DEFINER-в'ю з власним manager-армом ───────────────────────────────────

-- lessons_visible (дослівно 20260903210021 + is_hub_scoped)
DROP VIEW IF EXISTS public.lessons_visible;
CREATE VIEW public.lessons_visible WITH (security_invoker = false) AS
WITH caller AS (
  SELECT auth.uid() AS uid, public.has_role(auth.uid(),'manager'::app_role) AS is_manager
)
SELECT l.id, l.tutor_id, l.student_id, l.created_by, l.subject, l.subject_id,
  l.starts_at, l.duration_minutes, l.status, l.notes, l.source, l.lesson_type,
  l.group_id, l.created_at, l.updated_at, l.meeting_url, ld.homework, ld.summary,
  CASE WHEN (c.is_manager AND public.is_hub_scoped(l.tutor_id)) OR c.uid=l.student_id THEN ld.student_notes ELSE NULL::text END AS student_notes,
  CASE WHEN (c.is_manager AND public.is_hub_scoped(l.tutor_id)) OR c.uid=l.student_id OR (c.uid=l.tutor_id AND l.source='independent') THEN ld.student_price ELSE NULL::numeric END AS student_price,
  CASE WHEN (c.is_manager AND public.is_hub_scoped(l.tutor_id)) OR c.uid=l.student_id OR (c.uid=l.tutor_id AND l.source='independent') THEN ld.student_payment_status ELSE NULL::text END AS student_payment_status,
  CASE WHEN (c.is_manager AND public.is_hub_scoped(l.tutor_id)) OR c.uid=l.student_id OR (c.uid=l.tutor_id AND l.source='independent') THEN ld.student_paid_at ELSE NULL::timestamptz END AS student_paid_at,
  CASE WHEN (c.is_manager AND public.is_hub_scoped(l.tutor_id)) OR c.uid=l.student_id OR (c.uid=l.tutor_id AND l.source='independent') THEN ld.is_cancellation_fee ELSE NULL::boolean END AS is_cancellation_fee,
  CASE WHEN (c.is_manager AND public.is_hub_scoped(l.tutor_id)) OR c.uid=l.tutor_id THEN ld.tutor_payout ELSE NULL::numeric END AS tutor_payout,
  CASE WHEN (c.is_manager AND public.is_hub_scoped(l.tutor_id)) OR c.uid=l.tutor_id THEN ld.tutor_payout_status ELSE NULL::text END AS tutor_payout_status,
  CASE WHEN (c.is_manager AND public.is_hub_scoped(l.tutor_id)) OR c.uid=l.tutor_id THEN ld.tutor_paid_at ELSE NULL::timestamptz END AS tutor_paid_at,
  -- M4: валюта пари; для групового уроку — валюта участі читача, інакше UAH
  COALESCE(sr.currency, lp.currency, 'UAH')::text AS currency
FROM public.lessons l
LEFT JOIN public.lesson_details ld ON ld.lesson_id = l.id
CROSS JOIN caller c
/* РІВНО ОДИН рядок ставки на урок: пара може мати кілька предметів, і
   простий LEFT JOIN по (tutor_id, student_id) множив урок на їх кількість. */
LEFT JOIN LATERAL (
  SELECT r.currency
  FROM public.student_rates r
  WHERE r.tutor_id = l.tutor_id
    AND r.student_id = l.student_id
    AND r.archived_at IS NULL
  ORDER BY (r.subject IS NOT DISTINCT FROM l.subject) DESC, r.created_at DESC NULLS LAST
  LIMIT 1
) sr ON TRUE
/* lesson_participants унікальна по (lesson_id, student_id) — дублювати не може. */
LEFT JOIN public.lesson_participants lp
  ON lp.lesson_id = l.id AND lp.student_id = c.uid
WHERE (
  (c.is_manager AND public.is_hub_scoped(l.tutor_id) AND (l.source = 'hub' OR l.source IS NULL))
  OR c.uid = l.tutor_id
  OR c.uid = l.student_id
  OR (l.lesson_type IN ('pair','group') AND l.group_id IS NOT NULL AND public.is_group_active_student(l.group_id, c.uid))
);
REVOKE ALL ON public.lessons_visible FROM PUBLIC, anon;
GRANT SELECT ON public.lessons_visible TO authenticated;

-- lesson_participants_visible (дослівно 20260720000000 + is_hub_scoped)
DROP VIEW IF EXISTS public.lesson_participants_visible;
CREATE VIEW public.lesson_participants_visible WITH (security_invoker = false) AS
SELECT
  lp.id,
  lp.lesson_id,
  lp.student_id,
  lp.attendance_status,
  lp.created_at,
  lp.currency,
  l.tutor_id,
  l.starts_at,
  l.subject,
  l.status,
  l.source,
  CASE WHEN (
    (public.has_role(auth.uid(), 'manager'::app_role) AND public.is_hub_scoped(l.tutor_id) AND (l.source = 'hub' OR l.source IS NULL))
    OR lp.student_id = auth.uid()
    OR (l.tutor_id = auth.uid() AND l.source = 'independent')
  ) THEN lp.student_price END AS student_price,
  CASE WHEN (
    (public.has_role(auth.uid(), 'manager'::app_role) AND public.is_hub_scoped(l.tutor_id) AND (l.source = 'hub' OR l.source IS NULL))
    OR lp.student_id = auth.uid()
    OR (l.tutor_id = auth.uid() AND l.source = 'independent')
  ) THEN lp.student_payment_status END AS student_payment_status,
  CASE WHEN (
    (public.has_role(auth.uid(), 'manager'::app_role) AND public.is_hub_scoped(l.tutor_id) AND (l.source = 'hub' OR l.source IS NULL))
    OR lp.student_id = auth.uid()
    OR (l.tutor_id = auth.uid() AND l.source = 'independent')
  ) THEN lp.student_paid_at END AS student_paid_at
FROM public.lesson_participants lp
JOIN public.lessons l ON l.id = lp.lesson_id
WHERE
  /* exact replica of the table's SELECT RLS: */
  l.tutor_id = auth.uid()                                   /* tutor_manages_participants */
  OR lp.student_id = auth.uid()                             /* student_views_participation */
  OR (                                                      /* manager_manages_hub_participants_only */
    public.has_role(auth.uid(), 'manager'::app_role)
    AND public.is_hub_scoped(l.tutor_id)
    AND (l.source = 'hub' OR l.source IS NULL)
  );

REVOKE ALL ON public.lesson_participants_visible FROM PUBLIC, anon;
GRANT SELECT ON public.lesson_participants_visible TO authenticated;

-- group_enrollments_visible (дослівно 20260720000000 + is_hub_scoped)
DROP VIEW IF EXISTS public.group_enrollments_visible;
CREATE VIEW public.group_enrollments_visible WITH (security_invoker = false) AS
SELECT
  e.id,
  e.group_id,
  e.student_id,
  e.status,
  e.currency,
  e.joined_at,
  e.created_at,
  e.updated_at,
  g.tutor_id,
  CASE WHEN (
    e.student_id = auth.uid()
    OR (
      public.has_role(auth.uid(), 'manager'::app_role)
      AND public.is_hub_scoped(g.tutor_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.tutor_workspace_settings ws
        WHERE ws.tutor_id = g.tutor_id AND ws.independent_workspace = true
      )
    )
    OR (
      g.tutor_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.tutor_workspace_settings ws
        WHERE ws.tutor_id = g.tutor_id AND ws.independent_workspace = true
      )
    )
  ) THEN e.price_per_lesson END AS price_per_lesson
FROM public.group_enrollments e
JOIN public.lesson_groups g ON g.id = e.group_id
WHERE
  g.tutor_id = auth.uid()                                   /* Tutor manages enrollments of own groups */
  OR e.student_id = auth.uid()                              /* student views own enrollment */
  OR (                                                      /* Manager manages hub enrollments only */
    public.has_role(auth.uid(), 'manager'::app_role)
    AND public.is_hub_scoped(g.tutor_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.tutor_workspace_settings ws
      WHERE ws.tutor_id = g.tutor_id AND ws.independent_workspace = true
    )
  );

REVOKE ALL ON public.group_enrollments_visible FROM PUBLIC, anon;
GRANT SELECT ON public.group_enrollments_visible TO authenticated;
