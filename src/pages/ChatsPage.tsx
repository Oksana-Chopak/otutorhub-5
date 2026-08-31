import { useTranslation } from "react-i18next";
import { useIsSuperadmin } from "@/hooks/useIsSuperadmin";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { formatPrice } from "@/lib/currency";
import { getLocale } from "@/lib/locale";
import { PageFAB } from "@/components/PageFAB";
import { ChatsSkeleton } from "@/components/PageSkeletons";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader2, MessageSquare, Plus, Send, ShieldCheck, Search, X, Paperclip, FileText, ArrowLeft, Info, Menu, Wallet, Calendar, Sparkles, SlidersHorizontal } from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { ChatAttachment } from "@/components/ChatAttachment";
import { MessageReactions, type Reaction } from "@/components/MessageReactions";
import { ChatContextPanel } from "@/components/ChatContextPanel";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

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

interface ThreadContext {
  kind: "lesson" | "debt" | "new" | "none";
  text: string;
  amount?: number;
  count?: number;
}

interface Thread {
  id: string;
  tutor_id: string;
  student_id: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  ctx?: ThreadContext;
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
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "–";
}

function timeShort(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(getLocale(), { day: "numeric", month: "short" });
}

export default function ChatsPage() {
  const { isIndependent } = useWorkspaceSettings(); // P8: третя персона порожнього стану
  const { t } = useTranslation();
  const { user, roles } = useAuth();
  const isManager = roles.includes("manager");
  const { isSuperadmin } = useIsSuperadmin(); // модерація: платформна, не рольова
  const myId = user?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileLite>>({});
  const [managerIds, setManagerIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showContextPanel, setShowContextPanel] = useState(false);
  const canShowContext = !roles.includes("student");
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgLimit, setMsgLimit] = useState(50);
  const [hasMoreMsgs, setHasMoreMsgs] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [readMap, setReadMap] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortMode, setSortMode] = useState<"recent" | "unread" | "name">("recent");
  const [attachments, setAttachments] = useState<Record<string, MessageAttachment[]>>({});
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({});
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

      // Fire all thread bootstrap RPCs in parallel — they're independent.
      await Promise.all(
        Array.from(counterpartIds).map((pair) => {
          const [tutorId, studentId] = pair.split("|");
          return supabase.rpc("get_or_create_chat_thread", {
            _tutor_id: tutorId,
            _student_id: studentId,
          });
        })
      );
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

    // 45/48: доступ до ЧУЖИХ переписок більше не належить ролі «менеджер»
    // (власник хабу — платний клієнт, не модератор платформи). Він належить
    // суперадміну, і серверна правда та сама: RLS-політика на is_superadmin().
    // Клієнтський прапор лише вирішує, ЩО показати з того, що RLS уже віддав.
    const rawList = (threadRows ?? []) as Thread[];
    const list = isSuperadmin
      ? rawList
      : rawList.filter((t) => t.tutor_id === myId || t.student_id === myId);
    const ids = new Set<string>();
    list.forEach((t) => {
      ids.add(t.tutor_id);
      ids.add(t.student_id);
    });

    // Also include current user (manager) so own messages render with name
    if (myId) ids.add(myId);

    const profileMap: Record<string, ProfileLite> = {};
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
    const reads: Record<string, string> = {};
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

    // ── Контекст кожного діалогу (борг / наступний урок / новий учень) ──
    // ОДИН запит усіх уроків видимих пар, далі групуємо в памʼяті (швидко навіть
    // для менеджера з десятками чатів). Помилки тихо ігноруємо — список не падає.
    let withCtx: Thread[] = list.map((th) => ({ ...th, ctx: { kind: "new" as const, text: t("chats.ctxNewStudent") } }));
    try {
      const tutorIds = Array.from(new Set(list.map((t) => t.tutor_id)));
      const studentIds = Array.from(new Set(list.map((t) => t.student_id)));
      const { data: rows } = await supabase
        .from("lessons_visible")
        .select("tutor_id, student_id, starts_at, status, student_price, student_payment_status, source")
        .in("tutor_id", tutorIds)
        .in("student_id", studentIds);
      const byPair = new Map<string, Array<{ starts_at: string; status: string | null; student_price: number | null; student_payment_status: string | null; source: string | null }>>();
      (rows ?? []).forEach((l: any) => {
        const key = `${l.tutor_id}|${l.student_id}`;
        if (!byPair.has(key)) byPair.set(key, []);
        byPair.get(key)!.push(l);
      });
      const now = Date.now();
      withCtx = list.map((th): Thread => {
        const lessons = byPair.get(`${th.tutor_id}|${th.student_id}`) ?? [];
        if (lessons.length === 0) return { ...th, ctx: { kind: "new", text: t("chats.ctxNewStudent") } };
        const unpaidAll = lessons.filter((l) => l.student_payment_status === "unpaid" && l.status !== "cancelled");
        // Only the party actually owed sees the debt context/reminder: a MANAGER
        // (hub receivable) or an INDEPENDENT tutor (their own students). A hub tutor
        // must NEVER see what the student owes the hub — exclude hub-source lessons.
        const unpaid = isManager ? unpaidAll : unpaidAll.filter((l) => l.source !== "hub");
        if (unpaid.length > 0) {
          const sum = unpaid.reduce((a, l) => a + (Number(l.student_price) || 0), 0);
          return { ...th, ctx: { kind: "debt", text: t("chats.ctxDebt", { amount: formatPrice(sum, "UAH"), count: unpaid.length }), amount: sum, count: unpaid.length } };
        }
        const next = lessons
          .filter((l) => l.status !== "cancelled" && new Date(l.starts_at).getTime() >= now)
          .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())[0];
        if (next) {
          const d = new Date(next.starts_at);
          const today = new Date(); today.setHours(0, 0, 0, 0);
          const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
          const dd = new Date(d); dd.setHours(0, 0, 0, 0);
          const dayLabel = dd.getTime() === today.getTime() ? t("chats.ctxDayToday")
            : dd.getTime() === tomorrow.getTime() ? t("chats.ctxDayTomorrow")
            : d.toLocaleDateString(getLocale(), { day: "numeric", month: "short" });
          const time = d.toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit" });
          return { ...th, ctx: { kind: "lesson", text: t("chats.ctxLesson", { day: dayLabel, time }) } };
        }
        return { ...th, ctx: { kind: "none", text: "" } };
      });
    } catch {
      // лишаємо дефолтний ctx
    }

    setThreads(withCtx);
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
  }, [myId, isManager, isSuperadmin]);

  // Handle ?with={userId} query param — open or create thread with that user
  useEffect(() => {
    if (!myId || loading) return;
    const params = new URLSearchParams(window.location.search);
    const withId = params.get("with");
    if (!withId || withId === myId) return;

    const openWith = async () => {
      if (isManager) {
        // Manager: pick first existing thread involving this user
        const match = threads.find(
          (t) => t.tutor_id === withId || t.student_id === withId
        );
        if (match) {
          setSelectedId(match.id);
        } else {
          // No thread yet — e.g. a self-signup student from /referrals with no
          // lessons/rates (the «Написати» CTA used to dead-end here). Create a
          // manager support thread: the RPC accepts a manager in either slot,
          // so the manager takes the counterpart slot (mirrors start_manager_chat).
          const { data: otherRoles } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", withId);
          const otherIsTutor = (otherRoles ?? []).some((r: any) => r.role === "tutor");
          const args = otherIsTutor
            ? { _tutor_id: withId, _student_id: myId }
            : { _tutor_id: myId, _student_id: withId };
          const { data: threadId, error } = await supabase.rpc("get_or_create_chat_thread", args);
          if (!error && threadId) {
            await loadThreads();
            setSelectedId(threadId as string);
          } else {
            toast({
              title: t("chats.noThreadTitle"),
              description: t("chats.createViaButton"),
            });
          }
        }
      } else {
        // Determine tutor/student roles for the pair
        const { data: otherRoles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", withId);
        const otherIsTutor = (otherRoles ?? []).some((r: any) => r.role === "tutor");
        const otherIsStudent = (otherRoles ?? []).some((r: any) => r.role === "student");
        const otherIsManager = (otherRoles ?? []).some((r: any) => r.role === "manager");
        const myIsTutor = roles.includes("tutor");
        let tutorId: string | null = null;
        let studentId: string | null = null;
        if (myIsTutor && otherIsStudent) {
          tutorId = myId;
          studentId = withId;
        } else if (!myIsTutor && otherIsTutor) {
          tutorId = withId;
          studentId = myId;
        } else if (myIsTutor && otherIsManager) {
          // Tutor ↔ hub manager support thread (manager occupies the student slot).
          tutorId = myId;
          studentId = withId;
        }
        if (!tutorId || !studentId) {
          // Maybe thread already exists
          const match = threads.find(
            (t) =>
              (t.tutor_id === myId && t.student_id === withId) ||
              (t.student_id === myId && t.tutor_id === withId)
          );
          if (match) setSelectedId(match.id);
          return;
        }
        const { data: threadId } = await supabase.rpc("get_or_create_chat_thread", {
          _tutor_id: tutorId,
          _student_id: studentId,
        });
        if (threadId) {
          await loadThreads();
          setSelectedId(threadId as string);
        }
      }
      // Clean URL
      const url = new URL(window.location.href);
      url.searchParams.delete("with");
      window.history.replaceState({}, "", url.toString());
    };

    openWith();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId, loading, isManager]);

  // Load messages for selected thread + subscribe to realtime
  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    let cancelled = false;

    // Clear immediately so previous thread's messages don't flash while loading
    setMessages([]);
    setAttachments({});
    setReactions({});

    const load = async () => {
      const includeArchived = showArchived[selectedId] === true;
      let query = supabase
        .from("chat_messages")
        .select("id, thread_id, sender_id, body, created_at")
        .eq("thread_id", selectedId);
      if (!includeArchived) query = query.eq("archived", false);
      // Load the most recent `msgLimit` messages (newest-first), then display oldest→newest.
      const { data } = await query.order("created_at", { ascending: false }).limit(msgLimit);
      const rows = (data ?? []) as Message[];
      if (!cancelled) setHasMoreMsgs(rows.length === msgLimit);
      const msgs = rows.slice().reverse();
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
      // Load reactions for these messages
      if (msgs.length > 0) {
        const { data: reactData } = await supabase
          .from("chat_message_reactions")
          .select("message_id, user_id, emoji")
          .in("message_id", msgs.map((m) => m.id));
        if (!cancelled) {
          const grouped: Record<string, Reaction[]> = {};
          (reactData ?? []).forEach((r: any) => {
            if (!grouped[r.message_id]) grouped[r.message_id] = [];
            grouped[r.message_id].push(r);
          });
          setReactions(grouped);
        }
      } else if (!cancelled) {
        setReactions({});
      }
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
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, showArchived, msgLimit]);

  // Reset the message window when switching threads.
  useEffect(() => { setMsgLimit(50); }, [selectedId]);

  // Realtime: refresh thread list metadata when any message arrives so unread badges update
  useEffect(() => {
    if (!myId) return;
    const channel = supabase
      .channel(`threads-meta-${myId}`)
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
      toast({ title: t("chats.sendFailed"), description: error?.message, variant: "destructive" });
      return;
    }

    if (file) {
      if (file.size > MAX_ATTACH_BYTES) {
        toast({ title: t("chats.fileTooLarge"), description: t("chats.maxFileSize"), variant: "destructive" });
        setSending(false);
        setPendingFile(null);
        return;
      }
      const safeName = file.name.replace(/[^\w.-]+/g, "_");
      const path = `${myId}/${selectedThread.id}/${crypto.randomUUID()}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from("chat-attachments")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) {
        toast({ title: t("chats.fileUploadError"), description: upErr.message, variant: "destructive" });
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
          toast({ title: t("chats.attachFailed"), description: insErr.message, variant: "destructive" });
        }
      }
    }
    setSending(false);
    setDraft("");
    setPendingFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
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
      const optimistic: Reaction = { message_id: messageId, user_id: myId, emoji };
      setReactions((prev) => ({ ...prev, [messageId]: [...(prev[messageId] ?? []), optimistic] }));
      await supabase
        .from("chat_message_reactions")
        .insert({ message_id: messageId, user_id: myId, emoji });
    }
  };

  const counterpartName = (thread: Thread) => {
    const tutorFallback = t("shared.tutor");
    const studentFallback = t("shared.student");
    const nameOr = (id: string, fallback: string) => {
      const p = profiles[id];
      if (!p) return fallback;
      const full = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
      return full || fallback;
    };
    if (isManager) {
      return `${nameOr(thread.tutor_id, tutorFallback)} ↔ ${nameOr(thread.student_id, studentFallback)}`;
    }
    const otherId = thread.tutor_id === myId ? thread.student_id : thread.tutor_id;
    const otherFallback = thread.tutor_id === myId ? studentFallback : tutorFallback;
    return nameOr(otherId, otherFallback);
  };

  const isUnreadThread = (t: Thread) => {
    const readAt = readMap[t.id];
    return (
      t.last_message_at !== null &&
      (!readAt || new Date(t.last_message_at) > new Date(readAt))
    );
  };

  // Бейдж непрочитаних: точну кількість per-thread ми не тримаємо в списку,
  // тож показуємо акцентну крапку (як у Telegram, коли число невідоме).
  const unreadDotFor = (_t: Thread): string => "●";

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
      toast({ title: t("chats.createFailed"), description: error.message, variant: "destructive" });
      return;
    }
    const newId = data as unknown as string;
    setNewChatOpen(false);
    await loadThreads();
    if (newId) setSelectedId(newId);
    toast({ title: t("chats.chatCreated") });
  };

  // ── Visual helpers (додано для редизайну, дані не чіпаємо) ────────────────
  const AVATAR_GRADIENTS = [
    "linear-gradient(135deg,#2BBFAA,#1d8f7e)",
    "linear-gradient(135deg,#6366F1,#4f46e5)",
    "linear-gradient(135deg,#F59E0B,#d97706)",
    "linear-gradient(135deg,#EF4444,#dc2626)",
    "linear-gradient(135deg,#EC4899,#db2777)",
    "linear-gradient(135deg,#8B5CF6,#7c3aed)",
    "linear-gradient(135deg,#14B8A6,#0d9488)",
    "linear-gradient(135deg,#F97316,#ea580c)",
  ] as const;

  const avatarGradient = (name: string): string => {
    const c = (name || "?").charCodeAt(0) + ((name || "?").charCodeAt(1) || 0);
    return AVATAR_GRADIENTS[c % AVATAR_GRADIENTS.length];
  };

  const computeInitials = (name: string): string => {
    if (name.includes("↔")) {
      const left = name.split("↔")[0].trim();
      const parts = left.split(" ");
      return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase();
    }
    const parts = name.trim().split(" ");
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  };

  const dateLabel = (iso: string): string => {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return t("chats.dateToday");
    if (d.toDateString() === yesterday.toDateString()) return t("chats.dateYesterday");
    return d.toLocaleDateString(getLocale(), { day: "numeric", month: "long" });
  };

  // Everyone — including pure students — rides the shared AppLayout chrome,
  // which now lives in the AppShell layout-route (A5) — no wrapper here.
  return (
    <>
      {isSuperadmin && (
        <div className="mb-3 rounded-[12px] border border-amber-300 bg-amber-50 px-3 py-2">
          <p className="text-[13px] font-semibold text-amber-900">{t("chats.moderationTitle")}</p>
          <p className="text-[13px] text-amber-900/80">{t("chats.moderationBody")}</p>
        </div>
      )}
      {loading ? (
        <ChatsSkeleton />
      ) : threads.length === 0 && !loading ? (
        <div className="rounded-[16px] border border-dashed border-border bg-card p-10 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <MessageSquare className="h-5 w-5 text-primary" />
          </div>
          <p className="text-sm font-medium text-foreground">{t("chats.noChatsTitle")}</p>
          <p className="mx-auto mt-2 max-w-md text-[14px] text-muted-foreground">
            {isManager ? t("chats.noChatsManager") : isIndependent ? t("chats.noChatsIndependent") : t("chats.noChatsOther")}
          </p>
          {/* Managers can have zero chats and still need to start one — give the
              empty state a forward action instead of dead-ending. */}
          {isManager && (
            <button
              onClick={openNewChatDialog}
              className="mx-auto mt-5 flex items-center gap-1.5 h-11 px-5 rounded-full font-bold text-[14px] transition-opacity active:opacity-80"
              style={{ background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", fontFamily: "Inter, system-ui" }}
            >
              <Plus className="h-4 w-4" />
              {t("chats.startChat")}
            </button>
          )}
        </div>
      ) : (
       <div className="flex min-h-[calc(100dvh-140px)] flex-col">
        <div
          className={cn(
            "flex overflow-hidden rounded-[16px] border-[0.5px] border-border",
            "-mx-4 md:-mx-6",
            // Мобілка: панель рівно під вміст, «прилипає» до низу екрана;
            // переповнення обмежене вьюпортом → скрол усередині.
            "mt-auto max-h-[calc(100dvh-120px)] lg:mt-0 lg:h-[calc(100vh-120px)] lg:max-h-none",
          )}
        >
          {/* ── Col 1: Thread list ──────────────────────────────────────────── */}
          <div
            className={cn(
              "flex flex-col border-r border-border bg-white",
              "w-full lg:w-[280px] lg:flex-shrink-0",
              selectedId ? "hidden lg:flex" : "flex"
            )}
          >
            {/* List header */}
            <div className="px-4 pt-4 pb-3 border-b border-border">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <p className="hidden lg:block font-black text-[20px] leading-tight" style={{ fontFamily: "Inter, system-ui" }}>
                    {t("chats.title")}
                  </p>
                  <p className="hidden lg:block text-[14px] mt-0.5" style={{ color: "var(--sub,#6b7088)" }}>
                    {isManager
                      ? t("chats.activeDialogsCount", { count: threads.length })
                      : t("chats.pageSubtitleOther")}
                  </p>
                </div>
                {/* Desktop two-pane keeps the list-header button (a corner FAB would
                    overlap the desktop composer). Mobile uses the unified bottom-right
                    PageFAB instead — see below. */}
                {isManager && (
                  <button
                    onClick={openNewChatDialog}
                    className="hidden lg:flex items-center gap-1.5 h-11 px-3.5 rounded-full font-bold text-[14px] flex-shrink-0 transition-opacity active:opacity-80"
                    style={{ background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", fontFamily: "Inter, system-ui" }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t("chats.new")}
                  </button>
                )}
              </div>

              {/* Search */}
              <div className="relative">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
                  style={{ color: "var(--sub,#6b7088)" }}
                />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("chats.searchPlaceholder")}
                  className="w-full pl-9 pr-3 h-11 rounded-xl text-[15px] outline-none"
                  style={{ border: "1px solid var(--border,#eceef3)", background: "#fbfbfc" }}
                />
              </div>

              {/* Sort — за акуратним фільтром, як на Розкладі */}
              <div className="mt-2.5 flex justify-end">
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-[14px] font-bold"
                      style={{ background: "#fff", border: "1px solid var(--border,#eceef3)", color: "var(--txt,#0f0f1a)", fontFamily: "Inter, system-ui" }}>
                      <SlidersHorizontal className="h-4 w-4" style={{ color: "var(--sub,#6b7088)" }} />
                      {t("chats.filters")}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-56 p-1.5">
                    {(["recent", "unread", "name"] as const).map((mode) => (
                      <button key={mode} onClick={() => setSortMode(mode)}
                        className="flex w-full items-center justify-between rounded-[8px] px-3 py-2.5 text-left text-[14px] font-semibold"
                        style={sortMode === mode
                          ? { background: "var(--bg,#F5F4F0)", color: "var(--txt,#0f0f1a)" }
                          : { color: "var(--sub,#6b7088)" }}>
                        {mode === "recent" ? t("chats.sortRecent") : mode === "unread" ? t("chats.sortUnread") : t("chats.sortName")}
                        {sortMode === mode && <span style={{ color: "var(--teal,#2BBFAA)" }}>✓</span>}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Thread rows */}
            {/* Блок тредів: висота = рівно вміст, притиснутий до низу (mt-auto);
                при переповненні flex-shrink обмежує висотою панелі → скрол. */}
            <div className="mt-auto min-h-0 overflow-y-auto" style={{ padding: "10px 12px", background: "#F5F4F0", borderRadius: "16px 16px 0 0" }}>
              {visibleThreads.length === 0 ? (
                <div className="px-4 py-8 text-center space-y-2">
                  <p className="text-[14px]" style={{ color: "var(--sub,#6b7088)" }}>
                    {search ? t("chats.noResults") : t("chats.noChats")}
                  </p>
                  {!search && !isManager && (
                    <p className="text-[14px]" style={{ color: "var(--sub,#6b7088)" }}>
                      {t("chats.searchHint")}
                    </p>
                  )}
                  {!search && isManager && (
                    <p className="text-[14px]" style={{ color: "var(--sub,#6b7088)" }}>
                      {t("chats.managerStartHint")}
                    </p>
                  )}
                </div>
              ) : (
                visibleThreads.map((thread) => {
                  const isUnread = isUnreadThread(thread);
                  const tName = counterpartName(thread);
                  return (
                    <button
                      key={thread.id}
                      onClick={() => setSelectedId(thread.id)}
                      className="w-full text-left transition-all active:scale-[0.995]"
                      style={{
                        borderRadius: 18,
                        border: `1px solid ${selectedId === thread.id ? "#2BBFAA" : "#eceef3"}`,
                        background: "#fff",
                        boxShadow: selectedId === thread.id ? "0 4px 16px -6px rgba(43,191,170,.3)" : "0 1px 4px rgba(0,0,0,.04)",
                        padding: 13,
                        marginBottom: 8,
                      }}
                    >
                      <div className="flex items-center gap-3">
                        {/* Avatar */}
                        <div
                          className="flex items-center justify-center text-white font-bold flex-shrink-0 relative"
                          style={{ width: 48, height: 48, borderRadius: Math.round(48 * 0.26), fontSize: 15, background: avatarGradient(tName), fontFamily: "Inter, system-ui" }}
                        >
                          {computeInitials(tName)}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p
                              className="truncate text-[15px]"
                              style={{ fontWeight: isUnread ? 800 : 600, fontFamily: "Inter, system-ui", color: "#0f0f1a" }}
                            >
                              {tName}
                            </p>
                            <span className="text-[14px] flex-shrink-0" style={{ color: "var(--sub,#6b7088)" }}>
                              {timeShort(thread.last_message_at)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-0.5">
                            <p
                              className="text-[14px] truncate"
                              style={{
                                color: isUnread ? "#0f0f1a" : "var(--sub,#6b7088)",
                                fontStyle: thread.last_message_preview?.startsWith("…") ? "italic" : "normal",
                                fontWeight: isUnread ? 600 : 400,
                              }}
                            >
                              {thread.last_message_preview ?? t("chats.noMessagesLabel")}
                            </p>
                            {isUnread && (
                              <span
                                className="flex items-center justify-center flex-shrink-0"
                                style={{ minWidth: 21, height: 21, padding: "0 6px", borderRadius: 999, background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", fontFamily: "Inter, system-ui", fontWeight: 800, fontSize: 14 }}
                              >
                                {unreadDotFor(thread)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Context pill row — tutor/manager working context ONLY. A student
                          must not see «Борг X · Нагадати» (tutor-voiced debt tooling on
                          their own chat) or «Новий учень · Створити урок». */}
                      {canShowContext && thread.ctx && thread.ctx.kind !== "none" && (
                        <div
                          className="flex items-center gap-2 mt-2.5 pt-2.5"
                          style={{ borderTop: "1px solid #f3f4f8" }}
                        >
                          <span
                            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[14px] font-bold"
                            style={{
                              fontFamily: "Inter, system-ui",
                              background: thread.ctx.kind === "debt" ? "rgba(245,158,11,.12)" : thread.ctx.kind === "lesson" ? "rgba(43,191,170,.12)" : "rgba(37,99,235,.1)",
                              color: thread.ctx.kind === "debt" ? "#B4740B" : thread.ctx.kind === "lesson" ? "var(--teal-d,#25a896)" : "#2563eb",
                            }}
                          >
                            {thread.ctx.kind === "debt" ? <Wallet className="h-3 w-3" /> : thread.ctx.kind === "lesson" ? <Calendar className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                            {thread.ctx.text}
                          </span>
                          {thread.ctx.kind === "debt" && (
                            <span className="ml-auto text-[14px] font-bold whitespace-nowrap" style={{ color: "#B4740B", fontFamily: "Inter, system-ui" }}>
                              {t("chats.remindArrow")}
                            </span>
                          )}
                          {thread.ctx.kind === "new" && (
                            <span className="ml-auto text-[14px] font-bold whitespace-nowrap" style={{ color: "#2563eb", fontFamily: "Inter, system-ui" }}>
                              {t("chats.createLessonArrow")}
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* ── Col 2: Conversation ─────────────────────────────────────────── */}
          <div
            className={cn(
              "flex flex-col flex-1 min-w-0",
              !selectedThread && "hidden lg:flex"
            )}
            style={{ background: "#F5F4F0" }}
          >
            {selectedThread ? (
              <>
                {/* Conversation header */}
                <div
                  className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
                  style={{ background: "#fff", borderBottom: "1px solid var(--border,#eceef3)" }}
                >
                  <button
                    className="lg:hidden h-11 w-11 -ml-1.5 rounded-full flex items-center justify-center hover:bg-muted"
                    onClick={() => setSelectedId(null)}
                    aria-label={t("chats.backToList")}
                  >
                    <ArrowLeft className="h-5 w-5" style={{ color: "var(--txt,#0f0f1a)" }} />
                  </button>

                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-[14px] flex-shrink-0"
                    style={{ background: avatarGradient(counterpartName(selectedThread)), fontFamily: "Inter, system-ui" }}
                  >
                    {computeInitials(counterpartName(selectedThread))}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => canShowContext && setShowContextPanel(true)}
                        className={cn("font-bold text-[15px] truncate text-left", canShowContext && "hover:underline")}
                        style={{ fontFamily: "Inter, system-ui", color: "var(--txt,#0f0f1a)", cursor: canShowContext ? "pointer" : "default" }}
                        title={canShowContext ? t("chats.openProfile") : undefined}
                      >
                        {counterpartName(selectedThread)}
                      </button>
                      {isManager && (
                        <span
                          className="inline-flex items-center gap-1 text-[14px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full flex-shrink-0"
                          style={{ background: "rgba(245,158,11,.15)", color: "#b45309", border: "1px solid rgba(245,158,11,.3)" }}
                        >
                          <ShieldCheck className="h-2.5 w-2.5" />
                          {t("chats.centerBadge")}
                        </span>
                      )}
                    </div>
                    {isManager ? (
                      <p className="text-[14px] truncate" style={{ color: "var(--sub,#6b7088)" }}>
                        {t("chats.centerThreadSubtitle", { name: fullName(profiles[selectedThread.tutor_id]) })}
                      </p>
                    ) : (
                      <p className="text-[14px] font-semibold" style={{ color: "hsl(var(--success))" }}>
                        {t("chats.online")}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {canShowContext && (
                      <button
                        className="h-11 w-11 rounded-full flex items-center justify-center hover:bg-muted lg:hidden"
                        onClick={() => setShowContextPanel(true)}
                        aria-label={t("chatContext.openBtn")}
                      >
                        <Info className="h-4 w-4" style={{ color: "var(--sub,#6b7088)" }} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Messages scroll area */}
                <div
                  className="flex-1 overflow-y-auto px-3 py-4 lg:px-5"
                  style={{
                    background: "linear-gradient(160deg,#f8fafa 0%,#f0fdf9 50%,#f8fafa 100%)",
                  }}
                >
                  {selectedThread && !showArchived[selectedThread.id] && messages.length > 0 && (
                    <div className="flex justify-center mb-4">
                      <button
                        className="px-3 py-1 rounded-full text-[14px] transition-colors hover:bg-black/5"
                        style={{ color: "var(--sub,#6b7088)" }}
                        onClick={() =>
                          setShowArchived((prev) => ({ ...prev, [selectedThread.id]: true }))
                        }
                      >
                        {t("chats.showHistory")}
                      </button>
                    </div>
                  )}

                  {hasMoreMsgs && messages.length > 0 && (
                    <div className="flex justify-center py-2">
                      <button
                        type="button"
                        onClick={() => setMsgLimit((l) => l + 50)}
                        className="rounded-full border border-border bg-card px-4 py-1.5 text-[14px] font-medium text-muted-foreground hover:text-foreground"
                      >
                        {t("chats.loadEarlier")}
                      </button>
                    </div>
                  )}
                  {messages.length === 0 ? (
                    <p className="text-center text-[14px] py-8" style={{ color: "var(--sub,#6b7088)" }}>
                      {t("chats.noMessagesYet")}
                    </p>
                  ) : (
                    messages.map((m, idx) => {
                      const mine = m.sender_id === myId;
                      const senderIsManager = managerIds.has(m.sender_id);
                      const msgAttachments = attachments[m.id] ?? [];
                      const prevMsg = idx > 0 ? messages[idx - 1] : null;
                      const showDateSep =
                        !prevMsg ||
                        new Date(m.created_at).toDateString() !==
                          new Date(prevMsg.created_at).toDateString();

                      return (
                        <div key={m.id}>
                          {showDateSep && (
                            <div className="flex justify-center my-4">
                              <span
                                className="px-3 py-1 rounded-full text-[14px] font-semibold"
                                style={{
                                  background: "rgba(15,15,26,.08)",
                                  color: "var(--sub,#6b7088)",
                                  fontFamily: "Inter, system-ui",
                                }}
                              >
                                {dateLabel(m.created_at)}
                              </span>
                            </div>
                          )}

                          <div
                            className={cn(
                              "flex flex-col mb-2",
                              mine ? "items-end" : "items-start"
                            )}
                          >
                            {/* Sender name for manager threads (not mine) */}
                            {!mine && isManager && (
                              <p
                                className="text-[14px] mb-1 px-3 truncate max-w-[75%]"
                                style={{
                                  color: senderIsManager ? "#b45309" : "var(--sub,#6b7088)",
                                  fontFamily: "Inter, system-ui",
                                  fontWeight: 600,
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                              >
                                {fullName(profiles[m.sender_id])}
                              </p>
                            )}

                            <div
                              className={cn("max-w-[75%] px-3.5 py-2.5 lg:max-w-[65%]")}
                              style={{
                                ...(mine
                                  ? {
                                      background: "linear-gradient(135deg,#2BBFAA,#25a896)",
                                      color: "#0f0f1a",
                                      borderRadius: "16px 16px 5px 16px",
                                      boxShadow: "0 6px 18px -8px rgba(43,191,170,.55)",
                                    }
                                  : senderIsManager
                                  ? {
                                      background: "#fff7ed",
                                      border: "1px solid rgba(245,158,11,.35)",
                                      color: "var(--txt,#0f0f1a)",
                                      borderRadius: "16px 16px 16px 5px",
                                    }
                                  : {
                                      background: "#fff",
                                      border: "1px solid var(--border,#eceef3)",
                                      color: "var(--txt,#0f0f1a)",
                                      borderRadius: "16px 16px 16px 5px",
                                    }),
                              }}
                            >
                              {/* ЦЕНТР badge for manager sender */}
                              {!mine && senderIsManager && (
                                <span
                                  className="inline-flex items-center gap-1 text-[14px] font-bold uppercase tracking-wide mb-1.5 px-1.5 py-0.5 rounded-full"
                                  style={{
                                    background: "rgba(245,158,11,.18)",
                                    color: "#b45309",
                                    fontFamily: "Inter, system-ui",
                                  }}
                                >
                                  <ShieldCheck className="h-2.5 w-2.5" />
                                  {t("chats.centerBadge")}
                                </span>
                              )}

                              {m.body && (
                                <p
                                  className="text-[14px] leading-relaxed whitespace-pre-wrap break-words"
                                  style={{ fontFamily: "'Plus Jakarta Sans', system-ui" }}
                                >
                                  {m.body}
                                </p>
                              )}

                              {msgAttachments.length > 0 && (
                                <div className="mt-2 space-y-1.5">
                                  {msgAttachments.map((att) => (
                                    <ChatAttachment key={att.id} attachment={att} mine={mine} />
                                  ))}
                                </div>
                              )}

                              <div className="flex items-center justify-end gap-1 mt-1">
                                <span
                                  className="text-[14px]"
                                  style={{ color: mine ? "rgba(255,255,255,0.6)" : "var(--muted,#b0b4c8)" }}
                                >
                                  {timeShort(m.created_at)}
                                </span>
                                {mine && (
                                  <span
                                    className="text-[14px]"
                                    style={{ color: readMap[selectedThread.id] && new Date(m.created_at) <= new Date(readMap[selectedThread.id]) ? "#bdfaee" : "rgba(255,255,255,0.5)" }}
                                  >
                                    {readMap[selectedThread.id] && new Date(m.created_at) <= new Date(readMap[selectedThread.id])
                                      ? "✓✓"
                                      : "✓"}
                                  </span>
                                )}
                              </div>
                            </div>

                            <MessageReactions
                              reactions={reactions[m.id] ?? []}
                              myId={myId}
                              onToggle={(emoji) => toggleReaction(m.id, emoji)}
                              mine={mine}
                            />
                          </div>
                        </div>
                      );
                    })
                  )}

                  {/* Smart card — контекстна дія під останнім повідомленням (tutor/manager
                      only: the debt card pre-fills a tutor-voiced payment reminder). */}
                  {canShowContext && selectedThread?.ctx && (selectedThread.ctx.kind === "debt" || selectedThread.ctx.kind === "new") && messages.length > 0 && (
                    <div
                      className="flex items-center gap-3 mt-2"
                      style={{
                        borderRadius: 16,
                        padding: 13,
                        background: selectedThread.ctx.kind === "debt" ? "rgba(245,158,11,.1)" : "rgba(37,99,235,.08)",
                        border: selectedThread.ctx.kind === "debt" ? "1px solid rgba(245,158,11,.32)" : "1px solid rgba(37,99,235,.28)",
                      }}
                    >
                      <div
                        className="flex items-center justify-center flex-shrink-0"
                        style={{
                          width: 38, height: 38, borderRadius: 11,
                          background: selectedThread.ctx.kind === "debt" ? "rgba(245,158,11,.2)" : "rgba(37,99,235,.15)",
                          color: selectedThread.ctx.kind === "debt" ? "#B4740B" : "#2563eb",
                        }}
                      >
                        {selectedThread.ctx.kind === "debt" ? <Wallet className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-bold truncate" style={{ fontFamily: "Inter, system-ui", color: "#0f0f1a" }}>
                          {selectedThread.ctx.kind === "debt"
                            ? t("chats.smartUnpaidTitle", { amount: formatPrice(selectedThread.ctx.amount ?? 0, "UAH")})
                            : t("chats.smartCreateFirstLesson")}
                        </p>
                        <p className="text-[14px] truncate" style={{ color: "var(--sub,#6b7088)" }}>
                          {selectedThread.ctx.kind === "debt"
                            ? t("chats.smartLessonsAwaitingPayment", { count: selectedThread.ctx.count ?? 0 })
                            : t("chats.smartNoLessonsYet", { name: counterpartName(selectedThread) })}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedThread.ctx?.kind === "debt") {
                            setDraft((d) => d || t("chats.debtReminderDraft"));
                          } else {
                            // Open the create-lesson dialog with this student preselected,
                            // instead of dumping the user on a blank Schedule page.
                            const sid = selectedThread.student_id;
                            window.location.href = sid
                              ? `/schedule?create=1&student=${sid}`
                              : "/schedule?create=1";
                          }
                        }}
                        className="flex-shrink-0 rounded-[10px] px-3.5 h-[34px] text-[14px] font-bold text-white"
                        style={{
                          fontFamily: "Inter, system-ui",
                          background: selectedThread.ctx.kind === "debt"
                            ? "linear-gradient(135deg,#f59e0b,#d97706)"
                            : "linear-gradient(135deg,#2BBFAA,#25a896)",
                          boxShadow: selectedThread.ctx.kind === "debt"
                            ? "0 6px 16px -8px rgba(245,158,11,.6)"
                            : "0 6px 16px -8px rgba(43,191,170,.6)",
                        }}
                      >
                        {selectedThread.ctx.kind === "debt" ? t("chats.remindBtn") : t("chats.createBtn2")}
                      </button>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* Pending file preview */}
                {pendingFile && (
                  <div
                    className="flex items-center gap-2 px-3 py-2 text-[14px] flex-shrink-0"
                    style={{ borderTop: "1px solid var(--border,#eceef3)", background: "#fff" }}
                  >
                    <Paperclip className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "#2BBFAA" }} />
                    <span className="flex-1 truncate" style={{ color: "var(--txt,#0f0f1a)" }}>{pendingFile.name}</span>
                    <span style={{ color: "var(--sub,#6b7088)" }}>{formatBytes(pendingFile.size)}</span>
                    <button
                      type="button"
                      onClick={() => { setPendingFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                      className="rounded p-1 hover:text-destructive"
                      style={{ color: "var(--sub,#6b7088)" }}
                      aria-label={t("chats.removeFile")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                {/* Composer */}
                <form
                  onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
                  className="flex items-center gap-2 px-3 py-3 flex-shrink-0"
                  style={{ background: "#fff", borderTop: "1px solid var(--border,#eceef3)" }}
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
                          toast({ title: t("chats.fileTooLarge"), description: t("chats.maxFileSize"), variant: "destructive" });
                          e.target.value = "";
                          return;
                        }
                        setPendingFile(f);
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={sending}
                    title={t("chats.attach")}
                    aria-label={t("chats.attach")}
                    className="w-11 h-11 rounded-full flex items-center justify-center transition-colors hover:bg-muted flex-shrink-0"
                    style={{ color: "var(--sub,#6b7088)" }}
                  >
                    <Paperclip className="h-4 w-4" />
                  </button>

                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (!sending && (draft.trim().length > 0 || pendingFile)) sendMessage();
                      }
                    }}
                    placeholder={
                      isManager
                        ? t("chats.placeholderManager")
                        : t("chats.composerPlaceholder")
                    }
                    maxLength={4000}
                    disabled={sending}
                    rows={1}
                    className="flex-1 rounded-full border px-4 py-2.5 text-[15px] resize-none"
                    style={{
                      background: "#fbfbfc",
                      borderColor: "var(--border,#eceef3)",
                      color: "var(--txt,#0f0f1a)",
                      caretColor: "var(--teal,#2BBFAA)",
                      minHeight: 44,
                      maxHeight: 120,
                      fontFamily: "'Plus Jakarta Sans', system-ui",
                      outline: "none",
                      boxShadow: "none",
                    }}
                  />

                  <button
                    type="submit"
                    disabled={sending || (draft.trim().length === 0 && !pendingFile)}
                    aria-label={t("chats.send")}
                    className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity disabled:opacity-40"
                    style={{ background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", boxShadow: "0 4px 14px -4px rgba(43,191,170,0.6)" }}
                  >
                    {sending
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Send className="h-4 w-4" />}
                  </button>
                </form>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-[14px]" style={{ color: "var(--sub,#6b7088)" }}>
                {t("chats.selectChat")}
              </div>
            )}
          </div>

          {/* ── Col 3: Context panel (desktop only, always visible) ─────────── */}
          {canShowContext && (
            <div
              className="hidden lg:flex flex-col border-l border-border overflow-y-auto flex-shrink-0"
              style={{ width: 260, background: "#fff" }}
            >
              {selectedThread ? (
                <>
                  <ChatContextPanel
                    tutorId={selectedThread.tutor_id}
                    studentId={selectedThread.student_id}
                    viewerIsManager={isManager}
                    viewerId={myId}
                    onClose={() => {}}
                    className="flex-1 overflow-y-auto border-none"
                  />
                </>
              ) : (
                <div
                  className="flex flex-1 flex-col items-center justify-center p-6 text-center text-[14px]"
                  style={{ color: "var(--sub,#6b7088)" }}
                >
                  <MessageSquare className="h-8 w-8 mb-3 opacity-30" />
                  <p>{t("chats.selectChatForContextLine1")}<br />{t("chats.selectChatForContextLine2")}</p>
                </div>
              )}
            </div>
          )}
        </div>
       </div>
      )}

      {/* Mobile context sheet */}
      {canShowContext && (
        <Sheet open={showContextPanel} onOpenChange={setShowContextPanel}>
          <SheetContent side="bottom" className="max-h-[82vh] rounded-t-[20px] overflow-hidden p-0 flex flex-col">
            <div className="flex justify-center pt-2.5 pb-1 flex-shrink-0">
              <div className="w-10 h-1.5 rounded-full" style={{ background: "rgba(15,15,26,.14)" }} />
            </div>
            <SheetHeader className="px-4 pb-2 flex-shrink-0">
              <SheetTitle className="text-left text-[16px]">
                {t("chats.context", "Контекст учня")}
              </SheetTitle>
            </SheetHeader>
            <ChatContextPanel
              tutorId={selectedThread?.tutor_id ?? null}
              studentId={selectedThread?.student_id ?? null}
              viewerIsManager={isManager}
              viewerId={myId}
              onClose={() => setShowContextPanel(false)}
              className="border-none bg-transparent pt-0 flex-1"
            />
          </SheetContent>
        </Sheet>
      )}

      {/* New chat dialog — manager only */}
      <Dialog open={newChatOpen} onOpenChange={setNewChatOpen}>
        <DialogContent className="rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[90vh] overflow-y-auto">
          <div className="mx-auto -mt-1 mb-1 h-1.5 w-10 rounded-full bg-border sm:hidden" />
          <DialogHeader>
            <DialogTitle>{t("chats.newChatTitle")}</DialogTitle>
            <DialogDescription>{t("chats.newChatDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>{t("chats.pairLabel")}</Label>
            {pairsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("chats.loadingPairs")}
              </div>
            ) : availablePairs.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("chats.noPairs")}</p>
            ) : (
              <>
                <Select value={selectedPair} onValueChange={setSelectedPair}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("chats.selectPairPlaceholder")} />
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
                          {exists ? t("chats.chatAlreadyExistsTag") : ""}
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
                    <p className="text-[14px] text-warning">{t("chats.chatExistsWarning")}</p>
                  );
                })()}
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewChatOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={createManagerThread} disabled={!selectedPair || creatingThread}>
              {creatingThread ? <Loader2 className="h-4 w-4 animate-spin" /> : t("chats.createBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unified new-chat action: bottom-right FAB on mobile (manager only), shown on
          the thread-list view so it never overlaps an open conversation's composer. */}
      {isManager && !selectedId && (
        <PageFAB onClick={openNewChatDialog} label={t("chats.startChat")} className="lg:hidden" />
      )}
    </>
  );
}
