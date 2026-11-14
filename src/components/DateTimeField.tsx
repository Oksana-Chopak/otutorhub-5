import * as React from "react";
import { useTranslation } from "react-i18next";
import { uk, sv, enGB } from "date-fns/locale";
import type { Locale } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TimeZoneNote, type ZonePerson } from "@/components/TimeZoneNote";
import { getLocale } from "@/lib/locale";

/**
 * ЄДИНЕ затверджене поле дати-часу для форм уроків/оплат (рішення власниці:
 * однакові форми скрізь). Легасі-патерн сирих інпутів у грошових/урочних
 * формах заборонений розтяжкою №8.
 *
 * 06.11 — ЧОМУ ТУТ БІЛЬШЕ НЕМА НАТИВНОГО `datetime-local`. Власниця:
 * «календар неправильного формату, ми домовилися всюди застосовувати
 * 24-годинний формат і дружній до мобілок скрол вибору дати і часу».
 * Нативне поле бере формат з ОПЕРАЦІЙНОЇ СИСТЕМИ, а не з мови застосунку:
 * на її Mac воно показувало AM/PM, і жодним атрибутом чи стилем це не
 * змінюється — специфікація не дає такої ручки. Тому вибір дати й часу тепер
 * наш: календар мовою застосунку з тижнем від понеділка і дві колонки-скрол
 * (години 00–23, хвилини по 5) з цілями дотику 44px. Формат — ЗАВЖДИ 24
 * години (`hourCycle: "h23"`), однаково на всіх пристроях і в усіх трьох
 * мовах.
 *
 * Значення назовні не змінилось: "YYYY-MM-DDTHH:mm" у локальному часі — тож
 * усі сім форм, що вже цим полем користуються, лишаються як є.
 *
 * C3 (доступність): мітка звʼязана з кнопкою через htmlFor/id (useId), колонки
 * — listbox зі стрілками й Home/End, вибране має aria-selected. Раніше
 * скрінрідер називав ці поля «поле вводу» — людина чула тип, але не чула, ЩО
 * саме вводить.
 */

const ITEM = 44; // висота пункту = ціль дотику

function dfLocale(): Locale {
  const l = getLocale();
  return l.startsWith("sv") ? sv : l.startsWith("en") ? enGB : uk;
}

/** "YYYY-MM-DD" → Date у локальному часі (не UTC: `new Date("2026-11-12")` — це UTC). */
function ymdToDate(ymd: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
}
function dateToYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** Час «зараз», округлений уперед до 5 хвилин — лише як підказка для порожнього поля. */
function nowHm(): string {
  const d = new Date();
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function splitValue(v: string): { ymd: string; hm: string } {
  const [d = "", t = ""] = (v || "").split("T");
  return { ymd: /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "", hm: /^\d{2}:\d{2}/.test(t) ? t.slice(0, 5) : "" };
}

/** Дата словами мовою застосунку. 24 години — завжди, незалежно від системи. */
export function formatYmdHm(v: string, opts: { withTime?: boolean } = {}): string {
  const { ymd, hm } = splitValue(v);
  const d = ymdToDate(ymd);
  if (!d) return "";
  const date = new Intl.DateTimeFormat(getLocale(), { weekday: "short", day: "numeric", month: "short" }).format(d);
  return opts.withTime && hm ? `${date} · ${hm}` : date;
}

const triggerCls = (invalid: boolean) =>
  `tap-44 bg-secondary text-foreground flex h-11 min-w-0 items-center gap-2 rounded-[10px] border px-3 text-left text-[16px] ${
    invalid ? "border-destructive ring-1 ring-destructive" : "border-border"
  }`;

/** Колонка-скрол: пункт по 44px, вибраний у центрі; дотик, прокрутка і клавіші. */
function Wheel({
  label, options, value, onPick,
}: {
  label: string;
  options: Array<{ v: string; disabled?: boolean }>;
  value: string;
  onPick: (v: string) => void;
}) {
  const box = React.useRef<HTMLDivElement>(null);
  const quiet = React.useRef(false);
  const idx = Math.max(0, options.findIndex((o) => o.v === value));

  // Центруємо вибране, коли колонка зʼявилась. Далі веде прокрутка людини —
  // інакше програмний скрол і вибір штовхали б одне одного.
  React.useEffect(() => {
    const el = box.current;
    if (!el) return;
    quiet.current = true;
    el.scrollTop = idx * ITEM;
    const id = setTimeout(() => { quiet.current = false; }, 80);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = () => {
    const el = box.current;
    if (!el || quiet.current) return;
    const i = Math.round(el.scrollTop / ITEM);
    const o = options[Math.min(options.length - 1, Math.max(0, i))];
    if (o && !o.disabled && o.v !== value) onPick(o.v);
  };

  const step = (delta: number) => {
    for (let i = idx + delta; i >= 0 && i < options.length; i += delta) {
      if (!options[i].disabled) { onPick(options[i].v); box.current?.scrollTo?.({ top: i * ITEM }); return; }
    }
  };

  return (
    <div className="min-w-0 flex-1">
      <div className="text-muted-foreground mb-1 text-center text-[13px] font-semibold">{label}</div>
      <div className="relative">
        <div
          ref={box}
          role="listbox"
          aria-label={label}
          tabIndex={0}
          onScroll={onScroll}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); step(1); }
            else if (e.key === "ArrowUp") { e.preventDefault(); step(-1); }
            else if (e.key === "Home") { e.preventDefault(); step(-options.length); }
            else if (e.key === "End") { e.preventDefault(); step(options.length); }
          }}
          className="border-border h-[132px] snap-y snap-mandatory overflow-y-auto rounded-[10px] border"
          style={{ scrollbarWidth: "none" }}
        >
          <div style={{ height: ITEM }} aria-hidden="true" />
          {options.map((o) => (
            <button
              key={o.v}
              type="button"
              role="option"
              aria-selected={o.v === value}
              disabled={o.disabled}
              onClick={() => onPick(o.v)}
              className={`flex w-full snap-center items-center justify-center text-[17px] tabular-nums disabled:opacity-30 ${
                o.v === value ? "text-foreground font-bold" : "text-muted-foreground"
              }`}
              style={{ height: ITEM }}
            >
              {o.v}
            </button>
          ))}
          <div style={{ height: ITEM }} aria-hidden="true" />
        </div>
        <div className="border-primary/40 pointer-events-none absolute inset-x-0 top-[44px] h-[44px] rounded-[8px] border-y" aria-hidden="true" />
      </div>
    </div>
  );
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

