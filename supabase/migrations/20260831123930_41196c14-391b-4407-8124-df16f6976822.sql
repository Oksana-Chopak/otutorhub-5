-- chat_message_attachments: прибрати арм manager з INSERT
drop policy if exists "Participants insert chat attachments" on public.chat_message_attachments;
create policy "Participants insert chat attachments" on public.chat_message_attachments
  for insert to authenticated
  with check (
    uploader_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.chat_threads t
      WHERE t.id = chat_message_attachments.thread_id
        AND (auth.uid() = t.tutor_id OR auth.uid() = t.student_id)
    )
  );

-- chat_message_attachments: прибрати арм manager з DELETE
drop policy if exists "Uploader deletes own chat attachment" on public.chat_message_attachments;
create policy "Uploader deletes own chat attachment" on public.chat_message_attachments
  for delete to authenticated
  using (uploader_id = auth.uid());

-- storage.objects: прибрати арм manager з видалення файлів чату
drop policy if exists "Chat attachments: uploader delete" on storage.objects;
create policy "Chat attachments: uploader delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-attachments' AND (auth.uid())::text = (storage.foldername(name))[1]);