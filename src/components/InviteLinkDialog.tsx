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

  const message = useMemo(() => {
    const greeting = personName ? `Привіт, ${personName}!` : "Привіт!";
    const who = inviterName ? ` (${inviterName})` : "";
    const base = `${greeting}\n\nЯ додав(ла) тебе в oTutorHub${who} як свого учня. Щоб бачити уроки, ціни, домашні завдання й конспекти — створи акаунт за посиланням нижче. Використай саме той самий ${email ? "email" : "контакт"}, інакше профіль не зв'яжеться.\n\n👉 ${inviteUrl}`;
    return base;
  }, [personName, inviterName, email, inviteUrl]);

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
      toast.success("Скопійовано");
    } catch {
      toast.error("Не вдалося скопіювати");
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
      toast.error("Не вдалося надіслати email");
      return;
    }
    const result = data as { success?: boolean; reason?: string; message?: string };
    if (result?.success) {
      setResent(true);
      toast.success("Запрошення надіслано на email");
    } else if (result?.reason === "rate_limited") {
      toast.info("Лист уже надсилався недавно. Спробуйте за ~24 години.");
      setResent(true);
    } else {
      toast.error("Не вдалося надіслати email");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>🎉 Учня додано!</DialogTitle>
          <DialogDescription>
            {emailSent
              ? "Ми надіслали запрошення на email учня. Він отримає лист з кнопкою для створення акаунта — після реєстрації профіль автоматично зв'яжеться з вашим."
              : "Щоб учень міг увійти й бачити уроки, йому потрібно створити акаунт. Передайте йому посилання нижче — після реєстрації профіль автоматично зв'яжеться з вашим."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {emailSent && email && (
            <div className="flex items-start gap-2 rounded-md border border-success/40 bg-success/5 p-3 text-xs text-foreground">
              <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <div>
                <strong>Лист надіслано на {email}</strong>
                <p className="mt-1 text-muted-foreground">
                  Якщо учень не отримав — попросіть перевірити папку «Спам».
                  Можете також скопіювати посилання нижче й передати напряму.
                </p>
              </div>
            </div>
          )}

          {!email && (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-foreground">
              ⚠️ Ви не вказали email учня. Учень зможе зареєструватися сам, але автоматично з'єднати профіль вийде тільки якщо телефон при реєстрації <strong>збігатиметься</strong> з тим, що ви вказали{phone ? ` (${phone})` : ""}.
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Посилання для реєстрації
            </label>
            <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2">
              <code className="flex-1 truncate text-xs text-foreground">{inviteUrl}</code>
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
              Готове повідомлення для учня
            </label>
            <div className="rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-line text-foreground">
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

          {email && (
            <a
              href={`mailto:${email}?subject=${encodeURIComponent(
                "Запрошення в oTutorHub"
              )}&body=${encodeURIComponent(message)}`}
              className="block"
            >
              <Button variant="secondary" size="sm" className="w-full">
                <Mail className="mr-2 h-4 w-4" />
                Відкрити в поштовому клієнті
              </Button>
            </a>
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
            <Send className="mr-2 h-4 w-4" />
            Готово
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
