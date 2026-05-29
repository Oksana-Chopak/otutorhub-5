import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowRight, Crown } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Always-visible trial countdown for independent tutors on Pro trial.
 * Becomes more urgent in the last 3 days.
 */
export function TrialCountdownBanner() {
  const { t } = useTranslation();
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

  // No trial info → user never had a trial (new registration) — show nothing
  // Only show "trial ended" if trial_until was set in the past (actually expired)
  if (!trialUntil) return null;

  const urgent = trialDaysLeft <= 3;
  // trialUntil is guaranteed non-null here (checked above)
  const expired = trialUntil!.getTime() < Date.now();

  if (expired) {
    return (
      <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium text-foreground">
            {t("trial.expiredBanner")}
          </span>
          <Button size="sm" asChild className="rounded-full">
            <Link to="/subscription">
              {t("trial.connectPro")}
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
          {t("trial.remaining")}{" "}
          <span className={urgent ? "font-bold text-warning" : "font-bold text-primary"}>
            {t("trial.day", { count: trialDaysLeft })}
          </span>
        </span>
        <Button
          size="sm"
          asChild
          variant={urgent ? "default" : "outline"}
          className="rounded-full"
        >
          <Link to="/subscription">
            {t("trial.connectPro")}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
