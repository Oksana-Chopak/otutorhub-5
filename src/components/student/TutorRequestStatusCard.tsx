import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, MessageCircle, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useHaptic } from "@/hooks/useHaptic";
import { startManagerChat, managerChatPath } from "@/lib/managerChat";
import { notifyManagers } from "@/lib/notifications";

export interface TutorRequestRow {
  id: string;
  status: string;
  created_at: string;
}

interface Props {
  request: TutorRequestRow;
  /** Викликається після справжнього скасування — сторінка перечитує стан. */
  onCancelled: () => void;
}

/**
 * «Запит у роботі» — статус ЗАЯВКИ НА РЕПЕТИТОРА з діями (§4 аудиту шляхів
 * 24.09, учень: «статус без жодної дії — ні ETA, ні чату, ні скасування»).
 *
 * Що саме було не так: людина надсилала заявку й далі бачила лише жовтий
 * прямокутник «менеджер уже підбирає». Ні коли надіслано, ні кому написати,
 * ні як передумати. Це той самий клас, що «заявка учня про оплату»: одна
 * сторона чекає, друга не знає, що чекають.
 *
 * Дві межі:
 *  • «Скасувати» показуємо ЛИШЕ поки заявка `open`: політика бази дозволяє
 *    учневі видалити саме свою і саме відкриту. Коли менеджер уже взяв її в
 *    роботу, кнопки немає — натомість лишається чат, бо там уже є з ким
 *    говорити.
 *  • RLS відкидає рядок МОВЧКИ (delete без помилки, 0 рядків). Тому успіх
 *    доводиться поверненими рядками, а не `error === null`: інакше людина
 *    побачила б «скасовано», а заявка лишилась би жити.
 */
export function TutorRequestStatusCard({ request, onCancelled }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const haptic = useHaptic();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<"chat" | "cancel" | null>(null);

  const days = Math.floor((Date.now() - new Date(request.created_at).getTime()) / 86_400_000);
  const sentLabel = days <= 0 ? t("studentPages.requestSentToday") : t("studentPages.requestSentDaysAgo", { count: days });
  const canCancel = request.status === "open";

  const openChat = async () => {
    setBusy("chat");
    const managerId = await startManagerChat();
    setBusy(null);
    if (!managerId) {
      toast.error(t("studentPages.requestChatFailed"));
      return;
    }
    navigate(managerChatPath(managerId));
  };

  const cancel = async () => {
    if (!user) return;
    setBusy("cancel");
    const { data, error } = await supabase
      .from("tutor_referral_requests")
      .delete()
      .eq("id", request.id)
      .eq("student_id", user.id)
      .select("id");
    setBusy(null);
    if (error || !data || data.length === 0) {
      haptic.error();
      // Найчастіша причина без помилки: менеджер уже взяв заявку в роботу.
      toast.error(t("studentPages.requestCancelFailed"), {
        description: t("studentPages.requestCancelFailedDesc"),
      });
      onCancelled();
      return;
    }
    haptic.success();
    toast.success(t("studentPages.requestCancelled"));
    void notifyManagers({
      type: "tutor_request_cancelled",
      title: t("notifications.tutorRequestCancelledTitle"),
      link: "/referrals",
    });
    onCancelled();
  };

  return (
    <div
      style={{
        display: "flex", gap: 12, alignItems: "flex-start", borderRadius: 13, padding: "12px 14px",
        background: "rgba(245,181,68,.1)", border: "1px solid rgba(245,181,68,.35)",
      }}
    >
      <span style={{ fontSize: 22, lineHeight: 1 }}>⏳</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8 }}>
          {/* 27.09: було вшите #7a5a14 / #9a6a12 — світлий текст лишався
              світлим і в темній темі. Токени перемикаються самі. */}
          <p style={{ fontWeight: 700, fontSize: 15 }} className="text-warning">
            {t("studentPages.requestPendingTitle")}
          </p>
          <span style={{ fontSize: 13, color: "var(--sub,#62677E)" }}>{sentLabel}</span>
        </div>
        <p style={{ fontSize: 14, color: "var(--sub,#62677E)", marginTop: 2, lineHeight: 1.45 }}>
          {t("studentPages.requestPendingDesc")}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          <button
            onClick={openChat}
            disabled={busy !== null}
            className="inline-flex h-11 items-center gap-2 rounded-[12px] bg-[var(--teal)] px-4 text-[14px] font-semibold text-white disabled:opacity-60"
          >
            {busy === "chat" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
            {t("studentPages.requestChatBtn")}
          </button>
          {canCancel && (
            <button
              onClick={cancel}
              disabled={busy !== null}
              className="inline-flex h-11 items-center gap-2 rounded-[12px] border border-border px-4 text-[14px] font-semibold text-muted-foreground disabled:opacity-60"
            >
              {busy === "cancel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
              {t("studentPages.requestCancelBtn")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
