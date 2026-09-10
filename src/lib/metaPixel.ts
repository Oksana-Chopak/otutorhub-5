/**
 * Meta Pixel + Conversions API (рішення 10.09).
 *
 * НАВІЩО ДВА КАНАЛИ. Браузерний Pixel ріжуть блокувальники реклами та ITP —
 * до Meta не доїжджає від чверті до третини подій, і алгоритм оптимізує
 * покази наосліп. CAPI шле ту саму подію з сервера. Щоб Meta не порахувала
 * одну конверсію двічі, обидва канали шлють ОДИН `event_id` — це
 * стандартна дедуплікація Meta.
 *
 * НАВІЩО ЦЕ ВЗАГАЛІ. Не «щоб бачити воронку» — воронку показують власні
 * лічильники (`log_landing_event`), без жодних персональних даних. Pixel і
 * CAPI потрібні рівно для одного: щоб реклама вміла шукати схожих на тих,
 * хто дійшов до кінця. Без реклами вони не дають нічого.
 *
 * ЗГОДА. Pixel ставить куки `_fbp`, CAPI шле IP і user-agent — це персональні
 * дані. Тому ОБИДВА канали мовчать, поки людина не натиснула «Прийняти» в
 * банері кук. Той, хто відмовився, у Meta не потрапляє взагалі — і це не
 * дірка в аналітиці, бо власні лічильники рахують його все одно.
 *
 * ВИМКНЕНО, ПОКИ НЕМАЄ КЛЮЧІВ. Без `VITE_META_PIXEL_ID` тут не виконується
 * нічого; без `META_CAPI_TOKEN` мовчить edge-функція. Тобто до того, як
 * власниця вставить свої значення в Lovable, поведінка сайту не змінюється
 * ні на байт.
 */
import { getConsent } from "@/lib/clarity";
import { supabase } from "@/integrations/supabase/client";

const PIXEL_ID = (import.meta.env.VITE_META_PIXEL_ID as string | undefined)?.trim() ?? "";

/** Події, які ми взагалі шлемо. Все інше ігнорується — і тут, і на сервері. */
export type MetaEvent = "PageView" | "Lead" | "CompleteRegistration";

declare global {
  interface Window { fbq?: ((...args: unknown[]) => void) & { q?: unknown[]; callMethod?: unknown }; _fbq?: unknown }
}

let loaded = false;

export function isMetaConfigured(): boolean {
  return PIXEL_ID.length > 0;
}

/** Вантажить fbevents.js — тільки після явної згоди і тільки один раз. */
export function loadMetaPixel(): void {
  if (loaded || !PIXEL_ID) return;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (getConsent() !== "accepted") return;
  loaded = true;

  const w = window as Window;
  const fbq: any = function (...args: unknown[]) {
    if (fbq.callMethod) { (fbq.callMethod as any).apply(fbq, args); return; }
    fbq.q = fbq.q || [];
    fbq.q.push(args);
  };
  fbq.push = fbq; fbq.loaded = true; fbq.version = "2.0"; fbq.queue = [];
  w.fbq = fbq; w._fbq = fbq;

  const t = document.createElement("script");
  t.async = true;
  t.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(t);

  w.fbq?.("init", PIXEL_ID);
}

function readCookie(name: string): string | null {
  try {
    const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return m ? decodeURIComponent(m[1]) : null;
  } catch { return null; }
}

/**
 * Одна подія в обидва канали з одним event_id.
 * Мовчить без ключів і без згоди — жодного запиту нікуди.
 */
export function metaTrack(event: MetaEvent, custom: Record<string, number | string> = {}): void {
  if (!PIXEL_ID || getConsent() !== "accepted") return;
  const eventId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());

  try {
    loadMetaPixel();
    window.fbq?.("track", event, custom, { eventID: eventId });
  } catch { /* браузерний канал не критичний — сервер однаково спрацює */ }

  try {
    void supabase.functions
      .invoke("meta-capi", {
        body: {
          event_name: event,
          event_id: eventId,
          event_source_url: window.location.href,
          custom_data: custom,
          fbp: readCookie("_fbp"),
          fbc: readCookie("_fbc"),
        },
      })
      .then(() => {}, () => {});
  } catch { /* серверний канал теж best-effort */ }
}
