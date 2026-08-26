import { X } from "lucide-react";

/**
 * C2: єдиний компонент «наступна дія» — принцип аудиту «екран сам каже, що
 * далі». Іконка + текст + ОДНА кнопка (і тихий дісмісс). Використовується у
 * воркспейсі після збережень, у підсумку «Закрити день», далі — скрізь.
 */
export function NextStepBar({ icon, text, actionLabel, onAction, onDismiss }: {
  icon?: string;
  text: string;
  actionLabel: string;
  onAction: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-[14px] px-3.5 py-3"
      style={{ background: "#f0fdf9", border: "1.5px solid #cdeee7" }}
    >
      {icon && <span style={{ fontSize: 20, lineHeight: 1 }}>{icon}</span>}
      <p className="flex-1 min-w-0" style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#0f0f1a" }}>
        {text}
      </p>
      <button
        type="button"
        onClick={onAction}
        className="shrink-0 h-9 px-3.5 rounded-xl text-sm font-bold"
        style={{ border: "none", background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#04302a", cursor: "pointer" }}
      >
        {actionLabel}
      </button>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="dismiss"
          className="shrink-0 h-8 w-8 rounded-lg flex items-center justify-center"
          style={{ border: "none", background: "transparent", color: "var(--sub,#6b7088)", cursor: "pointer" }}>
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