function TimeWheels({ hm, min, onChange }: { hm: string; min?: string; onChange: (hm: string) => void }) {
  const { t } = useTranslation();
  const [h, m] = (hm || "00:00").split(":");
  // Нижня межа: пункти, які дали б час раніше за дозволений, не вибираються —
  // замість того, щоб тихо підтягнути значення вгору.
  const minH = min?.slice(0, 2);
  const minM = min?.slice(3, 5);
  return (
    <div className="flex items-end gap-2">
      <Wheel label={t("common.hour")} value={h}
        options={HOURS.map((v) => ({ v, disabled: minH ? v < minH : false }))}
        onPick={(v) => onChange(`${v}:${minH && v === minH && minM && m < minM ? minM : m}`)} />
      <Wheel label={t("common.minute")} value={m}
        options={MINUTES.map((v) => ({ v, disabled: minH && minM ? h === minH && v < minM : false }))}
        onPick={(v) => onChange(`${h}:${v}`)} />
    </div>
  );
}

function MonthGrid({ ymd, min, onPick }: { ymd: string; min?: string; onPick: (ymd: string) => void }) {
  const selected = ymdToDate(ymd);
  const minDate = min ? ymdToDate(min) : undefined;
  return (
    <Calendar
      mode="single"
      showOutsideDays={false}
      locale={dfLocale()}
      weekStartsOn={1}
      selected={selected}
      defaultMonth={selected ?? new Date()}
      disabled={minDate ? { before: minDate } : undefined}
      onSelect={(d) => { if (d) onPick(dateToYmd(d)); }}
      classNames={{
        head_cell: "text-muted-foreground w-11 font-normal text-[13px]",
        row: "flex w-full",
        month: "space-y-1",
        cell: "h-11 w-11 text-center p-0 relative",
        day: "tap-44 h-11 w-11 rounded-[10px] text-[15px] font-semibold hover:bg-accent aria-selected:opacity-100",
        caption: "flex justify-center pt-0 pb-1 relative items-center",
        caption_label: "text-[15px] font-bold capitalize",
        nav_button: "tap-44 h-11 w-11 rounded-[10px] hover:bg-accent inline-flex items-center justify-center",
      }}
      className="p-2"
    />
  );
}

