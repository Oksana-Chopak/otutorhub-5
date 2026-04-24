import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Crown } from "lucide-react";
import { FREE_STUDENT_LIMIT } from "@/hooks/useWorkspaceSettings";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studentCount: number;
}

export function SubscriptionLimitDialog({ open, onOpenChange, studentCount }: Props) {
  const navigate = useNavigate();

  const goToSubscription = () => {
    navigate("/subscription");
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
            <span className="block">
              На безкоштовному плані можна додати до{" "}
              <span className="font-semibold text-foreground">{FREE_STUDENT_LIMIT}</span> учнів.
              Зараз у вас уже <span className="font-semibold text-foreground">{studentCount}</span>.
            </span>
            <span className="block">
              Щоб додавати більше учнів, оформіть підписку{" "}
              <span className="font-semibold text-foreground">145 ₴/міс</span>.
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:flex-col sm:space-x-0">
          <Button onClick={goToSubscription} className="w-full">
            <Crown className="mr-2 h-4 w-4" />
            Перейти до підписки
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full">
            Пізніше
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
