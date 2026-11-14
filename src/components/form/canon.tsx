import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * КАНОН ПОЛІВ ФОРМИ (хвиля 14.11, скарга власниці: «форма в застарілому дизайні»).
 *
 * Одне місце, де записано, як виглядає поле в будь-якому діалозі чи аркуші: підпис 14px/800,
 * поле 48px заввишки з текстом 16px (менше — iOS зумить усю форму), рамка 1.5px, кут 13px,
 * кольори лише з токенів (обидві теми). Нова чи переведена форма бере звідси, а не пише
 * розміри заново — саме так старі й нові форми роз'їхались.
 *
 * `NativeSelect` — рідний вибір телефона. У діалогах він стоїть ЗАМІСТЬ Radix Select:
 * рідний список не залежить від екранної клавіатури й розміру вікна, тож не може «блимнути й
 * зникнути» (дефект 14.11), і на телефоні це звичне колесо / список системи.
 * `ChoiceChips` — коли варіантів мало (до ~6): вибір одним дотиком, без списку взагалі.
 */

/** Клас для базового поля Input: накладається поверх базового, tailwind-merge прибирає старі розміри. */
export const FIELD_CLASS =
  "h-12 rounded-[13px] border-[1.5px] border-[color:var(--ds-border)] bg-[var(--ds-surface2)] px-3.5 text-[16px] font-semibold text-foreground";

/** Клас для базового Textarea: ті самі рамка й шрифт, висота — за вмістом. */
export const AREA_CLASS =
  "min-h-[96px] rounded-[13px] border-[1.5px] border-[color:var(--ds-border)] bg-[var(--ds-surface2)] px-3.5 py-3 text-[16px] leading-snug text-foreground md:min-h-[96px] md:text-[16px] focus-visible:ring-[#2BBFAA] focus-visible:ring-offset-0 focus-visible:border-[#2BBFAA]";

const LABEL_CLASS = "mb-1.5 block text-[14px] font-extrabold leading-tight";

/**
 * Той самий вигляд підпису для базового Radix `Label` — там, де форму переводять у канон
 * механічно й підпис лишається тим самим компонентом (копія уроку в «Розкладі»).
 */
export const FIELD_LABEL_CLASS = `${LABEL_CLASS} text-[color:var(--sub)] md:text-[14px]`;

/** Підпис поля. `htmlFor` — для поля з id; без нього рендериться `<div>` (підпис групи кнопок). */
export function FieldLabel({
  htmlFor, id, children, className, hint,
}: {
  htmlFor?: string;
  id?: string;
  children: React.ReactNode;
  className?: string;
  /** сірий хвостик у тому ж рядку: «(необовʼязково)» */
  hint?: React.ReactNode;
}) {
  const body = (
    <>
      {children}
      {hint ? <span className="ml-1 font-semibold text-muted-foreground">{hint}</span> : null}
    </>
  );
  const style = { color: "var(--sub)" } as React.CSSProperties;
  return htmlFor
    ? <label htmlFor={htmlFor} id={id} className={cn(LABEL_CLASS, className)} style={style}>{body}</label>
    : <div id={id} className={cn(LABEL_CLASS, className)} style={style}>{body}</div>;
}

/** Рідний вибір у вигляді поля канону. Порожнє значення (`value=""`) малюється сірим, як підказка. */
export const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { wrapClassName?: string }
>(({ className, wrapClassName, children, value, id, ...props }, ref) => (
  <div className={cn("relative w-full", wrapClassName)}>
    <select
      id={id}
      ref={ref}
      value={value}
      className={cn(
        "h-12 w-full appearance-none rounded-[13px] border-[1.5px] border-[color:var(--ds-border)] bg-[var(--ds-surface2)] pl-3.5 pr-10 text-[16px] font-semibold outline-none focus-visible:border-[#2BBFAA] focus-visible:ring-2 focus-visible:ring-[#2BBFAA] disabled:cursor-not-allowed disabled:opacity-50",
        value === "" || value == null ? "text-muted-foreground" : "text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown aria-hidden className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
  </div>
));
NativeSelect.displayName = "NativeSelect";

export interface ChoiceOption<T extends string> { value: T; label: React.ReactNode; disabled?: boolean; /** повна назва для скрінрідера, коли на кнопці скорочення («Пн») */ ariaLabel?: string }

/** Вибір одного з кількох кнопками (radiogroup). Кнопка — 44px, обраний — бірюзова рамка й фон. */
export function ChoiceChips<T extends string>({
  value, onChange, options, labelledBy, ariaLabel, className, stretch = false, compact = false,
}: {
  value: T | "";
  onChange: (v: T) => void;
  options: ChoiceOption<T>[];
  labelledBy?: string;
  ariaLabel?: string;
  className?: string;
  /** кнопки діляться порівну на всю ширину (2–3 варіанти) */
  stretch?: boolean;
  /** без бічних відступів — для ряду з семи днів тижня */
  compact?: boolean;
}) {
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} aria-label={ariaLabel} className={cn("flex flex-wrap", compact ? "gap-1.5" : "gap-2", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.ariaLabel}
            disabled={o.disabled}
            data-choice-chip=""
            onClick={() => onChange(o.value)}
            className={cn(
              "min-h-[44px] rounded-[13px] border-[1.5px] text-[15px] font-semibold transition-colors disabled:opacity-50",
              compact ? "min-w-[44px] px-0" : "px-4",
              stretch && "flex-1",
            )}
            style={on
              ? { background: "var(--teal-l)", borderColor: "var(--teal)", color: "var(--teal-text)" }
              : { background: "var(--ds-surface2)", borderColor: "var(--ds-border)", color: "var(--ds-txt)" }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
