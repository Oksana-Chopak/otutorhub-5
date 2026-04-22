import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Loader2, MessageSquare, Plus, Send, ShieldCheck } from "lucide-react";
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
  const [managerIds, setManagerIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [readMap, setReadMap] = useState<Record<string, string>>({});
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // New chat dialog (manager only)
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [availablePairs, setAvailablePairs] = useState<
    Array<{ tutor_id: string; student_id: string }>
  >([]);
  const [pairsLoading, setPairsLoading] = useState(false);
  const [selectedPair, setSelectedPair] = useState<string>("");
  const [creatingThread, setCreatingThread] = useState(false);

  // Load threads + bootstrap (auto-create threads for participants if missing)
  const loadThreads = async () => {
    if (!myId) return;
    setLoading(true);

    if (!isManager) {
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
      setLoading(false);
      return;
    }

    const list = (threadRows ?? []) as Thread[];
    const ids = new Set<string>();
    list.forEach((t) => {
      ids.add(t.tutor_id);
      ids.add(t.student_id);
    });

    // Also include current user (manager) so own messages render with name
    if (myId) ids.add(myId);

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

    // Load all manager ids so we can mark manager-authored messages
    const { data: managerRoleRows } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "manager");
    const mIds = new Set<string>((managerRoleRows ?? []).map((r: any) => r.user_id));

    // Load my read marks for these threads
    let reads: Record<string, string> = {};
    if (list.length > 0) {
      const { data: readRows } = await supabase
        .from("chat_reads")
        .select("thread_id, last_read_at")
        .eq("user_id", myId)
        .in("thread_id", list.map((t) => t.id));
      (readRows ?? []).forEach((r: any) => {
        reads[r.thread_id] = r.last_read_at;
      });
    }

    setThreads(list);
    setProfiles(profileMap);
    setManagerIds(mIds);
    setReadMap(reads);
    setSelectedId((prev) => prev ?? list[0]?.id ?? null);
    setLoading(false);
  };

  // Mark thread as read (upsert chat_reads)
  const markRead = async (threadId: string) => {
    if (!myId) return;
    const now = new Date().toISOString();
    setReadMap((prev) => ({ ...prev, [threadId]: now }));
    await supabase
      .from("chat_reads")
      .upsert(
        { thread_id: threadId, user_id: myId, last_read_at: now },
        { onConflict: "thread_id,user_id" }
      );
  };

  useEffect(() => {
    if (!myId) return;
    loadThreads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // Mark as read when opening
      markRead(selectedId);
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
          // Auto-mark read while viewing thread
          markRead(selectedId);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Realtime: refresh thread list metadata when any message arrives so unread badges update
  useEffect(() => {
    if (!myId) return;
    const channel = supabase
      .channel("threads-meta")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (payload) => {
          const msg = payload.new as Message;
          setThreads((prev) =>
            prev.map((t) =>
              t.id === msg.thread_id
                ? {
                    ...t,
                    last_message_at: msg.created_at,
                    last_message_preview: msg.body.slice(0, 200),
                  }
                : t
            )
          );
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [myId]);

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
    if (!text || !selectedThread || !myId) return;
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

  // Manager: load all available tutor-student pairs (from lessons + rates)
  const openNewChatDialog = async () => {
    setNewChatOpen(true);
    setSelectedPair("");
    setPairsLoading(true);

    const [lessonsRes, ratesRes] = await Promise.all([
      supabase.from("lessons").select("tutor_id, student_id"),
      supabase.from("student_rates").select("tutor_id, student_id"),
    ]);

    const seen = new Set<string>();
    const pairs: Array<{ tutor_id: string; student_id: string }> = [];
    const addPair = (rows: Array<{ tutor_id: string; student_id: string }> | null) => {
      (rows ?? []).forEach((r) => {
        const key = `${r.tutor_id}|${r.student_id}`;
        if (!seen.has(key) && r.tutor_id && r.student_id) {
          seen.add(key);
          pairs.push({ tutor_id: r.tutor_id, student_id: r.student_id });
        }
      });
    };
    addPair(lessonsRes.data as any);
    addPair(ratesRes.data as any);

    // Ensure profiles for these pairs are loaded
    const ids = new Set<string>();
    pairs.forEach((p) => {
      ids.add(p.tutor_id);
      ids.add(p.student_id);
    });
    const missing = Array.from(ids).filter((id) => !profiles[id]);
    if (missing.length > 0) {
      const { data: profileRows } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", missing);
      const next = { ...profiles };
      (profileRows ?? []).forEach((p: any) => {
        next[p.id] = p;
      });
      setProfiles(next);
    }

    setAvailablePairs(pairs);
    setPairsLoading(false);
  };

  const createManagerThread = async () => {
    if (!selectedPair) return;
    const [tutorId, studentId] = selectedPair.split("|");
    setCreatingThread(true);
    const { data, error } = await supabase.rpc("get_or_create_chat_thread", {
      _tutor_id: tutorId,
      _student_id: studentId,
    });
    setCreatingThread(false);
    if (error) {
      toast({ title: "Не вдалося створити чат", description: error.message, variant: "destructive" });
      return;
    }
    const newId = data as unknown as string;
    setNewChatOpen(false);
    await loadThreads();
    if (newId) setSelectedId(newId);
    toast({ title: "Чат створено" });
  };

  return (
    <AppLayout>
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Чати</h1>
          <p className="text-sm text-muted-foreground">
            {isManager
              ? "Перегляд і модерація переписок учнів та репетиторів"
              : "Особисте листування з вашими репетиторами та учнями"}
          </p>
        </div>
        {isManager && (
          <Dialog open={newChatOpen} onOpenChange={setNewChatOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNewChatDialog} className="gap-2">
                <Plus className="h-4 w-4" />
                Створити чат
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Новий чат</DialogTitle>
                <DialogDescription>
                  Виберіть пару репетитор–учень. Чат стане доступним обом сторонам.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <Label>Пара</Label>
                {pairsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Завантаження пар…
                  </div>
                ) : availablePairs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Немає активних пар (потрібен хоча б один урок або призначена ставка).
                  </p>
                ) : (
                  <Select value={selectedPair} onValueChange={setSelectedPair}>
                    <SelectTrigger>
                      <SelectValue placeholder="Виберіть репетитора та учня" />
                    </SelectTrigger>
                    <SelectContent>
                      {availablePairs.map((p) => {
                        const key = `${p.tutor_id}|${p.student_id}`;
                        return (
                          <SelectItem key={key} value={key}>
                            {fullName(profiles[p.tutor_id])} ↔ {fullName(profiles[p.student_id])}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setNewChatOpen(false)}>
                  Скасувати
                </Button>
                <Button onClick={createManagerThread} disabled={!selectedPair || creatingThread}>
                  {creatingThread ? <Loader2 className="h-4 w-4 animate-spin" /> : "Створити"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
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
              ? "Створіть чат для будь-якої пари репетитор–учень кнопкою «Створити чат»."
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
                      <ShieldCheck className="h-3 w-3" />
                      Менеджер
                    </Badge>
                  )}
                </div>

                <div className="flex-1 space-y-3 p-5 min-h-[300px] max-h-[55vh] overflow-y-auto">
                  {messages.length === 0 ? (
                    <p className="text-center text-xs text-muted-foreground">Немає повідомлень. Напишіть перше!</p>
                  ) : (
                    messages.map((m) => {
                      const mine = m.sender_id === myId;
                      const senderIsManager = managerIds.has(m.sender_id);
                      return (
                        <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                          <div
                            className={cn(
                              "max-w-[70%] rounded-xl px-4 py-2.5",
                              mine
                                ? "bg-primary text-primary-foreground"
                                : senderIsManager
                                ? "bg-accent text-accent-foreground border border-primary/20"
                                : "bg-secondary text-foreground"
                            )}
                          >
                            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium opacity-80">
                              {fullName(profiles[m.sender_id])}
                              {senderIsManager && (
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                    mine
                                      ? "bg-primary-foreground/20 text-primary-foreground"
                                      : "bg-primary/15 text-primary"
                                  )}
                                >
                                  <ShieldCheck className="h-2.5 w-2.5" />
                                  Менеджер школи
                                </span>
                              )}
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
                    placeholder={
                      isManager ? "Написати від імені менеджера школи…" : "Напишіть повідомлення…"
                    }
                    maxLength={4000}
                    disabled={sending}
                  />
                  <Button type="submit" size="icon" disabled={sending || draft.trim().length === 0}>
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </form>
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
