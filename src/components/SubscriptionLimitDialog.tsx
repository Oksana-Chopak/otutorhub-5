import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Crown, MessageCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { FREE_STUDENT_LIMIT } from "@/hooks/useWorkspaceSettings";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studentCount: number;
}

export function SubscriptionLimitDialog({ open, onOpenChange, studentCount }: Props) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [managerId, setManagerId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "manager")
        .limit(1)
        .maybeSingle();
      setManagerId(data?.user_id ?? null);
    })();
  }, [open]);

  const openManagerChat = async () => {
    if (!user) return;
    if (!managerId) {
      toast.error("Не знайшли менеджера. Спробуйте пізніше.");
      return;
    }
    setLoading(true);
    // Manager creates the thread (RLS), so we send a referral request that manager sees;
    // for instant chat we use get_or_create_chat_thread only if user is participant.
    // Since the tutor is not student, we route them via referral path: send a message via
    // creating an open referral note OR open chats page.
    // Simplest UX: navigate to /chats and let them message manager from there.
    navigate("/chats");
    setLoading(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-warning/15">
            <Crown className="h-6 w-6 text-warning" />
          </div>
          <DialogTitle>Ліміт безкоштовного плану</DialogTitle>
          <DialogDescription className="space-y-2 pt-2">
            <p>
              На безкоштовному плані можна додати до{" "}
              <span className="font-semibold text-foreground">{FREE_STUDENT_LIMIT}</span> учнів.
              Зараз у вас уже <span className="font-semibold text-foreground">{studentCount}</span>.
            </p>
            <p>
              Щоб додавати більше учнів, оформіть підписку{" "}
              <span className="font-semibold text-foreground">145 ₴/міс</span>.
            </p>
            <p className="text-xs">
              Поки що оплата відбувається вручну — напишіть менеджеру, і ми все налаштуємо.
            </p>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:flex-col sm:space-x-0">
          <Button onClick={openManagerChat} disabled={loading} className="w-full">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageCircle className="mr-2 h-4 w-4" />}
            Написати менеджеру
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full">
            Пізніше
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
