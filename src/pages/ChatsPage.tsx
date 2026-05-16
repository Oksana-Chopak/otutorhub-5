import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { Loader2, MessageSquare, Plus, Send, ShieldCheck, Search, X, Paperclip, FileText, ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { ChatAttachment } from "@/components/ChatAttachment";

interface MessageAttachment {
  id: string;
  message_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
}

const MAX_ATTACH_BYTES = 15 * 1024 * 1024;
const ATTACH_ACCEPT = "application/pdf,image/png,image/jpeg,image/jpg,image/webp,image/gif,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function formatBytes(b: number | null) {
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

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
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortMode, setSortMode] = useState<"recent" | "unread" | "name">("recent");
  const [attachments, setAttachments] = useState<Record<string, MessageAttachment[]>>({});
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showArchived, setShowArchived] = useState<Record<string, boolean>>({});
  
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

    // Defense-in-depth: even though RLS already filters, double-check on the client
    // that non-managers only see threads where they are tutor or student.
    const rawList = (threadRows ?? []) as Thread[];
    const list = isManager
      ? rawList
      : rawList.filter((t) => t.tutor_id === myId || t.student_id === myId);
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
    // Auto-select first thread only on desktop. On mobile we want the
    // user to see the list first (Telegram/WhatsApp pattern).
    const isDesktop =
      typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
    setSelectedId((prev) => prev ?? (isDesktop ? list[0]?.id ?? null : null));
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
      const includeArchived = showArchived[selectedId] === true;
      let query = supabase
        .from("chat_messages")
        .select("id, thread_id, sender_id, body, created_at")
        .eq("thread_id", selectedId);
      if (!includeArchived) query = query.eq("archived", false);
      const { data } = await query.order("created_at", { ascending: true });
      const msgs = (data ?? []) as Message[];
      if (!cancelled) setMessages(msgs);
      // Load attachments for these messages
      if (msgs.length > 0) {
        const { data: attachData } = await supabase
          .from("chat_message_attachments")
          .select("id, message_id, storage_path, file_name, mime_type, size_bytes")
          .in("message_id", msgs.map((m) => m.id));
        if (!cancelled) {
          const grouped: Record<string, MessageAttachment[]> = {};
          (attachData ?? []).forEach((a: any) => {
            if (!grouped[a.message_id]) grouped[a.message_id] = [];
            grouped[a.message_id].push(a);
          });
          setAttachments(grouped);
        }
      } else if (!cancelled) {
        setAttachments({});
      }
      // Mark as read when opening
      markRead(selectedId);
    };

    load();

    const channel = supabase
      .channel(`chat-messages-${selectedId}-${Math.random().toString(36).slice(2, 8)}`)
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
  }, [selectedId, showArchived]);

  // Realtime: refresh thread list metadata when any message arrives so unread badges update
  useEffect(() => {
    if (!myId) return;
    const channel = supabase
      .channel(`threads-meta-${myId}-${Math.random().toString(36).slice(2, 8)}`)
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
    const file = pendingFile;
    if ((!text && !file) || !selectedThread || !myId) return;
    setSending(true);
    const bodyText = text || (file ? `📎 ${file.name}` : "");
    const { data: msgData, error } = await supabase
      .from("chat_messages")
      .insert({ thread_id: selectedThread.id, sender_id: myId, body: bodyText })
      .select("id")
      .single();
    if (error || !msgData) {
      setSending(false);
      toast({ title: "Не вдалося надіслати", description: error?.message, variant: "destructive" });
      return;
    }

    if (file) {
      if (file.size > MAX_ATTACH_BYTES) {
        toast({ title: "Файл завеликий", description: "Максимум 15 МБ", variant: "destructive" });
        setSending(false);
        setPendingFile(null);
        return;
      }
      const safeName = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${myId}/${selectedThread.id}/${crypto.randomUUID()}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from("chat-attachments")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) {
        toast({ title: "Помилка завантаження файлу", description: upErr.message, variant: "destructive" });
      } else {
        const { error: insErr } = await supabase.from("chat_message_attachments").insert({
          message_id: (msgData as any).id,
          thread_id: selectedThread.id,
          uploader_id: myId,
          storage_path: path,
          file_name: file.name,
          mime_type: file.type || null,
          size_bytes: file.size,
        });
        if (insErr) {
          toast({ title: "Не вдалося прикріпити файл", description: insErr.message, variant: "destructive" });
        }
      }
    }
    setSending(false);
    setDraft("");
    setPendingFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const counterpartName = (t: Thread) => {
    if (isManager) return `${fullName(profiles[t.tutor_id])} ↔ ${fullName(profiles[t.student_id])}`;
    const otherId = t.tutor_id === myId ? t.student_id : t.tutor_id;
    return fullName(profiles[otherId]);
  };

  const isUnreadThread = (t: Thread) => {
    const readAt = readMap[t.id];
    return (
      t.last_message_at !== null &&
      (!readAt || new Date(t.last_message_at) > new Date(readAt))
    );
  };

  // Filter + sort thread list
  const visibleThreads = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = threads;
    if (q) {
      list = list.filter((t) => {
        const tutor = fullName(profiles[t.tutor_id]).toLowerCase();
        const student = fullName(profiles[t.student_id]).toLowerCase();
        const preview = (t.last_message_preview ?? "").toLowerCase();
        return tutor.includes(q) || student.includes(q) || preview.includes(q);
      });
    }
    const sorted = [...list];
    if (sortMode === "name") {
      sorted.sort((a, b) => counterpartName(a).localeCompare(counterpartName(b), "uk"));
    } else if (sortMode === "unread") {
      sorted.sort((a, b) => {
        const ua = isUnreadThread(a) ? 1 : 0;
        const ub = isUnreadThread(b) ? 1 : 0;
        if (ua !== ub) return ub - ua;
        const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return tb - ta;
      });
    } else {
      sorted.sort((a, b) => {
        const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return tb - ta;
      });
    }
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, profiles, search, sortMode, readMap, isManager, myId]);

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
      {/* Header — hidden on mobile when a chat is open to maximize chat space */}
      <div
        className={cn(
          "mb-4 flex items-start justify-between gap-3 lg:mb-6 lg:flex",
          selectedId ? "hidden lg:flex" : "flex"
        )}
      >
        <div>
          <h1 className="font-display text-xl font-bold text-foreground lg:text-2xl">Чати</h1>
          <p className="text-xs text-muted-foreground lg:text-sm">
            {isManager
              ? "Перегляд і модерація переписок учнів та репетиторів"
              : "Особисте листування з вашими репетиторами та учнями"}
          </p>
        </div>
        {isManager && (
          <Dialog open={newChatOpen} onOpenChange={setNewChatOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNewChatDialog} size="sm" className="gap-2 lg:size-default">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Створити чат</span>
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
                  <>
                    <Select value={selectedPair} onValueChange={setSelectedPair}>
                      <SelectTrigger>
                        <SelectValue placeholder="Виберіть репетитора та учня" />
                      </SelectTrigger>
                      <SelectContent>
                        {availablePairs.map((p) => {
                          const key = `${p.tutor_id}|${p.student_id}`;
                          const exists = threads.some(
                            (t) => t.tutor_id === p.tutor_id && t.student_id === p.student_id
                          );
                          return (
                            <SelectItem key={key} value={key}>
                              {fullName(profiles[p.tutor_id])} ↔ {fullName(profiles[p.student_id])}
                              {exists ? "  · чат уже існує" : ""}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    {selectedPair && (() => {
                      const [tId, sId] = selectedPair.split("|");
                      const existing = threads.find((t) => t.tutor_id === tId && t.student_id === sId);
                      if (!existing) return null;
                      return (
                        <p className="text-xs text-warning">
                          Чат для цієї пари вже існує — кнопка просто відкриє його.
                        </p>
                      );
                    })()}
                  </>
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
        <div className="grid min-w-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* Thread list — hidden on mobile when a chat is selected */}
          <div
            className={cn(
              "flex min-w-0 flex-col rounded-xl border border-border bg-card lg:max-h-[70vh]",
              "h-[calc(100vh-12rem)] lg:h-auto",
              selectedId ? "hidden lg:flex" : "flex"
            )}
          >
            <div className="space-y-2 border-b border-border p-3">
              <div className="flex items-center gap-2">
                {searchOpen ? (
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      autoFocus
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Пошук…"
                      className="h-8 pl-8 pr-8 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => { setSearch(""); setSearchOpen(false); }}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                      aria-label="Закрити пошук"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => setSearchOpen(true)}
                    aria-label="Пошук"
                  >
                    <Search className="h-4 w-4" />
                  </Button>
                )}
                <Select value={sortMode} onValueChange={(v) => setSortMode(v as "recent" | "unread" | "name")}>
                  <SelectTrigger className="h-8 flex-1 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recent">За останнім повідомленням</SelectItem>
                    <SelectItem value="unread">Спершу непрочитані</SelectItem>
                    <SelectItem value="name">За іменем</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {visibleThreads.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                  {search ? "Нічого не знайдено" : "Немає чатів"}
                </p>
              ) : (
                visibleThreads.map((t) => {
                  const isUnread = t.id !== selectedId && isUnreadThread(t);
                  return (
                    <button
                      key={t.id}
                      onClick={() => setSelectedId(t.id)}
                      className={cn(
                        "w-full rounded-lg p-3 text-left transition-colors",
                        selectedId === t.id ? "bg-primary/10" : "hover:bg-secondary"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p
                          className={cn(
                            "truncate text-sm text-foreground",
                            isUnread ? "font-bold" : "font-medium"
                          )}
                        >
                          {counterpartName(t)}
                        </p>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">
                            {timeShort(t.last_message_at)}
                          </span>
                          {isUnread && (
                            <span
                              className="h-2 w-2 rounded-full bg-primary"
                              aria-label="Непрочитане"
                            />
                          )}
                        </div>
                      </div>
                      <p
                        className={cn(
                          "mt-1 truncate text-xs",
                          isUnread ? "text-foreground" : "text-muted-foreground"
                        )}
                      >
                        {t.last_message_preview ?? "Немає повідомлень"}
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Detail */}
          <div
            className={cn(
              "flex min-w-0 flex-col rounded-xl border border-border bg-card",
              "h-[calc(100vh-8rem)] lg:h-auto",
              !selectedThread && "hidden lg:flex"
            )}
          >
            {selectedThread ? (
              <>
                <div className="flex items-center gap-2 border-b border-border px-3 py-3 lg:px-5 lg:py-4">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 lg:hidden"
                    onClick={() => setSelectedId(null)}
                    aria-label="Назад до списку"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                  <div className="min-w-0 flex-1">
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
                      <span className="hidden sm:inline">Менеджер</span>
                    </Badge>
                  )}
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto p-3 lg:max-h-[55vh] lg:min-h-[300px] lg:p-5">
                  {selectedThread && !showArchived[selectedThread.id] && messages.length > 0 && (
                    <div className="flex justify-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground"
                        onClick={() =>
                          setShowArchived((prev) => ({ ...prev, [selectedThread.id]: true }))
                        }
                      >
                        Показати всю історію
                      </Button>
                    </div>
                  )}
                  {messages.length === 0 ? (
                    <p className="text-center text-xs text-muted-foreground">Немає повідомлень. Напишіть перше!</p>
                  ) : (
                    messages.map((m) => {
                      const mine = m.sender_id === myId;
                      const senderIsManager = managerIds.has(m.sender_id);
                      const msgAttachments = attachments[m.id] ?? [];
                      return (
                        <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                          <div
                            className={cn(
                              "max-w-[85%] rounded-xl px-3 py-2 lg:max-w-[70%] lg:px-4 lg:py-2.5",
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
                                  Менеджер
                                </span>
                              )}
                            </p>
                            {m.body && <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>}
                            {msgAttachments.length > 0 && (
                              <div className="mt-2 space-y-1.5">
                                {msgAttachments.map((att) => (
                                  <ChatAttachment key={att.id} attachment={att} mine={mine} />
                                ))}
                              </div>
                            )}
                            <p className="mt-1 text-right text-[10px] opacity-50">{timeShort(m.created_at)}</p>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {isManager && (
                  <div className="relative border-t border-border">
                    <div className="flex gap-1.5 overflow-x-auto px-3 pt-2 pb-1 lg:flex-wrap lg:overflow-visible lg:pb-2">
                      {[
                        "Доброго дня! Підтверджуємо урок завтра о вказаному часі.",
                        "Дякуємо за оплату — підтверджуємо отримання.",
                        "Нагадуємо про урок сьогодні. До зустрічі!",
                        "Будь ласка, надішліть скрін оплати для підтвердження.",
                      ].map((tpl) => (
                        <button
                          key={tpl}
                          type="button"
                          onClick={() => setDraft(tpl)}
                          className="shrink-0 whitespace-nowrap rounded-full border border-border bg-secondary/50 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                          title="Вставити шаблон"
                        >
                          {tpl.length > 38 ? tpl.slice(0, 38) + "…" : tpl}
                        </button>
                      ))}
                    </div>
                    {/* Fade-out hint that the row is horizontally scrollable on mobile */}
                    <div
                      aria-hidden
                      className="pointer-events-none absolute right-0 top-0 h-full w-8 bg-gradient-to-l from-card to-transparent lg:hidden"
                    />
                  </div>
                )}
                {pendingFile && (
                  <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs">
                    <Paperclip className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="flex-1 truncate text-foreground">{pendingFile.name}</span>
                    <span className="text-muted-foreground shrink-0">{formatBytes(pendingFile.size)}</span>
                    <button
                      type="button"
                      onClick={() => { setPendingFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                      className="rounded p-1 text-muted-foreground hover:text-destructive"
                      aria-label="Прибрати файл"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    sendMessage();
                  }}
                  className="flex items-end gap-2 border-t border-border p-3"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ATTACH_ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        if (f.size > MAX_ATTACH_BYTES) {
                          toast({ title: "Файл завеликий", description: "Максимум 15 МБ", variant: "destructive" });
                          e.target.value = "";
                          return;
                        }
                        setPendingFile(f);
                      }
                    }}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={sending}
                    title="Прикріпити файл"
                    aria-label="Прикріпити файл"
                    className="shrink-0"
                  >
                    <Paperclip className="h-4 w-4" />
                  </Button>
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (!sending && (draft.trim().length > 0 || pendingFile)) {
                          sendMessage();
                        }
                      }
                    }}
                    placeholder={
                      isManager ? "Написати від імені менеджера…" : "Напишіть повідомлення…"
                    }
                    maxLength={4000}
                    disabled={sending}
                    rows={3}
                    className="min-h-[80px] resize-none flex-1"
                  />
                  <Button type="submit" size="icon" disabled={sending || (draft.trim().length === 0 && !pendingFile)} className="shrink-0">
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
