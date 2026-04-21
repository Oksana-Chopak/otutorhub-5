import { AppLayout } from "@/components/AppLayout";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Clock, Plus, Loader2, Trash2, Copy, ChevronDown, ChevronUp } from "lucide-react";
import { TutorAvailabilityView } from "@/components/TutorAvailabilityView";

type LessonStatus = "pending" | "scheduled" | "completed" | "cancelled";
type PaymentStatus = "unpaid" | "paid";

interface Lesson {
  id: string;
  tutor_id: string;
  student_id: string;
  subject: string;
  starts_at: string;
  duration_minutes: number;
  status: LessonStatus;
  notes: string | null;
  student_price: number;
  tutor_payout: number;
  student_payment_status: PaymentStatus;
  tutor_payout_status: PaymentStatus;
}

interface PersonOption {
  id: string;
  name: string;
  subjects?: string[];
}

const statusLabel: Record<LessonStatus, string> = {
  pending: "Запит",
  scheduled: "Заплановано",
  completed: "Проведено",
  cancelled: "Скасовано",
};

const statusBadgeClass: Record<LessonStatus, string> = {
  pending: "bg-warning/10 text-warning border-0",
  scheduled: "bg-primary/10 text-primary border-0",
  completed: "bg-success/10 text-success border-0",
  cancelled: "bg-destructive/10 text-destructive border-0",
};

function toLocalInputValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateGroup(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("uk-UA", { weekday: "short", day: "numeric", month: "long" });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
}

