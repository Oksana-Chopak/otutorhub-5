import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
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
  CalendarClock,
  Loader2,
  Plus,
  Trash2,
  CalendarPlus,
  Bell,
  Check,
  X,
  Copy,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  WEEKDAYS_FULL_UK,
  WEEKDAYS_UK,
  hhmmToMinutes,
  minutesToHHMM,
} from "@/lib/availability";

interface WeeklyRow {
  id: string;
  tutor_id: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
}
interface OverrideRow {
  id: string;
  tutor_id: string;
  slot_date: string;
  start_minute: number;
  end_minute: number;
  is_available: boolean;
}
interface AvailabilityRequest {
  id: string;
  tutor_id: string;
  requester_id: string;
  message: string | null;
  status: "open" | "fulfilled" | "cancelled";
  created_at: string;
  acknowledged_at: string | null;
}
interface Profile {
  id: string;
  first_name: string;
  last_name: string;
}

const fullName = (p?: Profile) => (p ? `${p.first_name} ${p.last_name}`.trim() || "—" : "—");

export default function AvailabilityPage() {
  const { user, roles } = useAuth();
  const isManager = roles.includes("manager");
  const isTutor = roles.includes("tutor");

  const [tutors, setTutors] = useState<Profile[]>([]);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [selectedTutorId, setSelectedTutorId] = useState<string>("");
  const [weekly, setWeekly] = useState<WeeklyRow[]>([]);
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [requests, setRequests] = useState<AvailabilityRequest[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialogs
  const [weeklyDialog, setWeeklyDialog] = useState<{ open: boolean; weekday: number; from: string; to: string }>({
    open: false,
    weekday: 1,
    from: "16:00",
    to: "20:00",
  });
  const [overrideDialog, setOverrideDialog] = useState<{
    open: boolean;
    date: string;
    from: string;
    to: string;
    is_available: boolean;
  }>({ open: false, date: "", from: "10:00", to: "12:00", is_available: true });

  const tutorId = useMemo(() => {
    if (isTutor && !isManager) return user?.id ?? "";
    return selectedTutorId;
  }, [isTutor, isManager, user?.id, selectedTutorId]);

  const loadProfiles = async () => {
    const [tutorRolesRes, profilesRes] = await Promise.all([
      supabase.from("user_roles").select("user_id").eq("role", "tutor"),
      supabase.from("profiles").select("id, first_name, last_name"),
    ]);
    const tutorIds = new Set((tutorRolesRes.data ?? []).map((r) => r.user_id));
    const allProfiles = (profilesRes.data ?? []) as Profile[];
    setProfiles(new Map(allProfiles.map((p) => [p.id, p])));
    const tutorList = allProfiles.filter((p) => tutorIds.has(p.id));
    setTutors(tutorList);
    if (isManager && !selectedTutorId && tutorList.length > 0) {
      setSelectedTutorId(tutorList[0].id);
    }
  };

  const loadAvailability = async () => {
    if (!tutorId) {
      setWeekly([]);
      setOverrides([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [wRes, oRes] = await Promise.all([
      supabase
        .from("tutor_availability_weekly")
        .select("*")
        .eq("tutor_id", tutorId)
        .order("weekday")
        .order("start_minute"),
      supabase
        .from("tutor_availability_overrides")
        .select("*")
        .eq("tutor_id", tutorId)
        .gte("slot_date", new Date().toISOString().slice(0, 10))
        .order("slot_date")
        .order("start_minute"),
    ]);
    setWeekly((wRes.data ?? []) as WeeklyRow[]);
    setOverrides((oRes.data ?? []) as OverrideRow[]);
    setLoading(false);
  };

  const loadRequests = async () => {
    let query = supabase
      .from("availability_requests")
      .select("*")
      .eq("status", "open")
      .order("created_at", { ascending: false });

    // Tutors see their own; managers see all open
    if (isTutor && !isManager) {
      query = query.eq("tutor_id", user?.id ?? "");
    } else if (isManager && tutorId) {
      query = query.eq("tutor_id", tutorId);
    }
    const { data } = await query;
    setRequests((data ?? []) as AvailabilityRequest[]);
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  useEffect(() => {
    loadAvailability();
    loadRequests();
  }, [tutorId]);

  // Realtime requests — scope subscription to rows the current user can see
  useEffect(() => {
    if (!user) return;
    const filter = isManager
      ? undefined
      : isTutor
        ? `tutor_id=eq.${user.id}`
        : `requester_id=eq.${user.id}`;
    const ch = supabase
      .channel(`availability-requests-page:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "availability_requests", ...(filter ? { filter } : {}) },
        () => loadRequests()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [tutorId, user?.id, isManager, isTutor]);

  const canEdit = isManager || (isTutor && tutorId === user?.id);

  const addWeekly = async () => {
    const start = hhmmToMinutes(weeklyDialog.from);
    const end = hhmmToMinutes(weeklyDialog.to);
    if (start === null || end === null || end <= start) {
      toast.error("Перевірте час: кінець має бути пізніше за початок");
      return;
    }
    const { error } = await supabase.from("tutor_availability_weekly").insert({
      tutor_id: tutorId,
      weekday: weeklyDialog.weekday,
      start_minute: start,
      end_minute: end,
    });
    if (error) {
      console.error(error);
      toast.error("Не вдалося зберегти");
      return;
    }
    toast.success("Додано");
    setWeeklyDialog((s) => ({ ...s, open: false }));
    loadAvailability();
  };

  const removeWeekly = async (id: string) => {
    const { error } = await supabase.from("tutor_availability_weekly").delete().eq("id", id);
    if (error) {
      toast.error("Не вдалося видалити");
      return;
    }
    setWeekly((prev) => prev.filter((r) => r.id !== id));
  };

  const addOverride = async () => {
    if (!overrideDialog.date) {
      toast.error("Оберіть дату");
      return;
    }
    const start = hhmmToMinutes(overrideDialog.from);
    const end = hhmmToMinutes(overrideDialog.to);
    if (start === null || end === null || end <= start) {
      toast.error("Перевірте час");
      return;
    }
    const { error } = await supabase.from("tutor_availability_overrides").insert({
      tutor_id: tutorId,
      slot_date: overrideDialog.date,
      start_minute: start,
      end_minute: end,
      is_available: overrideDialog.is_available,
    });
    if (error) {
      console.error(error);
      toast.error("Не вдалося зберегти");
      return;
    }
    toast.success("Додано");
    setOverrideDialog((s) => ({ ...s, open: false }));
    loadAvailability();
  };

  const removeOverride = async (id: string) => {
    const { error } = await supabase.from("tutor_availability_overrides").delete().eq("id", id);
    if (error) {
      toast.error("Не вдалося видалити");
      return;
    }
    setOverrides((prev) => prev.filter((o) => o.id !== id));
  };

  const acknowledgeRequest = async (id: string) => {
    const { error } = await supabase
      .from("availability_requests")
      .update({ status: "fulfilled", acknowledged_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast.error("Не вдалося оновити");
      return;
    }
    toast.success("Запит закрито");
    loadRequests();
  };

  const groupedWeekly = useMemo(() => {
    const m = new Map<number, WeeklyRow[]>();
    for (const w of weekly) {
      if (!m.has(w.weekday)) m.set(w.weekday, []);
      m.get(w.weekday)!.push(w);
    }
    return m;
  }, [weekly]);

  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground flex items-center gap-2">
          <CalendarClock className="h-6 w-6 text-primary" />
          Доступні години
        </h1>
        <p className="text-sm text-muted-foreground">
          Тижневий шаблон вільних годин і виключення/додавання на конкретні дати. Учні бачать вільні слоти і можуть запитати урок.
        </p>
      </div>

      {isManager && (
        <div className="mb-6 flex items-center gap-3">
          <Label className="text-sm shrink-0">Репетитор:</Label>
          <Select value={selectedTutorId} onValueChange={setSelectedTutorId}>
            <SelectTrigger className="max-w-xs">
              <SelectValue placeholder="Оберіть репетитора" />
            </SelectTrigger>
            <SelectContent>
              {tutors.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {fullName(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {requests.length > 0 && (
        <section className="mb-8 rounded-xl border border-warning/40 bg-warning/5 p-4">
          <h2 className="font-display text-base font-semibold text-foreground flex items-center gap-2 mb-3">
            <Bell className="h-4 w-4 text-warning" />
            Запити на проставлення годин ({requests.length})
          </h2>
          <div className="space-y-2">
            {requests.map((r) => {
              const requester = profiles.get(r.requester_id);
              const tutorProfile = profiles.get(r.tutor_id);
              return (
                <div key={r.id} className="flex items-start justify-between gap-3 bg-card rounded-lg border border-border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">
                      <span className="font-medium">{fullName(requester)}</span>
                      <span className="text-muted-foreground"> запитує години у </span>
                      <span className="font-medium">{fullName(tutorProfile)}</span>
                    </p>
                    {r.message && <p className="text-xs text-muted-foreground mt-1">{r.message}</p>}
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {new Date(r.created_at).toLocaleString("uk-UA")}
                    </p>
                  </div>
                  {(isManager || (isTutor && r.tutor_id === user?.id)) && (
                    <Button size="sm" variant="outline" onClick={() => acknowledgeRequest(r.id)}>
                      <Check className="h-3.5 w-3.5 mr-1" />
                      Закрити
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !tutorId ? (
        <p className="text-sm text-muted-foreground">Оберіть репетитора, щоб переглянути графік.</p>
      ) : (
        <>
          {/* WEEKLY */}
          <section className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg font-semibold text-foreground">Тижневий шаблон</h2>
              {canEdit && (
                <Button size="sm" onClick={() => setWeeklyDialog((s) => ({ ...s, open: true }))}>
                  <Plus className="h-4 w-4 mr-1" />
                  Додати
                </Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {WEEKDAYS_UK.map((_, day) => {
                const items = groupedWeekly.get(day) ?? [];
                const openAdd = () => {
                  if (!canEdit) return;
                  setWeeklyDialog({ open: true, weekday: day, from: "16:00", to: "20:00" });
                };
                return (
                  <div
                    key={day}
                    className={`rounded-xl border border-border bg-card p-3 transition-colors ${
                      canEdit ? "cursor-pointer hover:border-primary/50 hover:bg-accent/30" : ""
                    }`}
                    onClick={canEdit ? openAdd : undefined}
                    role={canEdit ? "button" : undefined}
                    tabIndex={canEdit ? 0 : undefined}
                    onKeyDown={(e) => {
                      if (canEdit && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        openAdd();
                      }
                    }}
                    aria-label={canEdit ? `Додати години на ${WEEKDAYS_FULL_UK[day]}` : undefined}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-semibold text-foreground">{WEEKDAYS_FULL_UK[day]}</p>
                      {canEdit && <Plus className="h-4 w-4 text-muted-foreground" />}
                    </div>
                    {items.length === 0 ? (
                      <p className="text-xs italic text-muted-foreground">
                        {canEdit ? "Натисніть, щоб додати години" : "Вихідний"}
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {items.map((w) => (
                          <div
                            key={w.id}
                            className="flex items-center justify-between rounded bg-muted/40 px-2 py-1 text-xs"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="font-mono text-foreground">
                              {minutesToHHMM(w.start_minute)} — {minutesToHHMM(w.end_minute)}
                            </span>
                            {canEdit && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 text-muted-foreground hover:text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeWeekly(w.id);
                                }}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* OVERRIDES */}
          <section className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg font-semibold text-foreground">Винятки на дати</h2>
              {canEdit && (
                <Button size="sm" variant="outline" onClick={() => setOverrideDialog((s) => ({ ...s, open: true }))}>
                  <CalendarPlus className="h-4 w-4 mr-1" />
                  Додати виняток
                </Button>
              )}
            </div>
            {overrides.length === 0 ? (
              <p className="text-sm text-muted-foreground">Немає винятків.</p>
            ) : (
              <div className="space-y-2">
                {overrides.map((o) => (
                  <div key={o.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <Badge variant={o.is_available ? "default" : "outline"} className={o.is_available ? "" : "border-destructive/40 text-destructive"}>
                        {o.is_available ? "Доступний" : "Зайнятий"}
                      </Badge>
                      <span className="text-sm text-foreground">
                        {new Date(o.slot_date + "T00:00:00").toLocaleDateString("uk-UA", {
                          day: "2-digit",
                          month: "long",
                          weekday: "short",
                        })}
                      </span>
                      <span className="font-mono text-sm text-muted-foreground">
                        {minutesToHHMM(o.start_minute)} — {minutesToHHMM(o.end_minute)}
                      </span>
                    </div>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => removeOverride(o.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Weekly add dialog */}
      <Dialog open={weeklyDialog.open} onOpenChange={(o) => setWeeklyDialog((s) => ({ ...s, open: o }))}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Додати тижневий слот</DialogTitle>
            <DialogDescription>Повторюється кожного тижня.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>День тижня</Label>
              <Select
                value={String(weeklyDialog.weekday)}
                onValueChange={(v) => setWeeklyDialog((s) => ({ ...s, weekday: Number(v) }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAYS_FULL_UK.map((d, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Від</Label>
                <Input
                  type="time"
                  value={weeklyDialog.from}
                  onChange={(e) => setWeeklyDialog((s) => ({ ...s, from: e.target.value }))}
                />
              </div>
              <div>
                <Label>До</Label>
                <Input
                  type="time"
                  value={weeklyDialog.to}
                  onChange={(e) => setWeeklyDialog((s) => ({ ...s, to: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWeeklyDialog((s) => ({ ...s, open: false }))}>
              Скасувати
            </Button>
            <Button onClick={addWeekly}>Додати</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Override add dialog */}
      <Dialog open={overrideDialog.open} onOpenChange={(o) => setOverrideDialog((s) => ({ ...s, open: o }))}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Додати виняток</DialogTitle>
            <DialogDescription>
              Перекриває або доповнює тижневий шаблон на конкретну дату.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Дата</Label>
              <Input
                type="date"
                value={overrideDialog.date}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setOverrideDialog((s) => ({ ...s, date: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Від</Label>
                <Input
                  type="time"
                  value={overrideDialog.from}
                  onChange={(e) => setOverrideDialog((s) => ({ ...s, from: e.target.value }))}
                />
              </div>
              <div>
                <Label>До</Label>
                <Input
                  type="time"
                  value={overrideDialog.to}
                  onChange={(e) => setOverrideDialog((s) => ({ ...s, to: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label>Тип</Label>
              <Select
                value={overrideDialog.is_available ? "yes" : "no"}
                onValueChange={(v) => setOverrideDialog((s) => ({ ...s, is_available: v === "yes" }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Доступний (додатковий слот)</SelectItem>
                  <SelectItem value="no">Зайнятий (вихідний / блокуємо)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideDialog((s) => ({ ...s, open: false }))}>
              Скасувати
            </Button>
            <Button onClick={addOverride}>Додати</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
