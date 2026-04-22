import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Eye, Loader2, MessageSquare, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";

interface Thread {
  id: string;
  tutor_id: string;
  student_id: string;
  last_message_at: string | null;
  last_message_preview: string | null;
}

interface Message {
  id: string;
  thread_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

interface ProfileLite {
  id: string;
  first_name: string;
  last_name: string;
}

function fullName(p?: ProfileLite | null) {
  if (!p) return "—";
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Без імені";
}

function timeShort(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("uk-UA", { day: "numeric", month: "short" });
}

export default function ChatsPage() {
  const { user, roles } = useAuth();
  const isManager = roles.includes("manager");
  const myId = user?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileLite>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Load threads + bootstrap (auto-create threads for participants if missing)
  useEffect(() => {
    if (!myId) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);

      // For non-managers: ensure a thread exists for every active pair
      if (!isManager) {
        // Collect counterpart ids from lessons + student_rates where I'm a participant
        const counterpartIds = new Set<string>();

        const [lessonsRes, ratesRes] = await Promise.all([
          supabase
            .from("lessons")
            .select("tutor_id, student_id")
            .or(`tutor_id.eq.${myId},student_id.eq.${myId}`),
          supabase
            .from("student_rates")
            .select("tutor_id, student_id")
            .or(`tutor_id.eq.${myId},student_id.eq.${myId}`),
        ]);

        const collect = (rows: Array<{ tutor_id: string; student_id: string }> | null) => {
          (rows ?? []).forEach((r) => {
            const other = r.tutor_id === myId ? r.student_id : r.tutor_id;
            if (other && other !== myId) counterpartIds.add(`${r.tutor_id}|${r.student_id}`);
          });
        };
        collect(lessonsRes.data as any);
        collect(ratesRes.data as any);

        // Create missing threads via RPC
        for (const pair of counterpartIds) {
          const [tutorId, studentId] = pair.split("|");
          await supabase.rpc("get_or_create_chat_thread", {
            _tutor_id: tutorId,
            _student_id: studentId,
          });
        }
      }

      const { data: threadRows, error } = await supabase
        .from("chat_threads")
        .select("id, tutor_id, student_id, last_message_at, last_message_preview")
        .order("last_message_at", { ascending: false, nullsFirst: false });

      if (error) {
        console.error(error);
        if (!cancelled) setLoading(false);
        return;
      }

      const list = (threadRows ?? []) as Thread[];
      const ids = new Set<string>();
      list.forEach((t) => {
        ids.add(t.tutor_id);
        ids.add(t.student_id);
      });

      let profileMap: Record<string, ProfileLite> = {};
      if (ids.size > 0) {
        const { data: profileRows } = await supabase
          .from("profiles")
          .select("id, first_name, last_name")
          .in("id", Array.from(ids));
        (profileRows ?? []).forEach((p: any) => {
          profileMap[p.id] = p;
        });
      }

      if (cancelled) return;
      setThreads(list);
      setProfiles(profileMap);
      setSelectedId((prev) => prev ?? list[0]?.id ?? null);
      setLoading(false);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [myId, isManager]);

  // Load messages for selected thread + subscribe to realtime
  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    let cancelled = false;

    const load = async () => {
      const { data } = await supabase
        .from("chat_messages")
        .select("id, thread_id, sender_id, body, created_at")
        .eq("thread_id", selectedId)
        .order("created_at", { ascending: true });
      if (!cancelled) setMessages((data ?? []) as Message[]);
    };

    load();

    const channel = supabase
      .channel(`chat-messages-${selectedId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `thread_id=eq.${selectedId}` },
        (payload) => {
          setMessages((prev) => {
            const next = payload.new as Message;
            if (prev.some((m) => m.id === next.id)) return prev;
            return [...prev, next];
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [selectedId]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const selectedThread = useMemo(
    () => threads.find((t) => t.id === selectedId) ?? null,
    [threads, selectedId]
  );

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || !selectedThread || !myId || isManager) return;
    setSending(true);
    const { error } = await supabase
      .from("chat_messages")
      .insert({ thread_id: selectedThread.id, sender_id: myId, body: text });
    setSending(false);
    if (error) {
      toast({ title: "Не вдалося надіслати", description: error.message, variant: "destructive" });
      return;
    }
    setDraft("");
  };

  const counterpartName = (t: Thread) => {
    if (isManager) return `${fullName(profiles[t.tutor_id])} ↔ ${fullName(profiles[t.student_id])}`;
    const otherId = t.tutor_id === myId ? t.student_id : t.tutor_id;
    return fullName(profiles[otherId]);
  };

  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground">Чати</h1>
        <p className="text-sm text-muted-foreground">
          {isManager
            ? "Перегляд переписок учнів та репетиторів"
            : "Особисте листування з вашими репетиторами та учнями"}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : threads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <MessageSquare className="h-5 w-5 text-primary" />
          </div>
          <p className="text-sm font-medium text-foreground">Поки немає чатів</p>
          <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
            {isManager
              ? "Чати зʼявляться, коли учасники почнуть листуватися."
              : "Чати зʼявляться, коли менеджер призначить вам урок або ставку."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          {/* Thread list */}
          <div className="space-y-2 rounded-xl border border-border bg-card p-3 max-h-[70vh] overflow-y-auto">
            {threads.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={cn(
                  "w-full rounded-lg p-3 text-left transition-colors",
                  selectedId === t.id ? "bg-primary/10" : "hover:bg-secondary"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-foreground">{counterpartName(t)}</p>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {timeShort(t.last_message_at)}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {t.last_message_preview ?? "Немає повідомлень"}
                </p>
              </button>
            ))}
          </div>

          {/* Detail */}
          <div className="flex flex-col rounded-xl border border-border bg-card">
            {selectedThread ? (
              <>
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {counterpartName(selectedThread)}
                    </p>
                    {isManager && (
                      <p className="truncate text-xs text-muted-foreground">
                        Репетитор: {fullName(profiles[selectedThread.tutor_id])} · Учень:{" "}
                        {fullName(profiles[selectedThread.student_id])}
                      </p>
                    )}
                  </div>
                  {isManager && (
                    <Badge variant="secondary" className="shrink-0 gap-1">
                      <Eye className="h-3 w-3" />
                      Режим перегляду
                    </Badge>
                  )}
                </div>

                <div className="flex-1 space-y-3 p-5 min-h-[300px] max-h-[55vh] overflow-y-auto">
                  {messages.length === 0 ? (
                    <p className="text-center text-xs text-muted-foreground">Немає повідомлень. Напишіть перше!</p>
                  ) : (
                    messages.map((m) => {
                      const mine = m.sender_id === myId && !isManager;
                      return (
                        <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                          <div
                            className={cn(
                              "max-w-[70%] rounded-xl px-4 py-2.5",
                              mine ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
                            )}
                          >
                            <p className="mb-1 text-xs font-medium opacity-70">
                              {fullName(profiles[m.sender_id])}
                            </p>
                            <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                            <p className="mt-1 text-right text-[10px] opacity-50">{timeShort(m.created_at)}</p>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {isManager ? (
                  <div className="flex items-center gap-2 border-t border-border px-5 py-3 text-muted-foreground">
                    <MessageSquare className="h-4 w-4" />
                    <span className="text-xs">Ви переглядаєте цей чат як менеджер (тільки читання)</span>
                  </div>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      sendMessage();
                    }}
                    className="flex items-center gap-2 border-t border-border p-3"
                  >
                    <Input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Напишіть повідомлення…"
                      maxLength={4000}
                      disabled={sending}
                    />
                    <Button type="submit" size="icon" disabled={sending || draft.trim().length === 0}>
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </form>
                )}
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-10 text-sm text-muted-foreground">
                Виберіть чат
              </div>
            )}
          </div>
        </div>
      )}
    </AppLayout>
  );
}
