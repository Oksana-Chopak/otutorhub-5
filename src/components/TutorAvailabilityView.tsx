import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, CalendarClock, ChevronLeft, ChevronRight, CalendarPlus } from "lucide-react";
import i18nInstance from "@/i18n";
import {
  WEEKDAYS_FULL_UK,
  computeAvailableForDate,
  splitIntoSlots,
  slotsForViewer,
  buildLocalDate,
  minutesToHHMM,
  toLocalISODate,
  type WeeklyRow,
  type OverrideRow,
  type BookedRow,
} from "@/lib/availability";

import { useTimeZones } from "@/hooks/useTimeZones";
import { deviceTimeZone, sameClock, zoneLabel } from "@/lib/timeZone";
import { TimeZoneNote } from "@/components/TimeZoneNote";
import { getLocale } from "@/lib/locale";

const t = i18nInstance.t.bind(i18nInstance);

interface TutorCalendarProps {
  tutorId: string;
  tutorName: string;
  /** 21.11 (рішення власниці п. 4): учень обирає вільну годину — і одразу просить урок.
      Тоді години — кнопками по днях (зона дотику 44px), а не дрібною сіткою на 7 стовпців. */
  onPickSlot?: (at: Date) => void;
  /** Разом з onPickSlot: «попросити урок на інший час». Кнопка живе в самій картці й стає
      головною, коли вільних годин немає (тоді це єдина дія). */
  onPickOther?: () => void;
}

const DAYS_AHEAD = 14;
const SLOT_MINUTES = 60;

/**
 * Календар вільних годин репетитора для учня.
 * Учень НЕ створює уроків — їх ставить лише репетитор або менеджер. Але з 21.11 він може
 * одним дотиком по вільній годині ПОПРОСИТИ урок (`onPickSlot`): репетитор отримує
 * сповіщення, а дотик по ньому відкриває форму уроку вже з цим учнем і цим часом.
 */
