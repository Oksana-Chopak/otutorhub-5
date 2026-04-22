-- Allow managers to send messages in any chat thread
CREATE POLICY "Manager sends message"
ON public.chat_messages
FOR INSERT
TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND has_role(auth.uid(), 'manager'::app_role)
);

-- Allow managers to create a thread for any tutor-student pair (RPC already covers, but add direct policy for safety/UI flow)
-- (Manager creates any thread policy already exists.)