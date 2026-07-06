import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Copy, Check, Mail, X, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Person we just added — used to render the message */
  personName?: string;
  /** Email the tutor entered for the student. Used to prefill signup. */
  email?: string | null;
  /** Phone alternative if no email — shown as instruction */
  phone?: string | null;
  /** Inviter display name, used in the message body */
  inviterName?: string;
  /** Role assigned to the ghost ("student" by default) */
  role?: "student" | "tutor";
  /** Ghost profile id — required to enable the "Resend email" action */
  studentId?: string | null;
  /** Whether the auto-invite email was already sent successfully */
  emailSent?: boolean;
}

export function InviteLinkDialog({
  open,
  onOpenChange,
  personName,
  email,
  phone,
  inviterName,
  role = "student",
  studentId,
  emailSent = false,
}: Props) {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState(false);
  const [resending, setResending] = useState(false);

  const inviteUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("signup", "1");
    if (email) params.set("email", email);
    params.set("role", role);
    return `${window.location.origin}/auth?${params.toString()}`;
  }, [email, role]);

  const isTutor = role === "tutor";
  const roleNoun = isTutor ? t("inviteLink.tutorNoun") : t("inviteLink.studentNoun");

  const message = useMemo(() => {
    const greeting = personName ? t("inviteLink.greeting", { name: personName }) : t("inviteLink.greetingGeneric");
    const who = inviterName ? ` (${inviterName})` : "";
    const contact = email ? t("inviteLinkExtra.contactEmail") : t("inviteLinkExtra.contactGeneric");
    const intro = isTutor
      ? t("inviteLinkExtra.introTutor", { who, contact })
      : t("inviteLinkExtra.introStudent", { who, contact });
    return `${greeting}\n\n${intro}\n\n👉 ${inviteUrl}`;
  }, [personName, inviterName, email, inviteUrl, isTutor]);

  const copy = async (text: string, kind: "link" | "message") => {
    try {
      await navigator.clipboard.writeText(text);
      if (kind === "link") {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      } else {
        setCopiedMessage(true);
        setTimeout(() => setCopiedMessage(false), 2000);
      }
      toast.success(t("inviteLinkExtra.copied"));
    } catch {
      toast.error(t("inviteLinkExtra.copyFailed"));
    }
  };

  const handleResendEmail = async () => {
    if (!studentId) return;
    setResending(true);
    const { data, error } = await supabase.functions.invoke("send-student-invite", {
      body: { studentId },
    });
    setResending(false);
    if (error) {
      toast.error(t("inviteLinkExtra.emailFailed"));
      return;
    }
    const result = data as { success?: boolean; reason?: string; message?: string };
    if (result?.success) {
      toast.success(t("inviteLinkExtra.emailSent"));
    } else if (result?.reason === "rate_limited") {
      toast.info(t("inviteLinkExtra.emailRateLimited"));
    } else {
      toast.error(t("inviteLinkExtra.emailFailed"));
    }
  };

  const firstName = (personName ?? "").split(" ")[0] || personName || roleNoun;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] max-h-[90vh] flex flex-col p-0 gap-0 [&>button.absolute]:hidden">
        {/* Header — 🎉 medallion */}
        <div className="shrink-0 text-center relative" style={{ padding: "22px 20px 14px" }}>
          <button onClick={() => onOpenChange(false)} aria-label={t("common.close")}
            style={{ position: "absolute", top: 16, right: 16, width: 34, height: 34, borderRadius: 10, border: "none", background: "#F5F4F0", color: "var(--sub,#6b7088)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X className="h-[17px] w-[17px]" strokeWidth={2.2} />
          </button>
          <div style={{ width: 64, height: 64, margin: "4px auto 0", borderRadius: 20, background: "linear-gradient(135deg,#2BBFAA,#25a896)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, boxShadow: "0 14px 30px -12px rgba(43,191,170,.7)" }}>🎉</div>
          <DialogTitle asChild>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 23, letterSpacing: "-.01em", color: "#0f0f1a", marginTop: 14 }}>
              {firstName} {t("inviteLinkExtra.addedSuffix")}
            </div>
          </DialogTitle>
          <DialogDescription asChild>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 15, lineHeight: 1.5, color: "var(--sub,#6b7088)", marginTop: 6, padding: "0 4px" }}>
              {/* «Ми надіслали запрошення» must key on emailSent, not on the email's
                  mere presence — tutors never get an auto-email (addPerson sends only
                  for students), so this claimed a send that never happened. */}
              {email && emailSent
                ? (isTutor
                    ? t("inviteLinkExtra.descEmailTutor")
                    : t("inviteLinkExtra.descEmailStudent"))
                : (isTutor
                    ? t("inviteLinkExtra.descNoEmailTutor")
                    : t("inviteLinkExtra.descNoEmailStudent"))}
            </div>
          </DialogDescription>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: "4px 20px 12px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Status box */}
          {email && emailSent ? (
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", borderRadius: 13, border: "1px solid rgba(34,197,94,.4)", background: "rgba(34,197,94,.06)", padding: 13 }}>
              <MailCheck className="h-[19px] w-[19px] shrink-0" style={{ color: "#16a34a", marginTop: 1 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, color: "#0f0f1a", wordBreak: "break-all" }}>
                  {t("inviteLinkExtra.emailSentLabel", { email })}
                </div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--sub,#6b7088)", marginTop: 3, lineHeight: 1.45 }}>
                  {t("inviteLinkExtra.notReceived")}{" "}
                  <button onClick={handleResendEmail} disabled={resending}
                    style={{ border: "none", background: "none", padding: 0, cursor: resending ? "default" : "pointer", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14, color: "#16a34a", textDecoration: "underline", textUnderlineOffset: 2, whiteSpace: "nowrap" }}>
                    {resending ? t("inviteLinkExtra.sending") : t("inviteLinkExtra.resendInline")}
                  </button>.
                </div>
              </div>
            </div>
          ) : !email ? (
            <div style={{ borderRadius: 13, border: "1px solid rgba(245,158,11,.4)", background: "rgba(245,158,11,.06)", padding: 13, fontFamily: "var(--font-body)", fontSize: 15, lineHeight: 1.45, color: "#0f0f1a" }}>
              ⚠️ {t("inviteLinkExtra.noEmailWarn")}{phone ? ` (${phone})` : ""}.
            </div>
          ) : (
            /* email заданий, але авто-лист не пішов — даємо кнопку надіслати */
            studentId && (
              <button onClick={handleResendEmail} disabled={resending}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", height: 46, borderRadius: 13, border: "none", cursor: resending ? "default" : "pointer", background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, boxShadow: "0 8px 20px -8px rgba(43,191,170,.6)" }}>
                <Mail className="h-4 w-4" />
                {resending ? t("inviteLinkExtra.sending") : t("inviteLinkExtra.sendEmailNow")}
              </button>
            )
          )}

          {/* Registration link */}
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--sub,#6b7088)", marginBottom: 8 }}>
              {t("inviteLinkExtra.linkLabel")}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, borderRadius: 13, border: "1px solid #eceef3", background: "#F5F4F0", padding: "7px 7px 7px 14px", minWidth: 0 }}>
              <code style={{ flex: 1, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 15, color: "#0f0f1a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{inviteUrl}</code>
              <button onClick={() => copy(inviteUrl, "link")} aria-label={t("inviteLinkExtra.copyLink")}
                style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 11, border: "none", cursor: "pointer", background: copiedLink ? "rgba(34,197,94,.14)" : "#fff", color: copiedLink ? "#16a34a" : "#1f8e7e", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 4px rgba(0,0,0,.06)" }}>
                {copiedLink ? <Check className="h-[21px] w-[21px]" strokeWidth={2.4} /> : <Copy className="h-[21px] w-[21px]" />}
              </button>
            </div>
          </div>

          {/* Ready message */}
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--sub,#6b7088)", marginBottom: 8 }}>
              {t("inviteLinkExtra.messageLabel")}
            </div>
            <div style={{ position: "relative", whiteSpace: "pre-wrap", borderRadius: 13, border: "1px solid #eceef3", background: "#F5F4F0", padding: "13px 56px 13px 15px", fontFamily: "var(--font-body)", fontSize: 15, lineHeight: 1.55, color: "#0f0f1a", wordBreak: "break-word" }}>
              {message}
              <button onClick={() => copy(message, "message")} aria-label={t("inviteLinkExtra.copyMessage")}
                style={{ position: "absolute", top: 8, right: 8, width: 44, height: 44, borderRadius: 11, border: "none", cursor: "pointer", background: copiedMessage ? "rgba(34,197,94,.14)" : "#fff", color: copiedMessage ? "#16a34a" : "#1f8e7e", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 4px rgba(0,0,0,.06)" }}>
                {copiedMessage ? <Check className="h-[21px] w-[21px]" strokeWidth={2.4} /> : <Copy className="h-[21px] w-[21px]" />}
              </button>
            </div>
          </div>

          {/* Open mail app — only with email */}
          {email && (
            <a href={`mailto:${email}?subject=${encodeURIComponent(t("inviteLinkExtra.inviteSubject"))}&body=${encodeURIComponent(message)}`} className="block">
              <button style={{ width: "100%", height: 44, borderRadius: 12, border: "none", background: "transparent", color: "var(--sub,#6b7088)", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <Mail className="h-4 w-4" />
                <span className="truncate">{t("inviteLinkExtra.openEmail")}</span>
              </button>
            </a>
          )}
        </div>

        {/* Footer — Done */}
        <div className="shrink-0" style={{ padding: "14px 20px 20px", borderTop: "1px solid #eceef3", background: "#fff" }}>
          <button onClick={() => onOpenChange(false)}
            style={{ width: "100%", height: 52, borderRadius: 14, border: "none", background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 8px 20px -8px rgba(43,191,170,.6)" }}>
            <Check className="h-[18px] w-[18px]" strokeWidth={2.4} />
            {t("inviteLinkExtra.doneBtn")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
