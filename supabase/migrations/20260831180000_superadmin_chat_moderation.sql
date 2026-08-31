-- 48: модерація чатів — суперадміну, не ролі «менеджер».  (ІДЕМПОТЕНТНО)
--
-- Хвиля 45 зняла читання чужих переписок у ролі manager: власник хабу — це
-- платний клієнт, а не модератор платформи. Але сама потреба модерації
-- легітимна, тож повертаємо її на правильному суб'єкті: is_superadmin().
--
-- Модерація = ЧИТАННЯ. Права писати в чужий тред ніхто не отримує.

drop policy if exists "Superadmin moderates threads" on public.chat_threads;
create policy "Superadmin moderates threads" on public.chat_threads
  for select to authenticated using (public.is_superadmin());

drop policy if exists "Superadmin moderates messages" on public.chat_messages;
create policy "Superadmin moderates messages" on public.chat_messages
  for select to authenticated using (public.is_superadmin());

drop policy if exists "Superadmin moderates attachments" on public.chat_message_attachments;
create policy "Superadmin moderates attachments" on public.chat_message_attachments
  for select to authenticated using (public.is_superadmin());

drop policy if exists "Superadmin moderates reactions" on public.chat_message_reactions;
create policy "Superadmin moderates reactions" on public.chat_message_reactions
  for select to authenticated using (public.is_superadmin());

-- Побічна знахідка хвилі 45: «Manager sends message» лишалась і давала ролі
-- manager право ВСТАВЛЯТИ повідомлення в тред, який вона більше не бачить.
-- Писати у власні треди менеджеру дозволяє політика учасника (start_manager_chat
-- кладе менеджера в слот student_id), тож ця політика лише створювала
-- неконсистентність — прибираємо.
drop policy if exists "Manager sends message" on public.chat_messages;
