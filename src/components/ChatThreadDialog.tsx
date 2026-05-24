import { useEffect, useRef, useState } from "react";
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
import { Loader2, Send, MessageSquare } from "lucide-react";
import { MessageReactions } from "@/components/MessageReactions";
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
      setMessages((msgs ?? []) as Message[]);
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
      .channel(`chat-dlg-${threadId}-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `thread_id=eq.${threadId}` },
        (payload) => {
          const m = payload.new as Message;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            Чат{counterpartName ? ` · ${counterpartName}` : ""}
          </DialogTitle>
        </DialogHeader>
        <div className="flex h-[55vh] flex-col gap-2">
          <div className="flex-1 overflow-y-auto rounded-md border border-border bg-background/40 p-2">
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : messages.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Поки що повідомлень немає. Напишіть перше 👇
              </p>
            ) : (
              <ul className="space-y-1.5">
                {!showArchived && messages.length > 0 && (
                  <li className="flex justify-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs text-muted-foreground"
                      onClick={() => setShowArchived(true)}
                    >
                      Показати всю історію
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
                            ? "max-w-[80%] rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                            : "max-w-[80%] rounded-lg bg-muted px-3 py-1.5 text-sm text-foreground"
                        }
                      >
                        <div className="whitespace-pre-wrap break-words">{m.body}</div>
                        <div
                          className={`mt-0.5 text-[10px] ${
                            mine ? "text-primary-foreground/70" : "text-muted-foreground"
                          }`}
                        >
                          {new Date(m.created_at).toLocaleTimeString("uk-UA", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>
                    </li>
                  );
                })}
                <div ref={endRef} />
              </ul>
            )}
          </div>
          <div className="flex gap-2">
            <Input
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
            <Button onClick={send} disabled={!draft.trim() || !threadId || sending}>
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
