import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export interface CalendarLesson {
  id: string;
  starts_at: string;
  duration_minutes: number;
  subject: string;
  status: "pending" | "scheduled" | "completed" | "cancelled";
  tutor_id: string;
  student_id: string;
  student_price?: number | null;
  student_payment_status?: "paid" | "unpaid" | null;
}

interface Props {
  weekStart: Date; // any date in the desired week
  lessons: CalendarLesson[];
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onLessonClick?: (lesson: CalendarLesson) => void;
  onSlotClick?: (date: Date) => void;
  nameOf: (id: string) => string;
}

const HOUR_HEIGHT = 48; // px per hour
const START_HOUR = 7; // 07:00
const END_HOUR = 23; // 23:00
const HOURS = END_HOUR - START_HOUR;

const statusColor: Record<CalendarLesson["status"], string> = {
  pending: "bg-warning/15 border-warning/40 text-warning hover:bg-warning/25",
  scheduled: "bg-primary/15 border-primary/40 text-primary hover:bg-primary/25",
  completed: "bg-success/15 border-success/40 text-success hover:bg-success/25",
  cancelled:
    "bg-destructive/15 border-destructive/40 text-destructive line-through hover:bg-destructive/25",
};

function startOfWeek(d: Date) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // Mon=0
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatRange(weekStart: Date) {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  const sameMonth = weekStart.getMonth() === end.getMonth();
  const opt: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  if (sameMonth) {
    return `${weekStart.getDate()}–${end.toLocaleDateString("uk-UA", opt)}`;
  }
  return `${weekStart.toLocaleDateString("uk-UA", opt)} – ${end.toLocaleDateString(
    "uk-UA",
    opt
  )}`;
}

