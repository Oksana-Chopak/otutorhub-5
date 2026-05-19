import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

/**
 * Listens to new chat_messages inserts and shows a toast when:
 *  - the message is for a thread the current user participates in (or they are manager)
 *  - the user is NOT the sender
 *  - the user is NOT currently on /chats
 */
export function useGlobalChatToasts() {
  const { user, roles } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const locationRef = useRef(location.pathname);
  locationRef.current = location.pathname;

  const isManager = roles.includes("manager");

  useEffect(() => {
    if (!user?.id) return;
    const myId = user.id;

    const channel = supabase
      .channel(`global-new-messages-${myId}-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        async (payload) => {
          const msg = payload.new as {
            id: string;
            thread_id: string;
            sender_id: string;
            body: string;
          };
          if (msg.sender_id === myId) return;
          if (locationRef.current.startsWith("/chats")) return;

          // Verify access: manager sees all; others must be participant
          if (!isManager) {
            const { data: thread } = await supabase
              .from("chat_threads")
              .select("tutor_id, student_id")
              .eq("id", msg.thread_id)
              .maybeSingle();
            if (!thread) return;
            if (thread.tutor_id !== myId && thread.student_id !== myId) return;
          }

          // Sender name (best effort)
          const { data: senderProfile } = await supabase
            .from("profiles")
            .select("first_name, last_name")
            .eq("id", msg.sender_id)
            .maybeSingle();
          const senderName = senderProfile
            ? `${senderProfile.first_name ?? ""} ${senderProfile.last_name ?? ""}`.trim() || t("globalChatExtra.newMessage")
            : t("globalChatExtra.newMessage");

          toast(senderName, {
            description: msg.body.length > 120 ? msg.body.slice(0, 117) + "…" : msg.body,
            action: {
              label: t("globalChatExtra.open"),
              onClick: () => navigate("/chats"),
            },
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, isManager, navigate]);
}
