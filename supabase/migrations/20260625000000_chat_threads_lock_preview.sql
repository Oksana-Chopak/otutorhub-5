/* ============================================================================
   #2: "Any chat thread participant can update last_message_preview on threads they did
   not create."

   chat_threads.last_message_preview / last_message_at are maintained ONLY by the
   touch_chat_thread() trigger (SECURITY DEFINER, fires on chat_messages INSERT) — it
   bypasses RLS. No client code ever UPDATEs chat_threads (verified: zero .update/.upsert
   on chat_threads in src). The "Participants update own thread" UPDATE policy therefore
   serves no legitimate client need and lets any participant write/spoof the preview.

   Drop it: with no client UPDATE policy, participants can't modify the preview at all,
   while the definer trigger keeps maintaining it. Idempotent. Timestamp above latest.
   ============================================================================ */
DROP POLICY IF EXISTS "Participants update own thread" ON public.chat_threads;
