import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * BackToProfile — a calm footer control shown at the bottom of pages reached
 * from "Мій профіль", so the user always has a clear way back instead of
 * relying on the browser back button. Uses the design-system ghost style:
 * hairline pill, teal-on-hover, spring press.
 */
export function BackToProfile({ to = "/profile", label }: { to?: string; label?: string }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const autoLabel = to === "/finances"
    ? (t("common.backToFinances") || "Назад до Фінансів")
    : (t("common.backToProfile") || "Назад до профілю");
  return (
    <div className="mt-8 mb-2 flex justify-center">
      <button
        type="button"
        onClick={() => navigate(to)}
        className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-semibold text-muted-foreground transition-all hover:text-primary hover:border-primary/40 active:scale-[0.97]"
        style={{ fontFamily: "Inter, system-ui" }}
      >
        <ArrowLeft className="h-4 w-4" />
        {label || autoLabel}
      </button>
    </div>
  );
}

export default BackToProfile;
