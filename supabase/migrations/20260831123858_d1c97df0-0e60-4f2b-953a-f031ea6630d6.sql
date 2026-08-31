drop policy if exists "Managers see all financial contacts" on public.profile_financial_contacts;
drop policy if exists "Managers manage financial contacts"  on public.profile_financial_contacts;
drop policy if exists "Manager views all chat attachments"  on public.chat_message_attachments;
drop policy if exists "Manager views all bonuses"           on public.pro_bonus_ledger;
drop policy if exists "Manager sends message"               on public.chat_messages;
drop policy if exists "Manager creates any thread"          on public.chat_threads;

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

drop policy if exists "Superadmin moderates chat files" on storage.objects;
create policy "Superadmin moderates chat files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'chat-attachments' AND public.is_superadmin());