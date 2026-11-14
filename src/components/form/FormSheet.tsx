import * as React from "react";
import { Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * ОБОЛОНКА ФОРМИ (хвиля 14.11): аркуш знизу на телефоні, вікно по центру на компʼютері.
 *
 * Та сама оболонка, яку вже мають форма уроку, ставка репетитора й «Додати репетитора до
 * учня», — тепер одним компонентом, щоб решта форм не збирала її щоразу власноруч (і не
 * роз'їжджалась: ручка, заголовок 20px/800, хрестик 44px, тіло, що гортається, і підвал із
 * кнопками 50px, який завжди на екрані).
 *
 * Стоїть на базовому `DialogContent`, тож правила екранної клавіатури (`kb-sheet`) діють самі.
 */
export function FormSheet({
  open, onOpenChange, title, description, children, footer, locked = false, bodyClassName, testId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** кнопки підвалу — `SheetButton`; без підвалу форма закривається хрестиком */
  footer?: React.ReactNode;
  /** йде запис — форму не закрити випадковим дотиком повз */
  locked?: boolean;
  bodyClassName?: string;
  testId?: string;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!locked || o) onOpenChange(o); }}>
      <DialogContent
        aria-describedby={undefined}
        data-form-sheet={testId ?? ""}
        className="w-full max-w-md p-0 gap-0 rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[92vh] flex flex-col [&>button.absolute]:hidden"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div className="flex shrink-0 justify-center pb-1 pt-2.5 sm:hidden">
          <div className="h-1 w-9 rounded-full bg-border" />
        </div>
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-2.5 pt-3">
          <div className="min-w-0">
            <div aria-hidden className="text-[20px] font-extrabold text-foreground" style={{ letterSpacing: "-.01em", lineHeight: 1.2 }}>{title}</div>
            {description ? (
              <div className="mt-1 text-[14px] text-muted-foreground" style={{ lineHeight: 1.4 }}>{description}</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => { if (!locked) onOpenChange(false); }}
            aria-label={t("common.close")}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] text-muted-foreground"
            style={{ background: "var(--ds-bg)" }}
          >
            <X size={18} />
          </button>
        </div>
        <div className={cn("min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-4 pt-1", bodyClassName)}>
          {children}
        </div>
        {footer ? (
          <div className="flex shrink-0 gap-2.5 px-5 pb-[18px] pt-3" style={{ borderTop: "0.5px solid var(--ds-border)", background: "var(--ds-surface)" }}>
            {footer}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Кнопка підвалу форми, 50px. `primary` — бірюзова на всю решту ширини; `secondary` — тиха
 * («Скасувати», «Закрити»); `danger` — червона дія, яку не повернути одним дотиком.
 */
export const SheetButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: "primary" | "secondary" | "danger"; busy?: boolean }
>(({ kind = "primary", busy = false, disabled, className, style, children, ...props }, ref) => {
  const base = "inline-flex h-[50px] items-center justify-center gap-2 rounded-[14px] text-[16px] font-bold disabled:cursor-not-allowed disabled:opacity-60";
  const look =
    kind === "primary" ? "flex-1 border-0"
    : kind === "danger" ? "flex-1 border-0"
    : "shrink-0 border px-[18px] text-[15px]";
  const paint: React.CSSProperties =
    kind === "primary" ? { background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", boxShadow: "0 8px 20px -8px rgba(43,191,170,.6)" }
    : kind === "secondary" ? { background: "var(--ds-surface)", borderColor: "var(--ds-border)", color: "var(--sub)" }
    : { background: "#dc2626", color: "#ffffff" }; // білий на #dc2626 — 4.83:1; на типовому червоному теми було б 3.76:1
  return (
    <button ref={ref} type="button" disabled={disabled || busy} className={cn(base, look, className)} style={{ ...paint, ...style }} {...props}>
      {busy ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
});
SheetButton.displayName = "SheetButton";
