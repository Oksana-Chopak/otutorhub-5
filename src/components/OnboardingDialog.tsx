import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OnboardingContent } from "@/components/OnboardingContent";

interface OnboardingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OnboardingDialog({ open, onOpenChange }: OnboardingDialogProps) {
  const close = () => onOpenChange(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Початкове налаштування</DialogTitle>
        </DialogHeader>
        <div className="p-4 sm:p-6">
          <OnboardingContent onNavigate={close} onFinish={close} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
