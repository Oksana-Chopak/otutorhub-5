import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Check, Mail, Send, Loader2, MailCheck } from "lucide-react";
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
  const [resent, setResent] = useState(emailSent);

  const inviteUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("signup", "1");
    if (email) params.set("email", email);
    params.set("role", role);
    return `${window.location.origin}/auth?${params.toString()}`;
  }, [email, role]);

  const isTutor = role === "tutor";
  const roleNoun = isTutor ? t("inviteLink.tutorNoun") : t("inviteLink.studentNoun");
  const roleNounDative = isTutor ? t("inviteLink.tutorDative") : t("inviteLink.studentDative");
  const roleNounPossessive = isTutor ? t("inviteLinkExtra.tutorPossessive") : t("inviteLinkExtra.studentPossessive");

  const message = useMemo(() => {
    const greeting = personName ? t("inviteLink.greeting", { name: personName }) : t("inviteLink.greetingGeneric") ?? "Привіт!";
    const who = inviterName ? ` (${inviterName})` : "";
    const intro = isTutor
      ? `Я${who} запрошую тебе приєднатися до oTutorHub як репетитора. Створи акаунт за посиланням нижче, щоб бачити учнів, розклад, оплати й вести уроки. Використай саме той самий ${email ? "email" : "контакт"}, інакше профіль не зв'яжеться.`
      : `Я додав(ла) тебе в oTutorHub${who} як свого учня. Щоб бачити уроки, ціни, домашні завдання й конспекти — створи акаунт за посиланням нижче. Використай саме той самий ${email ? "email" : "контакт"}, інакше профіль не зв'яжеться.`;
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
      setResent(true);
      toast.success(t("inviteLinkExtra.emailSent"));
    } else if (result?.reason === "rate_limited") {
      toast.info(t("inviteLinkExtra.emailRateLimited"));
      setResent(true);
    } else {
      toast.error(t("inviteLinkExtra.emailFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle>🎉 {isTutor ? t("assignTutorExtra.assigned").replace(" 🎉","") : t("inviteLinkExtra.studentAdded").replace("🎉 ","").replace(" додано!","")} додано!</DialogTitle>
          <DialogDescription>
            {emailSent
              ? `Ми надіслали запрошення на email ${roleNounDative === "репетитору" ? "репетитора" : "учня"}. ${isTutor ? "Він" : "Він/вона"} отримає лист з кнопкою для створення акаунта — після реєстрації профіль автоматично зв'яжеться з вашим.`
              : `Щоб ${isTutor ? "репетитор міг увійти й вести уроки" : "учень міг увійти й бачити уроки"}, ${isTutor ? "йому" : "йому/їй"} потрібно створити акаунт. Передайте посилання нижче — після реєстрації профіль автоматично зв'яжеться з вашим.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 overflow-y-auto px-6 py-2 flex-1 min-w-0">
          {emailSent && email && (
            <div className="flex items-start gap-2 rounded-md border border-success/40 bg-success/5 p-3 text-xs text-foreground">
              <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <div className="min-w-0">
                <strong className="break-all">{t("inviteLinkExtra.emailSentLabel", { email })}</strong>
                <p className="mt-1 text-muted-foreground">
                  Якщо лист не отримано — попросіть перевірити папку «Спам».
                  Можете також скопіювати посилання нижче й передати напряму.
                </p>
              </div>
            </div>
          )}

          {!email && (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-foreground">
              ⚠️ Ви не вказали email. {isTutor ? "Репетитор" : "Учень"} зможе зареєструватися самостійно, але автоматично з'єднати профіль вийде тільки якщо телефон при реєстрації <strong>збігатиметься</strong> з тим, що ви вказали{phone ? ` (${phone})` : ""}.
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Посилання для реєстрації
            </label>
            <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2 min-w-0">
              <code className="flex-1 truncate text-xs text-foreground min-w-0">{inviteUrl}</code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => copy(inviteUrl, "link")}
                className="h-7 shrink-0"
              >
                {copiedLink ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Готове повідомлення для {roleNounDative}
            </label>
            <div className="rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words text-foreground">
              {message}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copy(message, "message")}
              className="w-full"
            >
              {copiedMessage ? (
                <Check className="mr-2 h-4 w-4 text-success" />
              ) : (
                <Copy className="mr-2 h-4 w-4" />
              )}
              Скопіювати повідомлення
            </Button>
          </div>

          {email && studentId && (
            <Button
              variant={resent ? "outline" : "default"}
              size="sm"
              className="w-full"
              onClick={handleResendEmail}
              disabled={resending}
            >
              {resending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : resent ? (
                <MailCheck className="mr-2 h-4 w-4" />
              ) : (
                <Mail className="mr-2 h-4 w-4" />
              )}
              {resent ? t("inviteLinkExtra.resendBtn") : t("inviteLinkExtra.sendEmailTo", { role: roleNounDative })}
            </Button>
          )}

          {email && (
            <a
              href={`mailto:${email}?subject=${encodeURIComponent(
                t("inviteLinkExtra.inviteSubject")
              )}&body=${encodeURIComponent(message)}`}
              className="block"
            >
              <Button variant="ghost" size="sm" className="w-full">
                <Mail className="mr-2 h-4 w-4" />
                <span className="truncate">{t("inviteLinkExtra.openEmail")}</span>
              </Button>
            </a>
          )}
        </div>

        <DialogFooter className="px-6 pb-6 pt-3 shrink-0 border-t bg-background">
          <Button onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
            <Send className="mr-2 h-4 w-4" />
            Готово
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
