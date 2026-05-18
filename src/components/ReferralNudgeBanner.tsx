import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { HandHeart, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

const DISMISS_KEY = "referral_nudge_dismissed_v1";

interface Props {
  /** Number of completed lessons by this tutor. */
  completedLessons: number;
  /** Number of referrals already invited (hide nudge if > 0). */
  invitedCount: number;
}

/**
 * Eye-catching banner that surfaces the referral program AFTER the tutor
 * has completed at least 3 lessons (so they actually understand the value
 * of the product before being asked to share it).
 *
 * Hidden permanently after dismissal or once the tutor invites their first colleague.
 */
export function ReferralNudgeBanner({ completedLessons, invitedCount }: Props) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  if (dismissed) return null;
  if (invitedCount > 0) return null;
  if (completedLessons < 3) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  return (
    <div className="relative mb-4 overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-r from-primary/15 via-primary/5 to-transparent p-4 animate-fade-in">
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-2 top-2 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={t("referralBanner.hide")}
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex flex-wrap items-center gap-4 pr-6">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md">
          <HandHeart className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-bold text-foreground">
            {t("referralBanner.text")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("referralBanner.bonus")}
          </p>
        </div>
        <Button asChild size="sm" className="shrink-0">
          <Link to="/referrals">{t("referralBanner.cta")}</Link>
        </Button>
      </div>
    </div>
  );
}