export function DateTimeField({
  value, onChange, min, label, durationMin, onDurationChange, className = "", invalid = false, describedBy,
  zoneNote = "self", zonePeople,
}: {
  /** Люди, яких стосується цей час, з їхніми поясами — позначка назве їхній час поіменно. */
  zonePeople?: ZonePerson[];
  /** 14.11: під полем — чий це час («За твоїм часом: Стокгольм (GMT+1)»). "others" додає
      «кожен учасник побачить урок за своїм місцевим часом»; false — коли позначку поруч уже
      показує сама форма (темна картка часу у формі уроку). */
  zoneNote?: false | "self" | "others";
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
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState<"date" | "time">("date");
  const { ymd, hm } = splitValue(value);
  const mn = splitValue(min ?? "");
  const minTimeToday = mn.ymd && mn.ymd === ymd ? mn.hm : undefined;

  const set = (nextYmd: string, nextHm: string) => onChange(`${nextYmd}T${nextHm}`);

  return (
    <div className={className}>
      {label && (
        <label htmlFor={uid} className="text-muted-foreground mb-1 block text-[13px] font-semibold">{label}</label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button id={uid} type="button" aria-label={label ?? t("common.chooseDateTime")}
              aria-invalid={invalid || undefined} aria-describedby={describedBy}
              // 14.11: «сб, 14 лист. · 14:00» не переноситься у три рядки поза кнопкою — у вузькому
              // рядку на новий рядок іде тривалість, а не текст дати
              style={{ minWidth: "11rem" }}
              className={`${triggerCls(invalid)} flex-1 whitespace-nowrap`}>
              {ymd ? `${formatYmdHm(value)} · ${hm}` : <span className="text-muted-foreground">{t("common.chooseDateTime")}</span>}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[320px] p-0" align="start">
            {/* Дата й час — двома кроками, а не однією довгою панелею: на
                телефоні календар + колонки часу не влазять в екран, і час
                опинявся нижче краю — людина його просто не бачила. Підписи
                кроків показують поточні значення, тож видно обидва одразу. */}
            <div role="tablist" aria-label={t("common.chooseDateTime")} className="border-border flex gap-1 border-b p-2">
              {([["date", ymd ? formatYmdHm(value) : t("common.chooseDate")],
                 ["time", hm || t("common.chooseTime")]] as const).map(([k, caption]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k}
                  onClick={() => setTab(k)}
                  className={`tap-44 h-11 min-w-0 flex-1 truncate rounded-[10px] text-[15px] font-bold ${
                    tab === k ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
                  }`}>
                  {caption}
                </button>
              ))}
            </div>
            <div role="tabpanel" className="max-h-[52vh] overflow-y-auto p-2">
              {tab === "date" ? (
                <MonthGrid ymd={ymd || dateToYmd(new Date())} min={mn.ymd || undefined}
                  onPick={(d) => { set(d, hm || nowHm()); setTab("time"); }} />
              ) : (
                <TimeWheels hm={hm || nowHm()} min={minTimeToday} onChange={(v) => set(ymd || dateToYmd(new Date()), v)} />
              )}
            </div>
            <div className="border-border border-t p-2">
              <button type="button" onClick={() => setOpen(false)}
                className="tap-44 bg-primary text-primary-foreground h-11 w-full rounded-[10px] text-[15px] font-bold">
                {t("common.done")}
              </button>
            </div>
          </PopoverContent>
        </Popover>
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
      {zoneNote && <TimeZoneNote at={value} others={zoneNote === "others"} people={zonePeople} className="mt-1.5" />}
    </div>
  );
}

/** Те саме затверджене поле — лише ДАТА. */
export function DateField({ value, onChange, min, label, invalid = false, className = "" }: {
  value: string; onChange: (v: string) => void; min?: string; label?: string; invalid?: boolean; className?: string;
}) {
  const { t } = useTranslation();
  const uid = React.useId();
  const [open, setOpen] = React.useState(false);
  return (
    <div className={className}>
      {label && <label htmlFor={uid} className="text-muted-foreground mb-1 block text-[13px] font-semibold">{label}</label>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button id={uid} type="button" aria-label={label ?? t("common.date")} aria-invalid={invalid || undefined}
            className={`${triggerCls(invalid)} w-full`}>
            {value ? formatYmdHm(`${value}T00:00`) : <span className="text-muted-foreground">{t("common.chooseDate")}</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] max-h-[70vh] overflow-y-auto p-3" align="start">
          <MonthGrid ymd={value} min={min} onPick={(d) => { onChange(d); setOpen(false); }} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Те саме затверджене поле — лише ЧАС (24 години завжди). */
export function TimeField({ value, onChange, label, invalid = false, className = "" }: {
  value: string; onChange: (v: string) => void; label?: string; invalid?: boolean; className?: string;
}) {
  const { t } = useTranslation();
  const uid = React.useId();
  const [open, setOpen] = React.useState(false);
  const hm = /^\d{2}:\d{2}/.test(value) ? value.slice(0, 5) : "";
  return (
    <div className={className}>
      {label && <label htmlFor={uid} className="text-muted-foreground mb-1 block text-[13px] font-semibold">{label}</label>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button id={uid} type="button" aria-label={label ?? t("common.time")} aria-invalid={invalid || undefined}
            className={`${triggerCls(invalid)} w-full tabular-nums`}>
            {hm || <span className="text-muted-foreground">{t("common.chooseTime")}</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[260px] p-3" align="start">
          <TimeWheels hm={hm || nowHm()} onChange={onChange} />
          <button type="button" onClick={() => setOpen(false)}
            className="tap-44 bg-primary text-primary-foreground mt-3 h-11 w-full rounded-[10px] text-[15px] font-bold">
            {t("common.done")}
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
