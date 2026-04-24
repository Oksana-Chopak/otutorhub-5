import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sparkles, X, ArrowRight } from "lucide-react";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";

const STORAGE_KEY = "tutorhub.welcomeBannerDismissed";
const TOTAL_STEPS = 6;

/**
 * Shown on the dashboard for independent tutors who haven't completed onboarding.
 * Dismissible (per-browser); reappears if onboarding progress changes.
 */
export function TutorWelcomeBanner() {
  const { settings, isIndependent, loading } = useWorkspaceSettings();
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    setDismissed(localStorage.getItem(STORAGE_KEY));
  }, []);

  if (loading || !settings || !isIndependent || settings.onboarding_completed) {
    return null;
  }

  const step = settings.onboarding_step ?? 1;
  // Dismissal is keyed to current step so progress reappears banner
  if (dismissed === String(step)) return null;

  const pct = Math.round(((step - 1) / TOTAL_STEPS) * 100);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, String(step));
    setDismissed(String(step));
  };

  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="font-display text-base font-semibold text-foreground">
              Налаштуйте робочий простір
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Крок {step} з {TOTAL_STEPS} · {pct}% готово
            </p>
            <Progress value={pct} className="mt-2 h-1.5 w-full sm:w-64" />
          </div>
        </div>
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <Button asChild size="sm">
            <Link to="/onboarding">
              Продовжити
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={dismiss}
            title="Сховати"
            aria-label="Сховати банер"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
