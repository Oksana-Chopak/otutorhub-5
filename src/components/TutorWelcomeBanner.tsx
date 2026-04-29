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
    <div className="mb-6 overflow-hidden rounded-3xl border-2 border-primary/30 bg-gradient-to-br from-primary/10 via-card to-success/10 shadow-[0_8px_30px_-8px_hsl(var(--primary)/0.25)]">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-lg animate-bounce-soft">
            <Sparkles className="h-6 w-6" />
            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-warning text-[10px] font-black text-warning-foreground shadow-sm animate-pop">
              {step}
            </span>
          </div>
          <div className="min-w-0">
            <p className="font-display text-base font-bold text-foreground">
              🎯 Ваш квест: налаштувати простір
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              <span className="gamify-sticker">Рівень {step}/{TOTAL_STEPS}</span>
              <span className="ml-2 font-medium">{pct}% готово</span>
            </p>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted sm:w-64">
              <div
                className="h-full gamify-progress-fill transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <Button asChild size="sm" className="rounded-full shadow-md hover:scale-105 transition-transform">
            <Link to="/onboarding">
              Продовжити квест
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
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
