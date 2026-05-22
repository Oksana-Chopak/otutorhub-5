import { useEffect } from "react";
import confetti from "canvas-confetti";

interface Props {
  emoji: string;
  title: string;
  xp: number;
  isFinal?: boolean;
  onDone: () => void;
}

export function StepVictoryOverlay({ emoji, title, xp, isFinal, onDone }: Props) {
  useEffect(() => {
    if (isFinal) {
      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.55 },
        colors: ["#0CA678", "#F59E0B", "#3B82F6", "#EC4899"],
      });
      setTimeout(
        () =>
          confetti({
            particleCount: 80,
            angle: 60,
            spread: 55,
            origin: { x: 0 },
          }),
        200,
      );
      setTimeout(
        () =>
          confetti({
            particleCount: 80,
            angle: 120,
            spread: 55,
            origin: { x: 1 },
          }),
        400,
      );
    } else {
      confetti({
        particleCount: 40,
        spread: 50,
        origin: { y: 0.4 },
        colors: ["#0CA678", "#F59E0B"],
        scalar: 0.8,
      });
    }

    const timer = setTimeout(onDone, isFinal ? 2800 : 1800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[100] flex items-start justify-center pt-20"
      aria-live="polite"
      role="status"
    >
      <div className="animate-victory pointer-events-auto flex items-center gap-4 rounded-3xl border-2 border-primary/30 bg-card/95 px-6 py-4 shadow-2xl backdrop-blur-sm">
        <div className="animate-checkmark-pop text-5xl" aria-hidden>
          {emoji}
        </div>
        <div className="min-w-0">
          <p className="font-display text-lg font-bold text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground">
            {isFinal ? "Всі квести виконано! 🎉" : "Крок завершено!"}
          </p>
        </div>
        <div className="relative">
          <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-primary to-success px-3 py-1.5 text-sm font-bold text-primary-foreground shadow-md">
            +{xp} XP
          </span>
          <span
            className="animate-xp-float pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 text-sm font-bold text-primary"
            aria-hidden
          >
            +{xp}
          </span>
        </div>
      </div>
    </div>
  );
}
