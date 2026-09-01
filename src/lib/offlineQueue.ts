// D (повний офлайн): черга мутацій. У метро запис не втрачається і не бреше —
// він стає в чергу, UI чесно каже «збережу, щойно з'явиться мережа», а при
// відновленні зв'язку черга реплеїться у ТОМУ Ж порядку. У чергу йдуть лише
// АБСОЛЮТНІ записи (статус/текст/патч із конкретними значеннями) — їх повтор
// безпечний. Адитивні гроші (поповнення гаманця) в чергу НЕ ставляться ніколи:
// повтор поповнення = подвійне зарахування.
import { supabase } from "@/integrations/supabase/client";
import { bumpDataVersion } from "@/lib/dataBus";
import { toast } from "sonner";
import i18n from "@/i18n";

export type OfflineQueueItem =
  | { id: string; ts: number; kind: "lesson_details"; lessonId: string; patch: Record<string, unknown> }
  | { id: string; ts: number; kind: "lesson_update"; lessonId: string; patch: Record<string, unknown> }
  | { id: string; ts: number; kind: "lesson_status"; lessonId: string; status: string }
  | { id: string; ts: number; kind: "chat_message"; threadId: string; senderId: string; body: string };

type DistributeOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;
export type OfflineQueueItemInput = DistributeOmit<OfflineQueueItem, "id" | "ts">;

const KEY = "otutorhub.offlineQueue.v1";
const listeners = new Set<(n: number) => void>();
let flushing = false;
let lastQueuedToastAt = 0;

function read(): OfflineQueueItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as OfflineQueueItem[]) : [];
  } catch {
    return [];
  }
}
function write(items: OfflineQueueItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* сховище недоступне — черга деградує до no-op, застосунок живе далі */
  }
  listeners.forEach((l) => l(items.length));
}

export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}
export function pendingCount(): number {
  return read().length;
}
export function subscribePending(cb: (n: number) => void): () => void {
  listeners.add(cb);
  cb(read().length);
  return () => listeners.delete(cb);
}

/** Один тост на серію enqueue (не спамити на кожну галочку). */
function toastQueued() {
  const now = Date.now();
  if (now - lastQueuedToastAt < 5000) return;
  lastQueuedToastAt = now;
  toast.info(i18n.t("offline.queuedToast", { count: read().length }));
}

export function enqueue(item: OfflineQueueItemInput) {
  const items = read();
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  items.push({ ...(item as OfflineQueueItem), id, ts: Date.now() });
  write(items);
  toastQueued();
}

/** Постійна помилка (RLS/валідація) — реплей не допоможе; мережева — тимчасова. */
function isPermanentError(error: { message?: string } | null): boolean {
  const m = (error?.message ?? "").toLowerCase();
  const transient =
    m.includes("fetch") || m.includes("network") || m.includes("timeout") ||
    m.includes("abort") || m.includes("load failed") || m.includes("connection");
  return !transient;
}

async function runItem(item: OfflineQueueItem): Promise<{ ok: boolean; permanent: boolean; message?: string }> {
  let error: { message: string } | null = null;
  switch (item.kind) {
    case "lesson_details": {
      const res = await supabase.rpc("update_lesson_details_safe", {
        _lesson_id: item.lessonId,
        _patch: item.patch,
      } as never);
      error = res.error;
      break;
    }
    case "lesson_update": {
      const res = await supabase.from("lessons").update(item.patch as never).eq("id", item.lessonId);
      error = res.error;
      break;
    }
    case "lesson_status": {
      // Розтяжка №10 (єдиний писар статусів): реплей іде через lessonActions.
      // Динамічний імпорт — щоб не створювати статичний цикл (lessonActions
      // імпортує чергу). Онлайн-гілка setLessonStatus пише напряму, тож
      // рекурсивного enqueue тут бути не може (flush працює лише онлайн).
      const { setLessonStatus } = await import("@/lib/lessonActions");
      const res = await setLessonStatus(item.lessonId, item.status as never);
      error = res.error;
      break;
    }
    case "chat_message": {
      const res = await supabase
        .from("chat_messages")
        .insert({ thread_id: item.threadId, sender_id: item.senderId, body: item.body } as never);
      error = res.error;
      break;
    }
  }
  if (!error) return { ok: true, permanent: false };
  return { ok: false, permanent: isPermanentError(error), message: error.message };
}

export async function flushOfflineQueue(): Promise<void> {
  if (flushing || isOffline()) return;
  if (read().length === 0) return;
  flushing = true;
  let done = 0;
  let dropped = 0;
  try {
    // FIFO: порядок записів зберігається (створення → статус → оплата).
    for (;;) {
      const items = read();
      const item = items[0];
      if (!item) break;
      const res = await runItem(item);
      if (res.ok) {
        done += 1;
        write(read().filter((i) => i.id !== item.id));
        continue;
      }
      if (res.permanent) {
        dropped += 1;
        console.warn("[offline-queue] запис відхилено сервером, прибираю з черги", item, res.message);
        write(read().filter((i) => i.id !== item.id));
        continue;
      }
      break; // мережа ще не жива — решта лишається в черзі
    }
  } finally {
    flushing = false;
  }
  if (done > 0) {
    bumpDataVersion();
    toast.success(i18n.t("offline.synced", { count: done }));
  }
  if (dropped > 0) {
    toast.error(i18n.t("offline.syncDropped", { count: dropped }));
  }
}

let inited = false;
export function initOfflineQueue() {
  if (inited || typeof window === "undefined") return;
  inited = true;
  window.addEventListener("online", () => void flushOfflineQueue());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void flushOfflineQueue();
  });
  // Холодний старт: якщо щось лишилось із минулої сесії — досилаємо.
  setTimeout(() => void flushOfflineQueue(), 2500);
}
