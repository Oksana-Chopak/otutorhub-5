// D (повний офлайн): чернетки форм. Наполовину написаний конспект, домашка чи
// повідомлення в чаті більше не зникають при краші/перезавантаженні/убитому
// WebView — текст живе в localStorage (TTL 24 год) і відновлюється при
// відкритті. Чернетка чиститься після успішного збереження в БД.
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import i18n from "@/i18n";

const PREFIX = "otutorhub.draft.";
const TTL_MS = 24 * 60 * 60 * 1000;

type Stored = { v: string; ts: number };

function readDraft(storageKey: string): string | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (!parsed || typeof parsed.v !== "string") return null;
    if (Date.now() - (parsed.ts ?? 0) > TTL_MS) {
      localStorage.removeItem(storageKey);
      return null;
    }
    return parsed.v;
  } catch {
    return null;
  }
}

let lastRestoreToastAt = 0;
function toastRestoredOnce() {
  const now = Date.now();
  if (now - lastRestoreToastAt < 4000) return; // одна плашка на екран, не на поле
  lastRestoreToastAt = now;
  toast.info(i18n.t("offline.draftRestored"));
}

/**
 * @param key   стабільний ключ чернетки (наприклад `lesson.<id>.summary`);
 *              null — чернетка вимкнена (немає ідентифікатора).
 * @param value поточне значення поля.
 * @param apply сеттер поля — викликається ОДИН раз при відновленні.
 * @returns clear() — викликати після успішного збереження в БД.
 */
export function useLocalDraft(
  key: string | null,
  value: string,
  apply: (v: string) => void,
): { clear: () => void } {
  const storageKey = key ? PREFIX + key : null;
  const restoredFor = useRef<string | null>(null);

  // Відновлення — один раз на ключ.
  useEffect(() => {
    if (!storageKey || restoredFor.current === storageKey) return;
    restoredFor.current = storageKey;
    const saved = readDraft(storageKey);
    if (saved !== null && saved.trim() && saved !== value) {
      apply(saved);
      toastRestoredOnce();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- лише при зміні ключа
  }, [storageKey]);

  // Автозбереження з дебаунсом.
  useEffect(() => {
    if (!storageKey || restoredFor.current !== storageKey) return;
    const t = setTimeout(() => {
      try {
        if (value && value.trim()) {
          localStorage.setItem(storageKey, JSON.stringify({ v: value, ts: Date.now() } satisfies Stored));
        } else {
          localStorage.removeItem(storageKey);
        }
      } catch {
        /* сховище недоступне — чернетки просто не буде */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [storageKey, value]);

  const clear = useCallback(() => {
    if (!storageKey) return;
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  return { clear };
}