export function WeekCalendar({
  weekStart,
  lessons,
  onPrev,
  onNext,
  onToday,
  onLessonClick,
  onSlotClick,
  nameOf,
}: Props) {
  const { t } = useTranslation();
  const WEEKDAYS = [
    t("weekCalendar.mon"),
    t("weekCalendar.tue"),
    t("weekCalendar.wed"),
    t("weekCalendar.thu"),
    t("weekCalendar.fri"),
    t("weekCalendar.sat"),
    t("weekCalendar.sun"),
  ];
  const start = useMemo(() => startOfWeek(weekStart), [weekStart]);
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        return d;
      }),
    [start]
  );

  const todayKey = new Date().toDateString();

  // Live "now" indicator: tick every minute so the red line stays accurate
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const now = new Date(nowTick);
  const nowMinutesFromStart =
    (now.getHours() - START_HOUR) * 60 + now.getMinutes();
  const showNowLine =
    nowMinutesFromStart >= 0 && nowMinutesFromStart <= HOURS * 60;
  const nowTopPx = (nowMinutesFromStart / 60) * HOUR_HEIGHT;
  const todayColIndex = days.findIndex((d) => d.toDateString() === todayKey);

  // Auto-scroll to current hour when the current week is visible
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const didScrollRef = useRef(false);
  useEffect(() => {
    if (didScrollRef.current) return;
    if (todayColIndex < 0 || !showNowLine) return;
    const el = scrollRef.current;
    if (!el) return;
    // Try to center the now-line; offset back by ~2 hours for context
    const target = Math.max(0, nowTopPx - HOUR_HEIGHT * 2);
    el.scrollTop = target;
    didScrollRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayColIndex, showNowLine]);

  const lessonsByDay = useMemo(() => {
    const map = new Map<string, CalendarLesson[]>();
    days.forEach((d) => map.set(d.toDateString(), []));
    lessons.forEach((l) => {
      const k = new Date(l.starts_at).toDateString();
      if (map.has(k)) map.get(k)!.push(l);
    });
    return map;
  }, [lessons, days]);

  return (
    <div className="rounded-xl border border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <Button variant="outline" size="sm" onClick={onToday} className="gap-1.5">
          <CalendarDays className="h-3.5 w-3.5" />
          {t("weekCalendar.today")}
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onPrev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium text-foreground min-w-[120px] text-center">
            {formatRange(start)}
          </span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <span className="text-xs text-muted-foreground hidden sm:block">
          {start.getFullYear()}
        </span>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-[40px_repeat(7,1fr)] border-b border-border bg-secondary/30">
        <div />
        {days.map((d, i) => {
          const isToday = d.toDateString() === todayKey;
          return (
            <div
              key={i}
              className={cn(
                "px-1 py-2 text-center text-xs",
                isToday ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground"
              )}
            >
              <div>{WEEKDAYS[i]}</div>
              <div
                className={cn(
                  "mt-0.5 text-sm font-medium",
                  isToday ? "text-primary" : "text-foreground"
                )}
              >
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Time grid */}
      <div ref={scrollRef} className="overflow-auto max-h-[70vh]">
        <div
          className="grid grid-cols-[40px_repeat(7,1fr)] relative"
          style={{ height: HOURS * HOUR_HEIGHT }}
        >
          {/* "Now" red line — spans the whole grid, highlighted on today's column */}
          {showNowLine && (
            <div
              className="pointer-events-none absolute left-0 right-0 z-20"
              style={{ top: nowTopPx }}
            >
              <div className="relative h-px bg-destructive">
                <span className="absolute -left-1 -top-[3px] inline-block h-1.5 w-1.5 rounded-full bg-destructive" />
                <span className="absolute -top-[8px] left-10 rounded bg-destructive px-1 py-px text-[9px] font-semibold text-destructive-foreground">
                  {now.toLocaleTimeString("uk-UA", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            </div>
          )}
          {/* Hour labels */}
          <div className="border-r border-border">
            {Array.from({ length: HOURS }, (_, i) => (
              <div
                key={i}
                className="text-[10px] text-muted-foreground text-right pr-1 border-b border-border/50"
                style={{ height: HOUR_HEIGHT }}
              >
                {String(START_HOUR + i).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((d, dayIdx) => {
            const isToday = d.toDateString() === todayKey;
            const dayLessons = lessonsByDay.get(d.toDateString()) ?? [];
            return (
              <div
                key={dayIdx}
                className={cn(
                  "relative border-r border-border last:border-r-0",
                  isToday && "bg-primary/[0.03]"
                )}
              >
                {/* Hour rows (clickable for slot create) */}
                {Array.from({ length: HOURS }, (_, h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => {
                      if (!onSlotClick) return;
                      const slot = new Date(d);
                      slot.setHours(START_HOUR + h, 0, 0, 0);
                      onSlotClick(slot);
                    }}
                    className="block w-full border-b border-border/50 hover:bg-primary/5 transition-colors"
                    style={{ height: HOUR_HEIGHT }}
                    aria-label={t("weekCalendar.createAt", { time: `${String(START_HOUR + h).padStart(2, "0")}:00` })}
                  />
                ))}

                {/* Lessons */}
                {dayLessons.map((l) => {
                  const startD = new Date(l.starts_at);
                  const startMin =
                    (startD.getHours() - START_HOUR) * 60 + startD.getMinutes();
                  const top = (startMin / 60) * HOUR_HEIGHT;
                  const height = Math.max(
                    20,
                    (l.duration_minutes / 60) * HOUR_HEIGHT - 2
                  );
                  if (top < 0 || top > HOURS * HOUR_HEIGHT) return null;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onLessonClick?.(l);
                      }}
                      className={cn(
                        "absolute left-0.5 right-0.5 z-10 rounded-md border px-1 py-0.5 text-left text-[10px] leading-tight overflow-hidden transition-colors",
                        statusColor[l.status]
                      )}
                      style={{ top, height }}
                    >
                      <div className="font-semibold truncate">
                        {startD.toLocaleTimeString("uk-UA", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        {l.subject}
                      </div>
                      <div className="truncate opacity-80">
                        {nameOf(l.student_id)}
                      </div>
                      {l.student_price != null && Number(l.student_price) > 0 && (
                        <div className="truncate opacity-90 mt-0.5">
                          {Number(l.student_price)} ₴
                          {l.student_payment_status === "paid" && " ✓"}
                          {l.student_payment_status === "unpaid" && " •"}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
