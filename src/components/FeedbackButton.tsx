import { useState } from "react";
import { MessageCircleHeart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { FeedbackDialog } from "./FeedbackDialog";

export function FeedbackButton() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  return (
    <>
      <Button
        size="lg"
        onClick={() => setOpen(true)}
        className="h-12 gap-2 rounded-full"
        aria-label={t("feedback.btn")}
      >
        <MessageCircleHeart className="h-5 w-5" />
        <span className="hidden sm:inline">{t("feedback.title")}</span>
      </Button>
      <FeedbackDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
