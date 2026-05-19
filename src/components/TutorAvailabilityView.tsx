import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, CalendarClock, ChevronLeft, ChevronRight } from "lucide-react";
import {
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);
  WEEKDAYS_FULL_UK,
  computeAvailableForDate,
  splitIntoSlots,
  buildLocalDate,
  minutesToHHMM,
  toLocalISODate,
  type WeeklyRow,
  type OverrideRow,
  type BookedRow,
} from "@/lib/availability";

interface TutorCalendarProps {
  tutorId: string;
  tutorName: string;
}

const DAYS_AHEAD = 14;
const SLOT_MINUTES = 60;

/**
 * Read-only календар вільних годин репетитора для учня.
 * Учень НЕ може створювати уроки чи надсилати запити —
 * він лише бачить, коли його репетитор вільний, а далі домовляється
 * з репетитором у чаті. Уроки створює тільки репетитор або менеджер.
 */
export function TutorAvailabilityView({ tutorId, tutorName }: TutorCalendarProps) {
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

  const days = useMemo(() => {
    const arr: { date: Date; slots: { start: number; end: number }[] }[] = [];
    const start = new Date();
    start.setDate(start.getDate() + weekOffset * 7);
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
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
  }, [weekly, overrides, booked, weekOffset]);

  // Whether at least one slot exists across the rendered week
  const hasAnySlotInView = days.some((d) => d.slots.length > 0);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-display text-base font-semibold text-foreground flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-primary" />
            Доступні години — {tutorName}
          </h3>
          <p className="text-xs text-muted-foreground">
            Найближчі 14 днів. Щоб домовитися про урок — напишіть репетитору в чат.
          </p>
        </div>
        {hasWeekly || hasPositiveOverride ? (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => setWeekOffset((v) => Math.max(0, v - 1))}
              disabled={weekOffset === 0}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => setWeekOffset((v) => Math.min(1, v + 1))}
              disabled={weekOffset === 1}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !hasWeekly && !hasPositiveOverride ? (
        <p className="text-center text-sm text-muted-foreground py-6">
          {hasAnySchedule
            ? t("tutorAvailability.noHours")
            : t("tutorAvailability.notSet")}
        </p>
      ) : !hasAnySlotInView ? (
        <p className="text-center text-sm text-muted-foreground py-6">
          У цьому тижні немає вільних слотів. Перегляньте наступний тиждень або напишіть репетитору в чат.
        </p>
      ) : (
        <div className="grid grid-cols-7 gap-1.5">
          {days.map(({ date, slots }) => {
            const isToday = toLocalISODate(date) === toLocalISODate(new Date());
            return (
              <div
                key={date.toISOString()}
                className={`rounded-lg border p-2 min-h-[120px] ${
                  isToday ? "border-primary/40 bg-primary/5" : "border-border"
                }`}
              >
                <p className="text-[10px] text-muted-foreground uppercase">
                  {WEEKDAYS_FULL_UK[date.getDay()].slice(0, 3)}
                </p>
                <p className="text-xs font-semibold text-foreground mb-2">
                  {date.getDate()}.{String(date.getMonth() + 1).padStart(2, "0")}
                </p>
                <div className="space-y-1">
                  {slots.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground italic">—</p>
                  ) : (
                    slots.map((s) => (
                      <div
                        key={s.start}
                        className="w-full text-[10px] font-mono rounded bg-primary/10 text-primary px-1 py-0.5"
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
    </div>
  );
}