export default function SchedulePage() {
  const { user, roles } = useAuth();
  const isManager = roles.includes("manager");
  const isTutor = roles.includes("tutor");
  const isStudent = roles.includes("student");

  const [loading, setLoading] = useState(true);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [tutors, setTutors] = useState<PersonOption[]>([]);
  const [students, setStudents] = useState<PersonOption[]>([]);
  const [profilesMap, setProfilesMap] = useState<Record<string, string>>({});

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    tutor_id: "",
    student_id: "",
    subject: "",
    starts_at: toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000).toISOString()),
    duration_minutes: "60",
    notes: "",
    status: "scheduled" as LessonStatus,
    student_price: "0",
    tutor_payout: "0",
    student_payment_status: "unpaid" as PaymentStatus,
    tutor_payout_status: "unpaid" as PaymentStatus,
  });
  const [submitting, setSubmitting] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const openCopy = (lesson: Lesson) => {
    // Pre-fill form with lesson data; default new starts_at = +7 days same time
    const next = new Date(lesson.starts_at);
    next.setDate(next.getDate() + 7);
    setForm({
      tutor_id: lesson.tutor_id,
      student_id: lesson.student_id,
      subject: lesson.subject,
      starts_at: toLocalInputValue(next.toISOString()),
      duration_minutes: String(lesson.duration_minutes),
      notes: lesson.notes ?? "",
      status: "scheduled",
      student_price: String(lesson.student_price ?? 0),
      tutor_payout: String(lesson.tutor_payout ?? 0),
      student_payment_status: "unpaid",
      tutor_payout_status: "unpaid",
    });
    setNotesOpen(Boolean(lesson.notes));
    setCreateOpen(true);
  };

  const loadAll = async () => {
    if (!user) return;
    setLoading(true);

    const [lessonsRes, profilesRes, rolesRes, tutorRes] = await Promise.all([
      supabase.from("lessons_visible").select("*").order("starts_at", { ascending: true }),
      supabase.from("profiles").select("id, first_name, last_name"),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("tutor_details").select("user_id, subjects"),
    ]);

    const profiles = profilesRes.data ?? [];
    const pmap: Record<string, string> = {};
    profiles.forEach((p: any) => {
      pmap[p.id] = `${p.first_name} ${p.last_name}`.trim() || "Без імені";
    });
    setProfilesMap(pmap);

    const tutorSubjects: Record<string, string[]> = {};
    (tutorRes.data ?? []).forEach((t: any) => {
      tutorSubjects[t.user_id] = t.subjects ?? [];
    });

    const tutorIds = (rolesRes.data ?? []).filter((r: any) => r.role === "tutor").map((r: any) => r.user_id);
    const studentIds = (rolesRes.data ?? []).filter((r: any) => r.role === "student").map((r: any) => r.user_id);

    setTutors(
      tutorIds.map((id) => ({ id, name: pmap[id] ?? "?", subjects: tutorSubjects[id] ?? [] }))
    );
    setStudents(studentIds.map((id) => ({ id, name: pmap[id] ?? "?" })));

    setLessons((lessonsRes.data ?? []) as Lesson[]);
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
  }, [user?.id]);

  // Pre-select for tutor/student
  useEffect(() => {
    if (!user) return;
    setForm((f) => ({
      ...f,
      tutor_id: isTutor && !isManager ? user.id : f.tutor_id,
      student_id: isStudent && !isManager && !isTutor ? user.id : f.student_id,
    }));
  }, [user?.id, isManager, isTutor, isStudent]);

  const selectedTutor = tutors.find((t) => t.id === form.tutor_id);

  const handleCreate = async () => {
    if (!user) return;
    if (!form.tutor_id || !form.student_id || !form.subject || !form.starts_at) {
      toast.error("Заповніть усі обов'язкові поля");
      return;
    }
    setSubmitting(true);

    const status: LessonStatus = isStudent && !isManager && !isTutor ? "pending" : "scheduled";

    const payload: any = {
      tutor_id: form.tutor_id,
      student_id: form.student_id,
      subject: form.subject,
      starts_at: new Date(form.starts_at).toISOString(),
      duration_minutes: parseInt(form.duration_minutes) || 60,
      notes: form.notes || null,
      status: isManager ? form.status : status,
      created_by: user.id,
    };

    if (isManager) {
      payload.student_price = Number(form.student_price) || 0;
      payload.tutor_payout = Number(form.tutor_payout) || 0;
      payload.student_payment_status = form.student_payment_status;
      payload.tutor_payout_status = form.tutor_payout_status;
    }

    const { error } = await supabase.from("lessons").insert(payload);
    setSubmitting(false);
    if (error) {
      console.error("Failed to create lesson", error);
      toast.error("Не вдалося створити урок. Спробуйте ще раз.");
      return;
    }
    toast.success(status === "pending" ? "Запит створено" : "Урок створено");
    setCreateOpen(false);
    setForm((f) => ({
      ...f,
      subject: "",
      notes: "",
      student_price: "0",
      tutor_payout: "0",
      student_payment_status: "unpaid",
      tutor_payout_status: "unpaid",
      status: "scheduled",
    }));
    loadAll();
  };

  const updateStatus = async (lessonId: string, newStatus: LessonStatus) => {
    const { error } = await supabase.from("lessons").update({ status: newStatus }).eq("id", lessonId);
    if (error) {
      console.error("Failed to update lesson status", error);
      toast.error("Не вдалося оновити статус. Спробуйте ще раз.");
      return;
    }
    toast.success("Статус оновлено");
    loadAll();
  };

  const deleteLesson = async (lessonId: string) => {
    const { error } = await supabase.from("lessons").delete().eq("id", lessonId);
    if (error) {
      console.error("Failed to delete lesson", error);
      toast.error("Не вдалося видалити урок. Спробуйте ще раз.");
      return;
    }
    toast.success("Урок видалено");
    loadAll();
  };

  // Group lessons by day
  const grouped = useMemo(() => {
    const map = new Map<string, Lesson[]>();
    lessons.forEach((l) => {
      const key = new Date(l.starts_at).toISOString().slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(l);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [lessons]);

  // For students: list of distinct tutors they have lessons with
  const studentTutors = useMemo(() => {
    if (!isStudent || isManager || isTutor || !user) return [] as PersonOption[];
    const ids = Array.from(new Set(lessons.filter((l) => l.student_id === user.id).map((l) => l.tutor_id)));
    return ids.map((id) => ({ id, name: profilesMap[id] ?? "Репетитор" }));
  }, [lessons, isStudent, isManager, isTutor, user?.id, profilesMap]);

  const todayKey = new Date().toISOString().slice(0, 10);

  const canCreate = isManager || isTutor || isStudent;

  return (
    <AppLayout>
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Розклад занять</h1>
          <p className="text-sm text-muted-foreground">
            {isManager
              ? "Усі уроки школи"
              : isTutor
              ? "Ваші уроки"
              : "Ваші уроки та запити"}
          </p>
        </div>
        {canCreate && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                {isStudent && !isManager && !isTutor ? "Запросити урок" : "Створити урок"}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-[90vh] flex flex-col p-0">
              <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
                <DialogTitle>
                  {isStudent && !isManager && !isTutor ? "Запит на урок" : "Новий урок"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 px-6 py-2 overflow-y-auto flex-1">
                <div>
                  <Label>Репетитор</Label>
                  <Select
                    value={form.tutor_id}
                    onValueChange={(v) => setForm((f) => ({ ...f, tutor_id: v }))}
                    disabled={isTutor && !isManager}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Оберіть репетитора" />
                    </SelectTrigger>
                    <SelectContent>
                      {tutors.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Учень</Label>
                  <Select
                    value={form.student_id}
                    onValueChange={(v) => setForm((f) => ({ ...f, student_id: v }))}
                    disabled={isStudent && !isManager && !isTutor}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Оберіть учня" />
                    </SelectTrigger>
                    <SelectContent>
                      {students.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="subject">Предмет</Label>
                  {selectedTutor && selectedTutor.subjects && selectedTutor.subjects.length > 0 ? (
                    <Select
                      value={form.subject}
                      onValueChange={(v) => setForm((f) => ({ ...f, subject: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Оберіть предмет" />
                      </SelectTrigger>
                      <SelectContent>
                        {selectedTutor.subjects.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id="subject"
                      value={form.subject}
                      onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                      placeholder="напр. Англійська"
                    />
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="starts_at">Дата і час</Label>
                    <Input
                      id="starts_at"
                      type="datetime-local"
                      value={form.starts_at}
                      onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="duration">Тривалість (хв)</Label>
                    <Input
                      id="duration"
                      type="number"
                      min="15"
                      step="15"
                      value={form.duration_minutes}
                      onChange={(e) => setForm((f) => ({ ...f, duration_minutes: e.target.value }))}
                    />
                  </div>
                </div>
                {isManager && (
                  <>
                    <div>
                      <Label>Статус уроку</Label>
                      <Select
                        value={form.status}
                        onValueChange={(v) => setForm((f) => ({ ...f, status: v as LessonStatus }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Оберіть статус" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending">Запит</SelectItem>
                          <SelectItem value="scheduled">Заплановано</SelectItem>
                          <SelectItem value="completed">Проведено</SelectItem>
                          <SelectItem value="cancelled">Скасовано</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="student_price">Оплата учня (₴)</Label>
                        <Input
                          id="student_price"
                          type="number"
                          min="0"
                          step="any"
                          value={form.student_price}
                          onChange={(e) => setForm((f) => ({ ...f, student_price: e.target.value }))}
                        />
                      </div>
                      <div>
                        <Label htmlFor="tutor_payout">Виплата репетитору (₴)</Label>
                        <Input
                          id="tutor_payout"
                          type="number"
                          min="0"
                          step="any"
                          value={form.tutor_payout}
                          onChange={(e) => setForm((f) => ({ ...f, tutor_payout: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Статус оплати учня</Label>
                        <Select
                          value={form.student_payment_status}
                          onValueChange={(v) => setForm((f) => ({ ...f, student_payment_status: v as PaymentStatus }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Оберіть статус" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unpaid">Очікує</SelectItem>
                            <SelectItem value="paid">Оплачено</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Статус виплати репетитору</Label>
                        <Select
                          value={form.tutor_payout_status}
                          onValueChange={(v) => setForm((f) => ({ ...f, tutor_payout_status: v as PaymentStatus }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Оберіть статус" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unpaid">Очікує</SelectItem>
                            <SelectItem value="paid">Оплачено</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </>
                )}
                {isStudent && !isManager && !isTutor && (
                  <p className="text-xs text-muted-foreground">
                    Це буде запит. Менеджер або репетитор підтвердить його.
                  </p>
                )}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setNotesOpen((v) => !v)}
                    className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
                  >
                    <span className="flex-1 text-left">
                      Нотатки {form.notes ? `(${form.notes.length})` : "(опц.)"}
                    </span>
                    {notesOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                  {notesOpen && (
                    <Textarea
                      id="notes"
                      rows={3}
                      className="mt-2"
                      value={form.notes}
                      onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                      placeholder="Додаткова інформація..."
                    />
                  )}
                </div>
              </div>
              <DialogFooter className="px-6 pb-6 pt-3 border-t border-border bg-background shrink-0">
                <Button variant="outline" onClick={() => setCreateOpen(false)}>
                  Скасувати
                </Button>
                <Button onClick={handleCreate} disabled={submitting}>
                  {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Зберегти
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {studentTutors.length > 0 && (
        <div className="mb-6 space-y-4">
          <h2 className="font-display text-lg font-semibold text-foreground">Доступні години ваших репетиторів</h2>
          {studentTutors.map((t) => (
            <TutorAvailabilityView key={t.id} tutorId={t.id} tutorName={t.name} />
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : grouped.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <Clock className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">Уроків ще немає</p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([dayKey, dayLessons]) => {
            const isToday = dayKey === todayKey;
            return (
              <div key={dayKey}>
                <h3
                  className={`font-display text-sm font-semibold mb-3 ${
                    isToday ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {formatDateGroup(dayLessons[0].starts_at)}
                  {isToday && " (сьогодні)"}
                </h3>
                <div className="space-y-2">
                  {dayLessons.map((lesson) => {
                    const tutorName = profilesMap[lesson.tutor_id] ?? "?";
                    const studentName = profilesMap[lesson.student_id] ?? "?";
                    const canEditStatus =
                      isManager || (isTutor && lesson.tutor_id === user?.id);
                    const canDelete =
                      isManager ||
                      (isTutor &&
                        lesson.tutor_id === user?.id &&
                        (lesson.status === "pending" || lesson.status === "scheduled"));
                    const canCopy =
                      isManager || (isTutor && lesson.tutor_id === user?.id);

                    return (
                      <div
                        key={lesson.id}
                        className={`flex items-center justify-between gap-3 rounded-xl border p-4 ${
                          isToday ? "border-primary/20 bg-primary/5" : "border-border bg-card"
                        }`}
                      >
                        <div className="flex items-center gap-4 min-w-0 flex-1">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                            <Clock className="h-4 w-4 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              {lesson.subject} — {formatTime(lesson.starts_at)}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {tutorName} → {studentName} · {lesson.duration_minutes} хв
                            </p>
                            {isManager && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Ціна: {lesson.student_price} ₴ · Виплата: {lesson.tutor_payout} ₴
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {canEditStatus ? (
                            <Select
                              value={lesson.status}
                              onValueChange={(v) => updateStatus(lesson.id, v as LessonStatus)}
                            >
                              <SelectTrigger className="h-8 w-[140px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(isManager
                                  ? (["pending", "scheduled", "completed", "cancelled"] as LessonStatus[])
                                  : (["scheduled", "completed", "cancelled"] as LessonStatus[])
                                ).map((s) => (
                                  <SelectItem key={s} value={s}>
                                    {statusLabel[s]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge className={statusBadgeClass[lesson.status]}>
                              {statusLabel[lesson.status]}
                            </Badge>
                          )}
                          {canCopy && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-primary"
                              onClick={() => openCopy(lesson)}
                              title="Копіювати урок"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          )}
                          {canDelete && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Видалити урок?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Цю дію не можна скасувати.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Скасувати</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteLesson(lesson.id)}>
                                    Видалити
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppLayout>
  );
}
