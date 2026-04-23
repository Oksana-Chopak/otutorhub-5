import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Returns total number of chat threads with at least one unread message
 * for the current authenticated user. Updates in realtime when new
 * messages arrive or when the user marks a thread as read (chat_reads).
 */
export function useUnreadChats(): number {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user?.id) {
      setCount(0);
      return;
    }
    const myId = user.id;
    let cancelled = false;

    const compute = async () => {
      // Threads where user participates (manager sees all)
      const { data: threads } = await supabase
        .from("chat_threads")
        .select("id, last_message_at");
      const threadList = (threads ?? []) as Array<{
        id: string;
        last_message_at: string | null;
      }>;
      if (threadList.length === 0) {
        if (!cancelled) setCount(0);
        return;
      }

      const ids = threadList.map((t) => t.id);
      const { data: reads } = await supabase
        .from("chat_reads")
        .select("thread_id, last_read_at")
        .eq("user_id", myId)
        .in("thread_id", ids);
      const readMap = new Map<string, string>();
      (reads ?? []).forEach((r: any) => readMap.set(r.thread_id, r.last_read_at));

      let unread = 0;
      for (const t of threadList) {
        if (!t.last_message_at) continue;
        const readAt = readMap.get(t.id);
        if (!readAt || new Date(t.last_message_at) > new Date(readAt)) {
          // Don't count threads where the only "new" activity is from this user themselves —
          // we approximate by trusting last_message_at; sender's own marking happens on send.
          unread += 1;
        }
      }
      if (!cancelled) setCount(unread);
    };

    compute();

    // Realtime: any new message OR our own read update should refresh
    const suffix = `${myId}-${Math.random().toString(36).slice(2, 8)}`;
    const messagesChannel = supabase
      .channel(`unread-messages-${suffix}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        () => compute()
      )
      .subscribe();

    const readsChannel = supabase
      .channel("unread-reads")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_reads", filter: `user_id=eq.${myId}` },
        () => compute()
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(messagesChannel);
      supabase.removeChannel(readsChannel);
    };
  }, [user?.id]);

  return count;
}
