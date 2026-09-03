-- ═══════════════════════════════════════════════════════════════════════════
-- HUB_ID — етап B: скоуп manager-політик на хаб.  (ІДЕМПОТЕНТНО, ЗГЕНЕРОВАНО)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Згенеровано скриптом із ЖИВИХ визначень політик у історії міграцій (остання
-- CREATE мінус DROP), а не з пам'яті: тест migration-policy-names гарантує, що
-- кожне ім'я тут справді існує. Перетворення одне й механічне:
--     has_role(auth.uid(),'manager')  →  (has_role(...) AND <скоуп таблиці>)
-- де скоуп — із явної мапи «таблиця → ключ»:
--   tutor_id            → is_hub_scoped(tutor_id)
--   lesson_id           → is_hub_scoped((SELECT tutor_id FROM lessons WHERE id=lesson_id))
--   user_id / id        → is_hub_member(...)   (тьютор хабу або учень хабу)
--   student_id          → is_hub_member(student_id)
-- Усе інше в тілі політики лишається дослівно. Тому менеджер продовжує бачити
-- і робити ВСЕ, що бачив і робив, — але лише в межах свого хабу.
--
-- Поки менеджер один — поведінка ідентична (усі хабові тьютори мають hub_id =
-- цей менеджер після етапу A). Різниця з'явиться з другим менеджером — і саме
-- тоді вона потрібна.
--
-- ЗАСТОСОВУВАТИ ПІСЛЯ 20260903170000 (етап A). Перед Run — читання аудиторкою.

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
    (public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_member(student_id))
    AND EXISTS (
      SELECT 1 FROM public.lesson_groups g
      WHERE g.id = group_enrollments.group_id
        AND NOT EXISTS (SELECT 1 FROM public.tutor_workspace_settings ws
                        WHERE ws.tutor_id = g.tutor_id AND ws.independent_workspace = true)
    )
  )
  WITH CHECK (
    (public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_member(student_id))
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
CREATE POLICY "Manager inserts profiles" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK ((public.has_role(auth.uid(),'manager'::app_role) AND public.is_hub_member(id)));

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
