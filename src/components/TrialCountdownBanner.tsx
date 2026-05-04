import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowRight, Crown } from "lucide-react";

/**
 * Always-visible trial countdown for independent tutors on Pro trial.
 * Becomes more urgent in the last 3 days.
 */
export function TrialCountdownBanner() {
  const { isIndependent, isTrial, trialDaysLeft, trialUntil, isPro, settings } =
    useWorkspaceSettings();

  // Tick every minute so the countdown updates without reload
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  if (!isIndependent || !settings) return null;

  // Active paid Pro — no banner needed
  if (isPro && !isTrial) return null;

  // No trial info → nothing to show
  if (!trialUntil) {
    if (settings.subscription_status === "free") {
      return (
        <div className="mb-4 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-foreground">
              ⏳ Тріал завершився. Підключіть Pro, щоб продовжити роботу.
            </span>
            <Button size="sm" asChild className="rounded-full">
              <Link to="/subscription">
                <Crown className="h-3.5 w-3.5" />
                Підключити за 129 ₴/міс
              </Link>
            </Button>
          </div>
        </div>
      );
    }
    return null;
  }

  const urgent = trialDaysLeft <= 3;
  const expired = trialUntil.getTime() < Date.now();

  if (expired) {
    return (
      <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium text-foreground">
            ⏰ Тріал завершено. Підключіть Pro, щоб не втратити доступ.
          </span>
          <Button size="sm" asChild className="rounded-full">
            <Link to="/subscription">
              Підключити за 129 ₴/міс
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        urgent
          ? "mb-4 rounded-xl border-2 border-warning/60 bg-gradient-to-r from-warning/10 to-warning/5 px-4 py-3 text-sm shadow-sm"
          : "mb-4 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm"
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium text-foreground">
          <Sparkles className={urgent ? "h-4 w-4 text-warning" : "h-4 w-4 text-primary"} />
          🎁 Тріал Pro: залишилось{" "}
          <span className={urgent ? "font-bold text-warning" : "font-bold text-primary"}>
            {trialDaysLeft} {trialDaysLeft === 1 ? "день" : trialDaysLeft < 5 ? "дні" : "днів"}
          </span>
        </span>
        <Button
          size="sm"
          asChild
          variant={urgent ? "default" : "outline"}
          className="rounded-full"
        >
          <Link to="/subscription">
            Підключити за 129 ₴/міс
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
