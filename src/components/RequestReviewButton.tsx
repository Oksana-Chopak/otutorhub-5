import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MessageCircleHeart, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

/**
 * RequestReviewButton — the tutor side of the review loop.
 *
 * Sends the student a warm chat message inviting them to leave a review. Uses
 * the existing chat infrastructure (get_or_create_chat_thread + chat_messages
 * insert), which RLS allows — unlike notifications, which a tutor can't write
 * to another user. The student then sees the nudge in chat and can rate the
 * lesson from their dashboard prompt.
 */
export function RequestReviewButton({
  tutorId,
  studentId,
}: {
  tutorId: string;
  studentId: string;
}) {
  const { t } = useTranslation();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const send = async () => {
    setSending(true);
    try {
      const { data: threadId, error: threadErr } = await supabase.rpc("get_or_create_chat_thread", {
        _tutor_id: tutorId,
        _student_id: studentId,
      });
      if (threadErr || !threadId) {
        setSending(false);
        toast.error(t("requestReview.failed"));
        return;
      }
      const body = t("requestReview.message");
      const { error: msgErr } = await supabase
        .from("chat_messages")
        .insert({ thread_id: threadId as string, sender_id: tutorId, body });
      setSending(false);
      if (msgErr) {
        toast.error(t("requestReview.failed"));
        return;
      }
      setSent(true);
      toast.success(t("requestReview.sent"));
    } finally {
      setSending(false);
    }
  };

  return (
    <button
      onClick={send}
      disabled={sending || sent}
      className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-2 text-sm font-semibold text-primary transition-all hover:bg-primary/10 active:scale-[0.97] disabled:opacity-60"
      style={{ fontFamily: "Inter, system-ui" }}
    >
      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircleHeart className="h-4 w-4" />}
      {sent ? t("requestReview.sentShort") : t("requestReview.cta")}
    </button>
  );
}

export default RequestReviewButton;
