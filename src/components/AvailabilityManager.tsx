import { useEffect, useMemo, useState } from "react";
import { getLocale } from "@/lib/locale";
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
  Plus,
  Trash2,
  CalendarPlus,
  Bell,
  Check,
  Copy,
  CalendarOff,
  CalendarClock,
  Info,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import i18nInstance from "@/i18n";
import {
  WEEKDAYS_FULL_UK,
  WEEKDAYS_UK,
  hhmmToMinutes,
  minutesToHHMM,
} from "@/lib/availability";

const t = i18nInstance.t.bind(i18nInstance);

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

// ── Design tokens (DS — variant B "Доступні години") ──────────────────────────
const A = {
  txt: "#0f0f1a", sub: "#9398b0", muted: "#b0b4c8", border: "#eceef3", bg: "#F5F4F0",
  surface: "#FFFFFF", teal: "#2BBFAA", tealD: "#1f8e7e", tealL: "#f0fdf9",
  tealRing: "rgba(43,191,170,.28)", successD: "#16a34a", coral: "#e0552f", warning: "#d97706",
  gradTeal: "linear-gradient(135deg,#2BBFAA,#25a896)",
  gradIncome: "linear-gradient(160deg,#23232f 0%,#0f0f1a 100%)",
  shadowSm: "0 1px 4px rgba(15,15,26,.05)",
  display: "Inter, system-ui, sans-serif", body: "'Plus Jakarta Sans', system-ui, sans-serif",
};
// Monday-first order over JS getDay() indices (0=Sun…6=Sat)
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function AvailabilityManager() {
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
  const [showHint, setShowHint] = useState(false);

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
    fullDay: boolean;
  }>({ open: false, date: "", from: "10:00", to: "12:00", is_available: false, fullDay: true });

  const tutorId = useMemo(() => {
    if (isTutor && !isManager) return user?.id ?? "";
    return selectedTutorId;
  }, [isTutor, isManager, user?.id, selectedTutorId]);

  const loadProfiles = async () => {
    const [tutorRolesRes, profilesRes] = await Promise.all([
      supabase.from("user_roles").select("user_id").eq("role", "tutor"),
      supabase.from("profiles").select("id, first_name, last_name").limit(200),
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

  useEffect(() => {
    if (!user) return;
    const filter = isManager
      ? undefined
      : isTutor
        ? `tutor_id=eq.${user.id}`
        : `requester_id=eq.${user.id}`;
    const ch = supabase
      .channel(`availability-requests-mgr:${user.id}`)
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
      toast.error(t("availabilityManager.timeError"));
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
      toast.error(t("availabilityManager.saveFailed"));
      return;
    }
    toast.success(t("availabilityManager.addSuccess"));
    setWeeklyDialog((s) => ({ ...s, open: false }));
    loadAvailability();
  };

  const removeWeekly = async (id: string) => {
    const { error } = await supabase.from("tutor_availability_weekly").delete().eq("id", id);
    if (error) {
      toast.error(t("availabilityManager.deleteFailed"));
      return;
    }
    setWeekly((prev) => prev.filter((r) => r.id !== id));
  };

  // Quick action: mark a whole weekday as day off (delete all weekly slots for that day)
  const clearWeekday = async (day: number) => {
    if (!canEdit) return;
    const { error } = await supabase
      .from("tutor_availability_weekly")
      .delete()
      .eq("tutor_id", tutorId)
      .eq("weekday", day);
    if (error) {
      toast.error(t("availabilityManager.updateFailed"));
      return;
    }
    toast.success(t("availabilityManagerExtra.dayOffToast", { day: WEEKDAYS_FULL_UK[day] }));
    loadAvailability();
  };

  // Quick action: turn a day ON by seeding a default slot (tutor then edits/adds)
  const enableWeekday = async (day: number) => {
    if (!canEdit) return;
    const { error } = await supabase.from("tutor_availability_weekly").insert({
      tutor_id: tutorId,
      weekday: day,
      start_minute: 16 * 60,
      end_minute: 20 * 60,
    });
    if (error) {
      console.error(error);
      toast.error(t("availabilityManager.saveFailed"));
      return;
    }
    loadAvailability();
  };

  const addOverride = async () => {
    if (!overrideDialog.date) {
      toast.error(t("availabilityManagerExtra.dateRequired"));
      return;
    }
    const start = overrideDialog.fullDay ? 0 : hhmmToMinutes(overrideDialog.from);
    const end = overrideDialog.fullDay ? 24 * 60 - 1 : hhmmToMinutes(overrideDialog.to);
    if (start === null || end === null || end <= start) {
      toast.error(t("availabilityManagerExtra.timeCheck"));
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
      toast.error(t("availabilityManager.saveFailed"));
      return;
    }
    toast.success(overrideDialog.is_available ? t("availabilityManagerExtra.extraHoursAdded") : t("availabilityManagerExtra.dayOffAdded"));
    setOverrideDialog((s) => ({ ...s, open: false }));
    loadAvailability();
  };

  const removeOverride = async (id: string) => {
    const { error } = await supabase.from("tutor_availability_overrides").delete().eq("id", id);
    if (error) {
      toast.error(t("availabilityManager.deleteFailed"));
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
      toast.error(t("availabilityManager.updateFailed"));
      return;
    }
    toast.success(t("availabilityManagerExtra.requestClosed"));
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

  const totalWeeklyMinutes = useMemo(
    () => weekly.reduce((s, w) => s + (w.end_minute - w.start_minute), 0),
    [weekly]
  );
  const totalWeeklyHours = (totalWeeklyMinutes / 60).toFixed(1).replace(/\.0$/, "");

  const copyDaySlots = async (sourceDay: number, targetDay: number) => {
    if (sourceDay === targetDay) return;
    const source = groupedWeekly.get(sourceDay) ?? [];
    if (source.length === 0) {
      toast.error(t("availabilityManagerExtra.noSlotsForCopy"));
      return;
    }
    const rows = source.map((s) => ({
      tutor_id: tutorId,
      weekday: targetDay,
      start_minute: s.start_minute,
      end_minute: s.end_minute,
    }));
    const { error } = await supabase.from("tutor_availability_weekly").insert(rows);
    if (error) {
      console.error(error);
      toast.error(t("availabilityManagerExtra.copyFailed"));
      return;
    }
    toast.success(t("availabilityManagerExtra.copiedSlots", { count: rows.length, day: WEEKDAYS_FULL_UK[targetDay] }));
    loadAvailability();
  };

  const openDayOffDialog = () => {
    setOverrideDialog({
      open: true,
      date: new Date().toISOString().slice(0, 10),
      from: "00:00",
      to: "23:59",
      is_available: false,
      fullDay: true,
    });
  };

  const openExtraHoursDialog = () => {
    setOverrideDialog({
      open: true,
      date: new Date().toISOString().slice(0, 10),
      from: "10:00",
      to: "12:00",
      is_available: true,
      fullDay: false,
    });
  };

  return (
    <div style={{ fontFamily: A.body, color: A.txt }}>
      {/* How it works (collapsible) */}
      <div style={{ marginBottom: 14 }}>
        <button type="button" onClick={() => setShowHint((v) => !v)} aria-expanded={showHint}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${A.border}`, background: "rgba(15,15,26,.03)", borderRadius: 999, padding: "7px 13px", cursor: "pointer", fontFamily: A.display, fontWeight: 700, fontSize: 13, color: A.sub }}>
          <Info className="h-3.5 w-3.5" style={{ color: A.tealD }} /> {t("availability.howItWorks")}
        </button>
        {showHint && (
          <div style={{ marginTop: 8, borderRadius: 14, border: `1px solid ${A.border}`, background: "rgba(15,15,26,.03)", padding: 13, fontSize: 13, lineHeight: 1.5, color: A.sub }}>
            {t("availability.scheduleInfo")}
          </div>
        )}
      </div>

      {/* Manager: tutor selector */}
      {isManager && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <Label className="text-sm shrink-0">{t("availabilityManagerExtra.tutorLabel")}</Label>
          <Select value={selectedTutorId} onValueChange={setSelectedTutorId}>
            <SelectTrigger className="max-w-xs"><SelectValue placeholder={t("availabilityManagerExtra.selectTutor")} /></SelectTrigger>
            <SelectContent>
              {tutors.map((tt) => (<SelectItem key={tt.id} value={tt.id}>{fullName(tt)}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Requests banner */}
      {requests.length > 0 && (
        <div style={{ marginBottom: 14, borderRadius: 16, background: "rgba(245,158,11,.06)", border: "1px solid rgba(245,158,11,.4)", padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Bell className="h-4 w-4" style={{ color: A.warning }} />
            <span style={{ fontFamily: A.display, fontWeight: 800, fontSize: 14.5 }}>{t("availabilityManagerExtra.requestsTitle", { count: requests.length })}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {requests.map((r) => {
              const requester = profiles.get(r.requester_id);
              const tutorProfile = profiles.get(r.tutor_id);
              return (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 11, background: A.surface, border: `1px solid ${A.border}`, borderRadius: 12, padding: "10px 12px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5 }}>
                      <b style={{ fontFamily: A.display }}>{fullName(requester)}</b>
                      <span style={{ color: A.sub }}> {t("availabilityManagerExtra.requestsHours")} </span>
                      <b style={{ fontFamily: A.display }}>{fullName(tutorProfile)}</b>
                    </div>
                    {r.message && <div style={{ fontSize: 13, color: A.sub, marginTop: 2 }}>{r.message}</div>}
                    <div style={{ fontSize: 13, color: A.muted, marginTop: 2 }}>{new Date(r.created_at).toLocaleString(getLocale())}</div>
                  </div>
                  {(isManager || (isTutor && r.tutor_id === user?.id)) && (
                    <Button size="sm" variant="outline" onClick={() => acknowledgeRequest(r.id)}>
                      <Check className="h-3.5 w-3.5 mr-1" /> {t("availabilityManagerExtra.closeBtn")}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}>
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: A.muted }} />
        </div>
      ) : !tutorId ? (
        <p style={{ fontSize: 14, color: A.sub }}>{t("availabilityManagerExtra.noTutorSelected")}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Summary (dark) */}
          <div style={{ borderRadius: 18, padding: 16, background: A.gradIncome, color: "#fff", boxShadow: "0 14px 32px -18px rgba(15,15,26,.6)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: ".09em", color: "rgba(255,255,255,.55)", fontFamily: A.display, fontWeight: 700 }}>{t("availabilityManagerExtra.openThisWeek")}</div>
                <div style={{ fontFamily: A.display, fontWeight: 800, fontSize: 30, color: A.teal, marginTop: 4 }}>
                  {totalWeeklyHours} <span style={{ fontSize: 15, color: "#fff" }}>{t("availabilityManagerExtra.hoursShort")}</span>
                </div>
              </div>
              <div style={{ width: 46, height: 46, borderRadius: 999, background: "rgba(255,255,255,.12)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <CalendarClock className="h-[22px] w-[22px]" />
              </div>
            </div>
          </div>

          {/* Weekly template */}
          <div style={{ fontFamily: A.display, fontWeight: 700, fontSize: 13, letterSpacing: ".09em", textTransform: "uppercase", color: A.sub, margin: "4px 2px -2px" }}>
            {t("availabilityManagerExtra.weeklyTemplate")}
          </div>
          <div style={{ background: A.surface, border: `1px solid ${A.border}`, borderRadius: 18, boxShadow: A.shadowSm, padding: 6 }}>
            {DAY_ORDER.map((day, idx) => {
              const items = groupedWeekly.get(day) ?? [];
              const off = items.length === 0;
              const canCopy = canEdit && off && Array.from(groupedWeekly.values()).some((l) => l.length > 0);
              return (
                <div key={day} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 8px", borderBottom: idx < DAY_ORDER.length - 1 ? `1px solid ${A.border}` : "none" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: A.display, fontWeight: 800, fontSize: 13,
                    background: off ? "rgba(147,152,176,.14)" : A.tealL, color: off ? A.muted : A.tealD }}>
                    {WEEKDAYS_UK[day]}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {off ? (
                      <span style={{ fontSize: 13, color: A.muted, fontStyle: "italic" }}>{t("availabilityManagerExtra.holiday")}</span>
                    ) : (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {items.map((w) => (
                          <span key={w.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: canEdit ? "0 4px 0 9px" : "0 9px", borderRadius: 999, background: A.tealL, boxShadow: `inset 0 0 0 1px ${A.tealRing}` }}>
                            <span style={{ fontFamily: A.display, fontWeight: 700, fontSize: 13, color: A.tealD, fontVariantNumeric: "tabular-nums" }}>
                              {minutesToHHMM(w.start_minute)}–{minutesToHHMM(w.end_minute)}
                            </span>
                            {canEdit && (
                              <button onClick={() => removeWeekly(w.id)} aria-label={t("availabilityManagerExtra.deleteAria")}
                                style={{ width: 18, height: 18, borderRadius: 999, border: "none", cursor: "pointer", background: "rgba(43,191,170,.18)", color: A.tealD, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {canCopy && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button title={t("availabilityManagerExtra.copyFromDay")}
                          style={{ width: 30, height: 30, borderRadius: 999, border: "none", cursor: "pointer", background: "rgba(15,15,26,.05)", color: A.sub, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {Array.from(groupedWeekly.entries()).filter(([d, list]) => d !== day && list.length > 0).map(([d]) => (
                          <DropdownMenuItem key={d} onClick={() => copyDaySlots(d, day)}>{t("availabilityManagerExtra.copyFromDayItem", { day: WEEKDAYS_FULL_UK[d] })}</DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}

                  {canEdit && !off && (
                    <button onClick={() => setWeeklyDialog({ open: true, weekday: day, from: "16:00", to: "20:00" })} aria-label={t("availabilityManagerExtra.addHoursAria", { day: WEEKDAYS_FULL_UK[day] })}
                      style={{ width: 30, height: 30, borderRadius: 999, border: "none", cursor: "pointer", background: A.tealL, color: A.tealD, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Plus className="h-4 w-4" />
                    </button>
                  )}

                  {canEdit && (
                    <button onClick={() => (off ? enableWeekday(day) : clearWeekday(day))} role="switch" aria-checked={!off}
                      aria-label={WEEKDAYS_FULL_UK[day]}
                      style={{ width: 43, height: 24, flexShrink: 0, borderRadius: 999, border: "none", padding: 0, cursor: "pointer", position: "relative", transition: "background .25s", background: off ? "rgba(15,15,26,.12)" : A.gradTeal }}>
                      <span style={{ position: "absolute", top: 3, left: off ? 3 : 22, width: 18, height: 18, borderRadius: 999, background: "#fff", boxShadow: "0 2px 5px rgba(15,15,26,.25)", transition: "left .25s cubic-bezier(.34,1.56,.64,1)" }} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Overrides */}
          <div style={{ marginTop: 4 }}>
            <div style={{ margin: "2px 2px 4px" }}>
              <div style={{ fontFamily: A.display, fontWeight: 800, fontSize: 16 }}>{t("availabilityManagerExtra.dateExceptions")}</div>
              <div style={{ fontSize: 13, color: A.sub, marginTop: 1, lineHeight: 1.4 }}>{t("availabilityManagerExtra.dateExceptionsDesc")}</div>
            </div>
            {canEdit && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "10px 0 12px" }}>
                <Button size="sm" variant="outline" onClick={openDayOffDialog}>
                  <CalendarOff className="h-4 w-4 mr-1" /> {t("availabilityManagerExtra.markDayOffBtn")}
                </Button>
                <Button size="sm" variant="outline" onClick={openExtraHoursDialog}>
                  <CalendarPlus className="h-4 w-4 mr-1" /> {t("availabilityManagerExtra.extraHoursBtn")}
                </Button>
              </div>
            )}
            {overrides.length === 0 ? (
              <p style={{ fontSize: 14, color: A.sub }}>{t("availabilityManagerExtra.noExceptions")}</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {overrides.map((o) => {
                  const isFullDay = o.start_minute === 0 && o.end_minute >= 24 * 60 - 1;
                  const extra = o.is_available;
                  return (
                    <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 11, borderRadius: 12, border: `1px solid ${A.border}`, background: A.surface, padding: "11px 12px" }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                        background: extra ? "rgba(34,197,94,.12)" : "rgba(255,122,89,.13)", color: extra ? A.successD : A.coral }}>
                        {extra ? <CalendarPlus className="h-[18px] w-[18px]" /> : <CalendarOff className="h-[18px] w-[18px]" />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontFamily: A.display, fontWeight: 700, fontSize: 13.5 }}>
                            {new Date(o.slot_date + "T00:00:00").toLocaleDateString(getLocale(), { day: "2-digit", month: "long", weekday: "short" })}
                          </span>
                          <span style={{ display: "inline-flex", alignItems: "center", borderRadius: 999, padding: "2px 9px", fontFamily: A.display, fontWeight: 700, fontSize: 13,
                            background: extra ? "rgba(34,197,94,.14)" : "rgba(255,122,89,.15)", color: extra ? A.successD : A.coral }}>
                            {extra ? t("availabilityManagerExtra.extraHours") : t("availabilityManagerExtra.holiday")}
                          </span>
                        </div>
                        <div style={{ fontSize: 13, color: A.sub, fontVariantNumeric: "tabular-nums", marginTop: 1 }}>
                          {isFullDay ? t("availabilityManagerExtra.allDay") : `${minutesToHHMM(o.start_minute)}–${minutesToHHMM(o.end_minute)}`}
                        </div>
                      </div>
                      {canEdit && (
                        <button onClick={() => removeOverride(o.id)} aria-label={t("availabilityManagerExtra.deleteAria")}
                          style={{ width: 30, height: 30, borderRadius: 999, border: "none", cursor: "pointer", background: "transparent", color: A.muted, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Weekly add dialog */}
      <Dialog open={weeklyDialog.open} onOpenChange={(o) => setWeeklyDialog((s) => ({ ...s, open: o }))}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("availabilityManagerExtra.addWeeklyTitle")}</DialogTitle>
            <DialogDescription>{t("availabilityManagerExtra.addWeeklyDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>{t("availabilityManagerExtra.dayOfWeekLabel")}</Label>
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
                <Label>{t("availabilityManagerExtra.fromLabel")}</Label>
                <Input
                  type="time"
                  value={weeklyDialog.from}
                  onChange={(e) => setWeeklyDialog((s) => ({ ...s, from: e.target.value }))}
                />
              </div>
              <div>
                <Label>{t("availabilityManagerExtra.toLabel")}</Label>
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
              {t("availabilityManagerExtra.cancelBtn")}
            </Button>
            <Button onClick={addWeekly}>{t("availabilityManagerExtra.addBtn")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Override add dialog */}
      <Dialog open={overrideDialog.open} onOpenChange={(o) => setOverrideDialog((s) => ({ ...s, open: o }))}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {overrideDialog.is_available ? t("availabilityManagerExtra.extraHoursTitle") : t("availabilityManagerExtra.dayOffTitle")}
            </DialogTitle>
            <DialogDescription>
              {overrideDialog.is_available
                ? t("availabilityManagerExtra.extraHoursDesc")
                : t("availabilityManagerExtra.dayOffDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>{t("availabilityManagerExtra.dateLabel")}</Label>
              <Input
                type="date"
                value={overrideDialog.date}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setOverrideDialog((s) => ({ ...s, date: e.target.value }))}
              />
            </div>
            <div>
              <Label>{t("availabilityManagerExtra.typeLabel")}</Label>
              <Select
                value={overrideDialog.is_available ? "yes" : "no"}
                onValueChange={(v) => setOverrideDialog((s) => ({ ...s, is_available: v === "yes" }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="no">{t("availabilityManagerExtra.dayOffOption")}</SelectItem>
                  <SelectItem value="yes">{t("availabilityManagerExtra.extraHoursOption")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!overrideDialog.is_available && (
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={overrideDialog.fullDay}
                  onChange={(e) => setOverrideDialog((s) => ({ ...s, fullDay: e.target.checked }))}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                {t("availabilityManagerExtra.fullDayLabel")}
              </label>
            )}
            {(overrideDialog.is_available || !overrideDialog.fullDay) && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("availabilityManagerExtra.fromLabel")}</Label>
                  <Input
                    type="time"
                    value={overrideDialog.from}
                    onChange={(e) => setOverrideDialog((s) => ({ ...s, from: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>{t("availabilityManagerExtra.toLabel")}</Label>
                  <Input
                    type="time"
                    value={overrideDialog.to}
                    onChange={(e) => setOverrideDialog((s) => ({ ...s, to: e.target.value }))}
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideDialog((s) => ({ ...s, open: false }))}>
              {t("availabilityManagerExtra.cancelBtn")}
            </Button>
            <Button onClick={addOverride}>{t("availabilityManagerExtra.saveBtn")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
