import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { OnboardingContent } from "@/components/OnboardingContent";
import { useTranslation } from "react-i18next";

/**
 * Full-screen onboarding (no sidebar). Feels like entering a game,
 * not navigating an app shell.
 */
export default function OnboardingPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-card to-primary/5">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(-1)}
            className="gap-1.5"
            aria-label={t("common.back") || "Back"}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">{t("common.back") || "Назад"}</span>
          </Button>
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="oTutorHub" className="h-7 w-7" />
            <span className="font-display text-sm font-bold text-foreground">oTutorHub</span>
          </div>
          <div className="w-[64px]" />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
        <OnboardingContent onFinish={() => navigate("/")} />
      </main>
    </div>
  );
}
