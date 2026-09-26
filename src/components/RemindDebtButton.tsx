import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Bell, Check, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getLocale } from "@/lib/locale";
import { useHaptic } from "@/hooks/useHaptic";
import { REMIND_DELAY_MS, cancelRemind, isRemindPending, remindKey, scheduleRemind } from "@/lib/remindPair";

/**
 * 🔔 Нагадати — ОДНА дія на КОЖНІЙ поверхні, де видно борг (важіль 2 аудиту
 * шляхів 24.09). Досі вона жила лише у «Фінансах → Борги», по одному уроку:
 * борг видно на дашборді, в «Моїх учнях», у «Людях» і в чаті, а нагадати
 * можна було лише звідти — три екрани на дію, яку обіцяє лендінг.
 *
 * Канон: цей компонент — ЄДИНЕ місце в застосунку, звідки йде нагадування на
 * ЛЮДИНУ. Другої копії бути не може (стереже remind-everywhere.test).
 *  · одне повідомлення про ВЕСЬ борг пари (edge `remind-payment`, режим пари);
 *  · 5 секунд на «Скасувати» ДО відправки — надіслане не відкликається;
 *  · після відправки — підпис «нагадано сьогодні о 14:20», щоб не питати себе,
 *    чи вже нагадувала.
 */
export function RemindDebtButton({
  studentId,
  tutorId,
  studentName,
  lastRemindedAt,
  onSent,
  full,
}: {
  studentId: string;
  /** Чужий репетитор — лише для менеджера школи; порожньо = я сам. */
  tutorId?: string | null;
  studentName?: string;
  /** ISO останнього ручного нагадування (useLastReminders). */
  lastRemindedAt?: string | null;
  onSent?: () => void;
  /** Розтягнути на всю ширину (у смузі боргу), інакше — компактний чип. */
  full?: boolean;
}) {
  const { t } = useTranslation();
  const haptic = useHaptic();
  const key = remindKey(studentId, tutorId);
  const [queued, setQueued] = useState(isRemindPending(key));
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setQueued(false);
    setBusy(true);
    let data: any = null;
    let error: unknown = null;
    try {
      const res = await supabase.functions.invoke("remind-payment", {
        body: tutorId ? { studentId, tutorId } : { studentId },
      });
      data = res.data; error = res.error;
    } catch (e) {
      error = e;
    } finally {
      setBusy(false);
    }
    if (error) { toast.error(t("remind.failed")); return; }
    if (data?.success) {
      // Канали називаємо своїми іменами: «email + email» (15.09) більше не буває.
      const channels = [...new Set((data.channels ?? []) as string[])].filter((c) => c !== "inapp");
      const labelOf = (c: string) => (c === "telegram" ? "Telegram" : c === "email" ? "email" : t("remind.channelInApp"));
      haptic.success();
      if (channels.length === 0) toast.success(t("remind.sentInAppOnly"), { description: studentName });
      else toast.success(t("remind.sent", { labels: channels.map(labelOf).join(" + ") }), { description: studentName });
      onSent?.();
      return;
    }
    if (data?.reason === "no_debt") { toast.info(t("remind.noDebt"), { description: studentName }); onSent?.(); return; }
    if (data?.reason === "no_channels") { toast.error(t("remind.noContact"), { description: studentName }); return; }
    if (data?.reason === "already_reminded_today") {
      const at = data?.lastSentAt ? new Date(String(data.lastSentAt)) : null;
      const when = at && !Number.isNaN(at.getTime())
        ? at.toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit" })
        : "";
      toast.info(t("remind.alreadyReminded", { when }), { description: studentName });
      onSent?.();
      return;
    }
    toast.error(t("remind.failed"));
  };

  const start = () => {
    haptic.tap();
    setQueued(true);
    scheduleRemind(key, send);
    toast(t("remind.queued", { seconds: Math.round(REMIND_DELAY_MS / 1000) }), {
      description: studentName,
      duration: REMIND_DELAY_MS,
      action: {
        label: t("common.cancel"),
        onClick: () => { if (cancelRemind(key)) { setQueued(false); toast.info(t("remind.cancelled")); } },
      },
    });
  };

  const when = lastRemindedAt ? new Date(lastRemindedAt) : null;
  const valid = when && !Number.isNaN(when.getTime());
  const today = valid && when!.toDateString() === new Date().toDateString();
  const label = queued
    ? t("remind.queuedShort")
    : valid
      ? today
        ? t("remind.doneToday", { when: when!.toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit" }) })
        : t("remind.doneOn", { when: when!.toLocaleDateString(getLocale(), { day: "numeric", month: "short" }) })
      : t("remind.action");

  return (
    <button
      type="button"
      onClick={start}
      disabled={busy}
      aria-label={t("remind.action")}
      style={{
        height: 44, padding: "0 16px", borderRadius: 12, cursor: busy ? "wait" : "pointer",
        border: "1px solid rgba(245,158,11,.4)",
        background: valid && !queued ? "var(--ds-surface,#fff)" : "rgba(245,158,11,.2)",
        color: "var(--warning-text,#B45309)",
        fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15,
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
        flexShrink: 0, ...(full ? { flexGrow: 1, minWidth: 160 } : {}),
      }}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : valid && !queued ? <Check className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
      {label}
    </button>
  );
}
