import * as React from "react";
import { useTranslation } from "react-i18next";

/**
 * ЄДИНЕ затверджене поле дати-часу для форм уроків/оплат (рішення власниці:
 * однакові форми скрізь). Один нативний datetime-local у стилі системи —
 * жодних роздільних «кошмарних» date+time. Легасі-патерн сирих інпутів у
 * грошових/урочних формах заборонений розтяжкою №8.
 *
 * C3 (доступність): мітка звʼязана з полем через htmlFor/id (useId), а не
 * лише візуально. Раніше скрінрідер називав ці поля «поле вводу» — людина
 * чула тип, але не чула, ЩО саме вводить. Поле тривалості має власне імʼя,
 * бо мітки поруч у нього немає взагалі.
 */
export function DateTimeField({
  value, onChange, min, label, durationMin, onDurationChange, className = "", invalid = false, describedBy,
}: {
  value: string;                       // "YYYY-MM-DDTHH:mm"
  onChange: (v: string) => void;
  min?: string;
  invalid?: boolean;
  describedBy?: string;
  label?: string;
  durationMin?: number;
  onDurationChange?: (m: number) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const uid = React.useId();
  return (
    <div className={className}>
      {label && (
        <label htmlFor={uid} className="text-muted-foreground mb-1 block text-[13px] font-semibold">{label}</label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={uid}
          aria-label={label ?? t("schedule.dateTime")}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          type="datetime-local"
          value={value}
          min={min}
          onChange={(e) => onChange(e.target.value)}
          className={`bg-secondary text-foreground h-11 min-w-0 flex-1 rounded-[10px] border px-2.5 text-[16px] ${invalid ? "border-destructive ring-1 ring-destructive" : "border-border"}`}
        />
        {typeof durationMin === "number" && onDurationChange && (
          <>
            <input
              aria-label={t("schedule.duration")}
              type="number" min={15} step={5} value={durationMin}
              onChange={(e) => onDurationChange(Math.max(15, Number(e.target.value) || 15))}
              className="bg-secondary text-foreground border-border h-11 w-[76px] rounded-[10px] border px-2.5 text-[16px]"
            />
            <span className="text-muted-foreground text-[13px]">{t("lessonDetails.durationUnit")}</span>
          </>
        )}
      </div>
    </div>
  );
}


/** Те саме затверджене поле — лише ДАТА. */
export function DateField({ value, onChange, min, label, invalid = false, className = "" }: {
  value: string; onChange: (v: string) => void; min?: string; label?: string; invalid?: boolean; className?: string;
}) {
  const { t } = useTranslation();
  const uid = React.useId();
  return (
    <div className={className}>
      {label && <label htmlFor={uid} className="text-muted-foreground mb-1 block text-[13px] font-semibold">{label}</label>}
      <input id={uid} aria-label={label ?? t("common.date")} aria-invalid={invalid || undefined}
        type="date" value={value} min={min} onChange={(e) => onChange(e.target.value)}
        className={`bg-secondary text-foreground h-11 w-full rounded-[10px] border px-2.5 text-[16px] ${invalid ? "border-destructive ring-1 ring-destructive" : "border-border"}`} />
    </div>
  );
}

/** Те саме затверджене поле — лише ЧАС. */
export function TimeField({ value, onChange, label, invalid = false, className = "" }: {
  value: string; onChange: (v: string) => void; label?: string; invalid?: boolean; className?: string;
}) {
  const { t } = useTranslation();
  const uid = React.useId();
  return (
    <div className={className}>
      {label && <label htmlFor={uid} className="text-muted-foreground mb-1 block text-[13px] font-semibold">{label}</label>}
      <input id={uid} aria-label={label ?? t("common.time")} aria-invalid={invalid || undefined}
        type="time" value={value} onChange={(e) => onChange(e.target.value)}
        className={`bg-secondary text-foreground h-11 w-full rounded-[10px] border px-2.5 text-[16px] ${invalid ? "border-destructive ring-1 ring-destructive" : "border-border"}`} />
    </div>
  );
}
