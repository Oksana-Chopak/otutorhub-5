-- 49: виправлення свіфу 45 — справжні імена політик.  (ІДЕМПОТЕНТНО)
--
-- Три DROP у хвилі 45 промахнулися повз реальні імена й МОВЧКИ нічого не
-- зробили: DROP POLICY IF EXISTS не скаржиться на неіснуюче ім'я. Коментар
-- міграції оголошував дірку закритою, а вона лишалась відкритою — найгірший
-- різновид помилки. Імена нижче витягнуті з історії міграцій програмно,
-- а не написані з пам'яті; тест migration-policy-names.test.ts тепер валить
-- батарею на будь-якому DROP, чиє ім'я жоден CREATE POLICY ніколи не створював.

-- ── 1. Банківські реквізити (справжнє ім'я — «see», не «view») ───────────────
drop policy if exists "Managers see all financial contacts" on public.profile_financial_contacts;
drop policy if exists "Managers manage financial contacts"  on public.profile_financial_contacts;

-- ── 2. Метадані вкладень у чужих чатах ───────────────────────────────────────
drop policy if exists "Manager views all chat attachments" on public.chat_message_attachments;

-- ── 3. Бонусний реєстр: арм вижив ПОРУЧ із суперадмінською політикою ─────────
-- (політики об'єднуються через OR, тож нова нічого не звужувала)
drop policy if exists "Manager views all bonuses" on public.pro_bonus_ledger;

-- ── 4. Писати в чужий тред і створювати чужі треди ──────────────────────────
-- Менеджер більше не читає чужі переписки — але міг у них ПИСАТИ. Власні треди
-- покриває політика учасника (start_manager_chat кладе менеджера в student_id).
drop policy if exists "Manager sends message"      on public.chat_messages;
drop policy if exists "Manager creates any thread" on public.chat_threads;

-- ── 5. САМІ ФАЙЛИ вкладень: перестворити без арму ───────────────────────────
-- Тут арм сидить усередині USING, тож дропнути політику = відрізати доступ і
-- законним учасникам. Перестворюємо те саме правило без гілки менеджера.
drop policy if exists "Chat attachments: participants read" on storage.objects;
create policy "Chat attachments: participants read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND EXISTS (
      SELECT 1 FROM public.chat_message_attachments a
      JOIN public.chat_threads t ON t.id = a.thread_id
      WHERE a.storage_path = name
        AND (auth.uid() = t.tutor_id OR auth.uid() = t.student_id)
    )
  );

-- ── 6. Модерація суперадміна поширюється й на файли ─────────────────────────
drop policy if exists "Superadmin moderates chat files" on storage.objects;
create policy "Superadmin moderates chat files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'chat-attachments' AND public.is_superadmin());