export function TutorAvailabilityView({ tutorId, tutorName, onPickSlot, onPickOther }: TutorCalendarProps) {
  const pick = !!onPickSlot;
  const [loading, setLoading] = useState(true);
  const [weekly, setWeekly] = useState<WeeklyRow[]>([]);
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [booked, setBooked] = useState<BookedRow[]>([]);
  const [weekOffset, setWeekOffset] = useState(0);

  const load = async () => {
    setLoading(true);
    const today = toLocalISODate(new Date());
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + DAYS_AHEAD);
    const horizonIso = toLocalISODate(horizon);

    const [wRes, oRes, lRes] = await Promise.all([
      supabase.from("tutor_availability_weekly").select("*").eq("tutor_id", tutorId),
      supabase
        .from("tutor_availability_overrides")
        .select("*")
        .eq("tutor_id", tutorId)
        .gte("slot_date", today)
        .lte("slot_date", horizonIso),
      supabase
        .from("lessons_visible")
        .select("starts_at, duration_minutes")
        .eq("tutor_id", tutorId)
        .gte("starts_at", new Date().toISOString())
        .in("status", ["pending", "scheduled"]),
    ]);
    setWeekly((wRes.data ?? []) as WeeklyRow[]);
    setOverrides((oRes.data ?? []) as OverrideRow[]);
    setBooked((lRes.data ?? []) as BookedRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [tutorId]);

  // Differentiate three states:
  //   1) tutor has never set anything → "ще не вказав години"
  //   2) tutor set hours / overrides, but next 14 days have no free slots → "немає вільних слотів"
  //   3) tutor has free slots → render calendar
  const hasWeekly = weekly.length > 0;
  const hasPositiveOverride = overrides.some((o) => o.is_available);
  const hasAnySchedule = hasWeekly || hasPositiveOverride || overrides.length > 0;

  /* 14.11: години репетитора записані ЙОГО місцевим часом. Якщо той, хто дивиться, у іншому
     поясі (менеджерка в Стокгольмі, репетиторка в Києві) — рахуємо в часі репетитора й
     показуємо на годиннику глядача (`slotsForViewer`). Пояс репетитора невідомий або той самий —
     шлях як був. */
  const tutorZones = useTimeZones([tutorId]);
  const tutorTz = tutorZones[tutorId];
  const myTz = deviceTimeZone();
  const converted = !!tutorTz && !sameClock(tutorTz, myTz);

  const days = useMemo(() => {
    const arr: { date: Date; slots: { start: number; end: number }[] }[] = [];
    const start = new Date();
    start.setDate(start.getDate() + weekOffset * 7);
    const dates: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      dates.push(d);
    }
    if (converted && tutorTz) {
      const byDay = slotsForViewer({
        viewerDates: dates.map(toLocalISODate), weekly, overrides, booked,
        tutorTz, viewerTz: myTz, slotMinutes: SLOT_MINUTES,
      });
      for (const d of dates) arr.push({ date: d, slots: byDay[toLocalISODate(d)] ?? [] });
      return arr;
    }
    for (const d of dates) {
      const intervals = computeAvailableForDate(d, weekly, overrides, booked);
      const slots = splitIntoSlots(intervals, SLOT_MINUTES);
      const now = new Date();
      const filtered = slots.filter((s) => {
        const slotDate = buildLocalDate(d, s.start);
        return slotDate.getTime() > now.getTime();
      });
      arr.push({ date: d, slots: filtered });
    }
    return arr;
  }, [weekly, overrides, booked, weekOffset, converted, tutorTz, myTz]);

  // Whether at least one slot exists across the rendered week
  const hasAnySlotInView = days.some((d) => d.slots.length > 0);

  return (
    <div className="rounded-[16px] border-[0.5px] border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-display text-base font-semibold text-foreground flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-primary" />
            {t("tutorAvailability.title", { name: tutorName })}
          </h3>
          <p className="text-[14px] text-muted-foreground">
            {t(pick ? "askLesson.next14Pick" : "tutorAvailability.next14")}
          </p>
          {converted && tutorTz && (
            <div className="mt-1">
              <TimeZoneNote />
              <p data-tz-note="" className="pl-5 text-[13px] leading-snug text-muted-foreground">
                {t("timeZone.convertedFrom", { zone: zoneLabel(tutorTz) })}
              </p>
            </div>
          )}
        </div>
        {hasWeekly || hasPositiveOverride ? (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11"
              onClick={() => setWeekOffset((v) => Math.max(0, v - 1))}
              disabled={weekOffset === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11"
              onClick={() => setWeekOffset((v) => Math.min(1, v + 1))}
              disabled={weekOffset === 1}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !hasWeekly && !hasPositiveOverride ? (
        <p className={pick ? "text-[14px] text-muted-foreground" : "text-center text-sm text-muted-foreground py-6"}>
          {pick
            ? t("askLesson.noHoursPick")
            : hasAnySchedule
            ? t("tutorAvailability.noHours")
            : t("tutorAvailability.notSet")}
        </p>
      ) : !hasAnySlotInView ? (
        <p className={pick ? "text-[14px] text-muted-foreground" : "text-center text-sm text-muted-foreground py-6"}>
          {t(pick ? "askLesson.noSlotsPick" : "tutorAvailability.noSlotsThisWeek")}
        </p>
      ) : onPickSlot ? (
        <ul data-pick-slots="" className="space-y-3" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {days.filter((d) => d.slots.length > 0).map(({ date, slots }) => (
            <li key={date.toISOString()}>
              <p className="text-[14px] font-semibold text-foreground">
                {date.toLocaleDateString(getLocale(), { weekday: "long", day: "numeric", month: "long" })}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {slots.map((s) => (
                  <button
                    key={s.start}
                    type="button"
                    data-slot=""
                    onClick={() => onPickSlot(buildLocalDate(date, s.start))}
                    aria-label={t("askLesson.slotAria", { time: minutesToHHMM(s.start) })}
                    className="min-h-[44px] rounded-[12px] px-3.5 text-[15px] font-bold"
                    style={{ border: "1.5px solid rgba(43,191,170,.45)", background: "var(--teal-l,#f0fdf9)", color: "var(--teal-text,#0F6E56)", cursor: "pointer" }}
                  >
                    {minutesToHHMM(s.start)}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid grid-cols-7 gap-1.5">
          {days.map(({ date, slots }) => {
            const isToday = toLocalISODate(date) === toLocalISODate(new Date());
            return (
              <div
                key={date.toISOString()}
                className={`rounded-[12px] border p-2 min-h-[120px] ${
                  isToday ? "border-primary/40 bg-primary/5" : "border-border"
                }`}
              >
                <p className="text-[14px] text-muted-foreground uppercase">
                  {WEEKDAYS_FULL_UK[date.getDay()].slice(0, 3)}
                </p>
                <p className="text-[14px] font-semibold text-foreground mb-2">
                  {date.getDate()}.{String(date.getMonth() + 1).padStart(2, "0")}
                </p>
                <div className="space-y-1">
                  {slots.length === 0 ? (
                    <p className="text-[14px] text-muted-foreground italic">—</p>
                  ) : (
                    slots.map((s) => (
                      <div
                        key={s.start}
                        className="w-full text-[14px] font-mono rounded-[8px] bg-primary/10 text-primary px-1 py-0.5"
                        title={`${minutesToHHMM(s.start)} — ${minutesToHHMM(s.end)}`}
                      >
                        {minutesToHHMM(s.start)}
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {pick && onPickOther && !loading && (() => {
        const none = !hasAnySlotInView;
        return (
          <button type="button" data-ask-other="" onClick={onPickOther}
            className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-[13px] text-[15px] font-bold"
            style={none
              ? { background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", border: "none", cursor: "pointer" }
              : { border: "1px solid var(--ds-border,#eceef3)", background: "var(--ds-surface,#fff)", color: "var(--ds-txt,#0f0f1a)", cursor: "pointer" }}>
            <CalendarPlus className="h-[17px] w-[17px]" /> {t(none ? "askLesson.title" : "askLesson.otherTime")}
          </button>
        );
      })()}
    </div>
  );
}
