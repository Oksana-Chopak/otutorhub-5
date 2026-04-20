import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Loader2,
  CalendarClock,
  Bell,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
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
import { useAuth } from "@/hooks/useAuth";

interface TutorCalendarProps {
  tutorId: string;
  tutorName: string;
  /** if provided, used as default subject when booking */
  defaultSubject?: string;
}

const DAYS_AHEAD = 14;
const SLOT_MINUTES = 60;

export function TutorAvailabilityView({ tutorId, tutorName, defaultSubject }: TutorCalendarProps) {
  const { user, roles } = useAuth();
  const isStudent = roles.includes("student");
  const isManager = roles.includes("manager");

  const [loading, setLoading] = useState(true);
  const [weekly, setWeekly] = useState<WeeklyRow[]>([]);
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [booked, setBooked] = useState<BookedRow[]>([]);
  const [openRequest, setOpenRequest] = useState(false);
  const [requestMsg, setRequestMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [hasOpenRequest, setHasOpenRequest] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);

  const [bookSlot, setBookSlot] = useState<{ date: Date; start: number } | null>(null);
  const [booking, setBooking] = useState(false);
  const [subject, setSubject] = useState(defaultSubject ?? "");

  const load = async () => {
    setLoading(true);
    const today = toLocalISODate(new Date());
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + DAYS_AHEAD);
    const horizonIso = toLocalISODate(horizon);

    const [wRes, oRes, lRes, reqRes] = await Promise.all([
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
      user
        ? supabase
            .from("availability_requests")
            .select("id")
            .eq("tutor_id", tutorId)
            .eq("requester_id", user.id)
            .eq("status", "open")
            .limit(1)
        : Promise.resolve({ data: [] }),
    ]);
    setWeekly((wRes.data ?? []) as WeeklyRow[]);
    setOverrides((oRes.data ?? []) as OverrideRow[]);
    setBooked((lRes.data ?? []) as BookedRow[]);
    setHasOpenRequest(((reqRes as any).data ?? []).length > 0);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [tutorId, user?.id]);

  const hasAnyAvailability = weekly.length > 0 || overrides.some((o) => o.is_available);

  const days = useMemo(() => {
    const arr: { date: Date; slots: { start: number; end: number }[] }[] = [];
    const start = new Date();
    start.setDate(start.getDate() + weekOffset * 7);
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const intervals = computeAvailableForDate(d, weekly, overrides, booked);
      const slots = splitIntoSlots(intervals, SLOT_MINUTES);
      // filter past slots for today
      const now = new Date();
      const filtered = slots.filter((s) => {
        const slotDate = buildLocalDate(d, s.start);
        return slotDate.getTime() > now.getTime();
      });
      arr.push({ date: d, slots: filtered });
    }
    return arr;
  }, [weekly, overrides, booked, weekOffset]);

  const sendRequest = async () => {
    if (!user) return;
    setSending(true);
    const { error } = await supabase.from("availability_requests").insert({
      tutor_id: tutorId,
      requester_id: user.id,
      message: requestMsg.trim() || null,
    });
    setSending(false);
    if (error) {
      console.error(error);
      toast.error("Не вдалося надіслати запит");
      return;
    }
    toast.success("Запит надіслано — репетитор отримає сповіщення");
    setRequestMsg("");
    setOpenRequest(false);
    setHasOpenRequest(true);
  };

  const confirmBooking = async () => {
    if (!bookSlot || !user) return;
    if (!subject.trim()) {
      toast.error("Вкажіть предмет уроку");
      return;
    }
    setBooking(true);
    const startsAt = buildLocalDate(bookSlot.date, bookSlot.start).toISOString();
    const lessonInsert: any = {
      tutor_id: tutorId,
      student_id: user.id,
      created_by: user.id,
      starts_at: startsAt,
      duration_minutes: SLOT_MINUTES,
      subject: subject.trim(),
    };
    if (isStudent && !isManager) {
      lessonInsert.status = "pending";
      lessonInsert.student_payment_status = "unpaid";
      lessonInsert.tutor_payout_status = "unpaid";
      lessonInsert.student_price = 0;
      lessonInsert.tutor_payout = 0;
    }
    const { error } = await supabase.from("lessons").insert(lessonInsert);
    setBooking(false);
    if (error) {
      console.error(error);
      toast.error(error.message || "Не вдалося створити запит на урок");
      return;
    }
    toast.success("Урок запитано — очікуйте підтвердження");
    setBookSlot(null);
    load();
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-display text-base font-semibold text-foreground flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-primary" />
            Доступні години — {tutorName}
          </h3>
          <p className="text-xs text-muted-foreground">Найближчі 14 днів</p>
        </div>
        {hasAnyAvailability && (
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
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !hasAnyAvailability ? (
        <div className="text-center py-6 space-y-3">
          <p className="text-sm text-muted-foreground">
            Репетитор ще не вказав свої доступні години.
          </p>
          <Button
            variant="default"
            size="sm"
            onClick={() => setOpenRequest(true)}
            disabled={hasOpenRequest}
          >
            <Bell className="h-3.5 w-3.5 mr-1" />
            {hasOpenRequest ? "Запит уже надіслано" : "Запитати про доступні години"}
          </Button>
        </div>
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
                      <button
                        key={s.start}
                        type="button"
                        onClick={() => (isStudent || isManager) && setBookSlot({ date, start: s.start })}
                        disabled={!(isStudent || isManager)}
                        className="w-full text-[10px] font-mono rounded bg-primary/10 hover:bg-primary/20 disabled:hover:bg-primary/10 text-primary px-1 py-0.5 transition-colors"
                        title={`${minutesToHHMM(s.start)} — ${minutesToHHMM(s.end)}`}
                      >
                        {minutesToHHMM(s.start)}
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Request dialog */}
      <Dialog open={openRequest} onOpenChange={setOpenRequest}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Запит репетитору</DialogTitle>
            <DialogDescription>
              {tutorName} отримає сповіщення з проханням проставити доступні години.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="msg">Коментар (необов'язково)</Label>
            <Input
              id="msg"
              value={requestMsg}
              onChange={(e) => setRequestMsg(e.target.value)}
              placeholder="Напр.: на наступний тиждень"
              maxLength={200}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenRequest(false)} disabled={sending}>
              Скасувати
            </Button>
            <Button onClick={sendRequest} disabled={sending}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Надіслати
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Booking dialog */}
      <Dialog open={!!bookSlot} onOpenChange={(o) => !o && setBookSlot(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Запитати урок</DialogTitle>
            <DialogDescription>
              {bookSlot && (
                <>
                  {bookSlot.date.toLocaleDateString("uk-UA", { day: "2-digit", month: "long", weekday: "long" })} о{" "}
                  {minutesToHHMM(bookSlot.start)} — {tutorName}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="subj">Предмет</Label>
            <Input
              id="subj"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Напр.: Англійська"
              maxLength={100}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBookSlot(null)} disabled={booking}>
              Скасувати
            </Button>
            <Button onClick={confirmBooking} disabled={booking}>
              {booking ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {isStudent && !isManager ? "Запитати урок" : "Створити урок"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
