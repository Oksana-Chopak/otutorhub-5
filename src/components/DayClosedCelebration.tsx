import { useEffect } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  show: boolean;
  lessonCount: number;
  onDone: () => void;
}

export function DayClosedCelebration({ show, lessonCount, onDone }: Props) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!show) return;
    const id = setTimeout(onDone, 4000);
    return () => clearTimeout(id);
  }, [show, onDone]);

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onDone}
    >
      <div className="animate-in zoom-in-95 fade-in flex flex-col items-center gap-4 rounded-3xl bg-card p-10 text-center shadow-2xl duration-500">
        <span className="animate-bounce text-7xl">🌟</span>
        <h2 className="text-3xl font-bold text-foreground">
          {t("tutorDelight.dayClosedTitle")}
        </h2>
        <p className="max-w-xs text-muted-foreground">
          {t("tutorDelight.dayClosedDesc", { count: lessonCount })}
        </p>
        <p className="text-xs text-muted-foreground/60">{t("tutorDelight.dayClosedTap")}</p>
      </div>
    </div>
  );
}
