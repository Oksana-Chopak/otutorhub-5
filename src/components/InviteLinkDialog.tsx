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
import { Copy, Check, Mail, Send } from "lucide-react";
import { toast } from "sonner";

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
}

export function InviteLinkDialog({
  open,
  onOpenChange,
  personName,
  email,
  phone,
  inviterName,
  role = "student",
}: Props) {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState(false);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>🎉 Учня додано!</DialogTitle>
          <DialogDescription>
            Щоб учень міг увійти й бачити уроки, йому потрібно <strong>створити акаунт</strong>.
            Передайте йому це посилання — після реєстрації його профіль автоматично зв'яжеться з вашим.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
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
