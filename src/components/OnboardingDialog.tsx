import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OnboardingContent } from "@/components/OnboardingContent";
import { useTranslation } from "react-i18next";

interface OnboardingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OnboardingDialog({ open, onOpenChange }: OnboardingDialogProps) {
  const { t } = useTranslation();
  const close = () => onOpenChange(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{t("onboardingDialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="p-4 sm:p-6">
          <OnboardingContent onNavigate={close} onFinish={close} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
