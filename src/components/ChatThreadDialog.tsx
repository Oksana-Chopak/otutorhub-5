import { useEffect, useRef, useState } from "react";
import { getLocale } from "@/lib/locale";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Send, MessageSquare, X } from "lucide-react";
import { MessageReactions, type Reaction } from "@/components/MessageReactions";
import { toast } from "sonner";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

interface Message {
  id: string;
  thread_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tutorId: string;
  studentId: string;
  counterpartName?: string;
}

/**
 * Lightweight chat-thread modal. Opens (or creates) the tutor↔student
 * thread and lets the current user read/send messages without leaving
 * the lesson modal or the student card.
 */
export function ChatThreadDialog({
  open,
  onOpenChange,
  tutorId,
  studentId,
  counterpartName,
}: Props) {
  const { user } = useAuth();
  const myId = user?.id ?? null;
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({});
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      setThreadId(null);
      setMessages([]);
      setDraft("");
      setShowArchived(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: tid, error } = await supabase.rpc("get_or_create_chat_thread", {
        _tutor_id: tutorId,
        _student_id: studentId,
      });
      if (error || !tid) {
        toast.error(t("chatThread.openFailed"));
        setLoading(false);
        return;
      }
      let q = supabase
        .from("chat_messages")
        .select("id, thread_id, sender_id, body, created_at")
        .eq("thread_id", tid as string);
      if (!showArchived) q = q.eq("archived", false);
      const { data: msgs } = await q.order("created_at", { ascending: true });
      if (cancelled) return;
      setThreadId(tid as string);
      const list = (msgs ?? []) as Message[];
      setMessages(list);
      // Load reactions
      if (list.length > 0) {
        const { data: rx } = await supabase
          .from("chat_message_reactions")
          .select("message_id, user_id, emoji")
          .in("message_id", list.map((m) => m.id));
        if (!cancelled) {
          const grouped: Record<string, Reaction[]> = {};
          (rx ?? []).forEach((r: any) => {
            if (!grouped[r.message_id]) grouped[r.message_id] = [];
            grouped[r.message_id].push(r);
          });
          setReactions(grouped);
        }
      } else if (!cancelled) {
        setReactions({});
      }
      setLoading(false);
      if (myId) {
        await supabase
          .from("chat_reads")
          .upsert(
            { thread_id: tid as string, user_id: myId, last_read_at: new Date().toISOString() },
            { onConflict: "thread_id,user_id" }
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tutorId, studentId, myId, showArchived]);

  // Realtime
  useEffect(() => {
    if (!threadId) return;
    const channel = supabase
      .channel(`chat-dlg-${threadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `thread_id=eq.${threadId}` },
        (payload) => {
          const m = payload.new as Message;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_message_reactions" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const r = payload.new as Reaction;
            setReactions((prev) => {
              const list = prev[r.message_id] ?? [];
              if (list.some((x) => x.user_id === r.user_id && x.emoji === r.emoji)) return prev;
              return { ...prev, [r.message_id]: [...list, r] };
            });
          } else if (payload.eventType === "DELETE") {
            const r = payload.old as Reaction;
            setReactions((prev) => {
              const list = prev[r.message_id];
              if (!list) return prev;
              return {
                ...prev,
                [r.message_id]: list.filter((x) => !(x.user_id === r.user_id && x.emoji === r.emoji)),
              };
            });
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [threadId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !threadId || !myId) return;
    setSending(true);
    const { error } = await supabase
      .from("chat_messages")
      .insert({ thread_id: threadId, sender_id: myId, body: text });
    setSending(false);
    if (error) {
      toast.error(t("chatThread.sendFailed"), { description: error.message });
      return;
    }
    setDraft("");
  };

  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!myId) return;
    const list = reactions[messageId] ?? [];
    const exists = list.some((r) => r.user_id === myId && r.emoji === emoji);
    if (exists) {
      setReactions((prev) => ({
        ...prev,
        [messageId]: (prev[messageId] ?? []).filter((r) => !(r.user_id === myId && r.emoji === emoji)),
      }));
      await supabase
        .from("chat_message_reactions")
        .delete()
        .eq("message_id", messageId)
        .eq("user_id", myId)
        .eq("emoji", emoji);
    } else {
      setReactions((prev) => ({
        ...prev,
        [messageId]: [...(prev[messageId] ?? []), { message_id: messageId, user_id: myId, emoji }],
      }));
      await supabase
        .from("chat_message_reactions")
        .insert({ message_id: messageId, user_id: myId, emoji });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-md p-0 gap-0 rounded-t-[26px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto flex flex-col [&>button.absolute]:hidden">
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden flex-shrink-0">
          <div style={{ width: 36, height: 4, borderRadius: 999, background: "rgba(15,15,26,.14)" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 18px 10px", flexShrink: 0, borderBottom: "1px solid #eceef3" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={{ width: 38, height: 38, borderRadius: 12, flexShrink: 0, background: "#f0fdf9", boxShadow: "inset 0 0 0 1.5px rgba(43,191,170,.35)", color: "#1f8e7e", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <MessageSquare size={18} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 17, color: "#0f0f1a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {counterpartName || t("chatThread.title")}
              </div>
            </div>
          </div>
          <button type="button" onClick={() => onOpenChange(false)} aria-label="✕"
            style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, border: "none", background: "#F5F4F0", color: "var(--sub,#6b7088)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={18} />
          </button>
        </div>
        <div className="flex h-[60vh] flex-col gap-2" style={{ padding: "10px 14px 14px" }}>
          <div className="flex-1 overflow-y-auto rounded-[14px] p-2" style={{ background: "#F5F4F0" }}>
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : messages.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t("chatThread.emptyState")}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {!showArchived && messages.length > 0 && (
                  <li className="flex justify-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[14px] text-muted-foreground"
                      onClick={() => setShowArchived(true)}
                    >
                      {t("chatThread.showFullHistory")}
                    </Button>
                  </li>
                )}
                {messages.map((m) => {
                  const mine = m.sender_id === myId;
                  return (
                    <li
                      key={m.id}
                      className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
                    >
                      <div
                        className={
                          mine
                            ? "max-w-[80%] rounded-[14px] rounded-br-[4px] px-3 py-2 text-[14px] text-white shadow-sm"
                            : "max-w-[80%] rounded-[14px] rounded-bl-[4px] bg-white px-3 py-2 text-[14px] text-[#0f0f1a] shadow-sm"
                        }
                        style={mine ? { background: "linear-gradient(135deg,#2BBFAA,#25a896)" } : undefined}
                      >
                        <div className="whitespace-pre-wrap break-words">{m.body}</div>
                        <div
                          className={`mt-0.5 text-[14px] ${
                            mine ? "text-white/70" : "text-[#9398b0]"
                          }`}
                        >
                          {new Date(m.created_at).toLocaleTimeString(getLocale(), {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>
                      <MessageReactions
                        reactions={reactions[m.id] ?? []}
                        myId={myId}
                        onToggle={(emoji) => toggleReaction(m.id, emoji)}
                        mine={mine}
                      />
                    </li>
                  );
                })}
                <div ref={endRef} />
              </ul>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              className="h-12 rounded-[13px] text-[15px]"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={t("chatThread.placeholder")}
              disabled={!threadId || sending}
            />
            <Button onClick={send} disabled={!draft.trim() || !threadId || sending}
              className="h-12 w-12 rounded-[13px] p-0 shadow-[0_6px_16px_-6px_rgba(43,191,170,.7)]">
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
