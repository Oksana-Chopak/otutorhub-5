import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import i18n from "@/i18n";

const t = i18n.t.bind(i18n);

// Session cache of resolved sender display names, keyed by sender_id. Chat toasts for the
// same person recur constantly (and a manager sees every sender), so this collapses the
// per-message profiles round-trip to one lookup per distinct sender per session.
const senderNameCache = new Map<string, string>();

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
      .channel(`global-new-messages-${myId}`)
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

          // No client-side participant re-check: Supabase Realtime enforces the
          // chat_messages SELECT RLS on delivery, so a non-manager only ever RECEIVES
          // inserts for threads they belong to (managers legitimately receive all). The
          // old per-event chat_threads fetch was a redundant round-trip on every message.

          // Sender name (best effort, cached per session to avoid a per-message fetch).
          let senderName = senderNameCache.get(msg.sender_id);
          if (senderName === undefined) {
            const { data: senderProfile } = await supabase
              .from("profiles")
              .select("first_name, last_name")
              .eq("id", msg.sender_id)
              .maybeSingle();
            senderName = senderProfile
              ? `${senderProfile.first_name ?? ""} ${senderProfile.last_name ?? ""}`.trim() || t("globalChatExtra.newMessage")
              : t("globalChatExtra.newMessage");
            senderNameCache.set(msg.sender_id, senderName);
          }

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
