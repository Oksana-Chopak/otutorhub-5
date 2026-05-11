/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubjectSelect } from "@/components/SubjectSelect";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ChevronDown, Loader2, UserPlus, CalendarPlus, BadgeDollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { CURRENCY_OPTIONS, currencySymbol, formatPrice } from "@/lib/currency";

type PaymentType = "wallet" | "lesson";
type PaymentUnit = "lessons" | "amount";

interface OpenState {
  student: boolean;
  lesson: boolean;
  payment: boolean;
}

const STORAGE_KEY = "otutorhub_quick_actions";

const UKRAINIAN_MONTHS = [
  "січня",
  "лютого",
  "березня",
  "квітня",
  "травня",
  "червня",
  "липня",
  "серпня",
  "вересня",
  "жовтня",
  "листопада",
  "грудня",
];

function datePartsFromIso(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

function isoFromDateParts(year: number, month: number, day: number) {
  const safeMonth = Math.min(12, Math.max(1, month || 1));
  const maxDay = new Date(year || new Date().getFullYear(), safeMonth, 0).getDate();
  const safeDay = Math.min(maxDay, Math.max(1, day || 1));
  return `${String(year || new Date().getFullYear()).padStart(4, "0")}-${String(safeMonth).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

function formatUkrainianDateTimeFromParts(date: string, time: string) {
  const { year, month, day } = datePartsFromIso(date);
  const [hour, minute] = time.split(":");
  if (!year || !month || !day) return "";
  return `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}, ${String(hour || "00").padStart(2, "0")}:${String(minute || "00").padStart(2, "0")}`;
}

function ddmmyyyyFromIso(date: string) {
  const { year, month, day } = datePartsFromIso(date);
  if (!year || !month || !day) return "";
  return `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}`;
}

function isoFromDdmmyyyy(value: string): string | null {
  const m = value.trim().match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12) return null;
  const maxDay = new Date(year, month, 0).getDate();
  if (day < 1 || day > maxDay) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatUkrainianDateTime(iso: string) {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const hour = String(d.getHours()).padStart(2, "0");
  const minute = String(d.getMinutes()).padStart(2, "0");
  return `${day}.${month}.${year}, ${hour}:${minute}`;
}

async function ensureTutorHasSubject(tutorId: string, subject: string) {
  const normalized = subject.trim();
  if (!tutorId || !normalized) return;
  try {
    const { data, error } = await supabase
      .from("tutor_details")
      .select("subjects")
      .eq("user_id", tutorId)
      .maybeSingle();
    if (error) throw error;
    const current = Array.isArray((data as any)?.subjects) ? ((data as any).subjects as string[]) : [];
    if (current.includes(normalized)) return;
    const { error: upsertError } = await supabase
      .from("tutor_details")
      .upsert({ user_id: tutorId, subjects: [...current, normalized] }, { onConflict: "user_id" });
    if (upsertError) throw upsertError;
  } catch (error) {
    console.warn("Failed to sync tutor subject from quick actions", error);
  }
}

interface TutorOption {
  id: string;
  name: string;
}

interface StudentRow {
  rate_id: string;
  rate_key: string;
  tutor_id: string;
  tutor_name: string;
  student_id: string;
  name: string;
  subject: string;
  price: number;
  source: string;
  currency: string;
}

interface UnpaidLesson {
  id: string;
  starts_at: string;
  subject: string;
  student_id: string;
  tutor_id: string;
}

interface Props {
  onChanged?: () => void;
}

export function QuickActionsCard({ onChanged }: Props) {
  const { user, roles } = useAuth();
  const isManager = roles.includes("manager");
  const [open, setOpen] = useState<OpenState>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { student: true, lesson: true, payment: true, ...JSON.parse(raw) };
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
    return { student: true, lesson: true, payment: true };
  });

  const [students, setStudents] = useState<StudentRow[]>([]);
  const [tutors, setTutors] = useState<TutorOption[]>([]);
  const [lessonsCount, setLessonsCount] = useState(0);
  const [unpaid, setUnpaid] = useState<UnpaidLesson[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(open));
  }, [open]);

  const refresh = async () => {
    if (!user) return;
    setLoading(true);

    const ratesQuery = supabase
      .from("student_rates")
      .select("id, tutor_id, student_id, subject, price_per_lesson, archived_at, source, currency");
    const lessonsCountQuery = supabase.from("lessons").select("id", { count: "exact", head: true });
    const unpaidQuery = supabase
      .from("lesson_details")
      .select("lesson_id, lessons!inner(id, starts_at, subject, student_id, tutor_id, status)")
      .eq("student_payment_status", "unpaid")
      .neq("lessons.status", "cancelled")
      .neq("lessons.status", "pending")
      .limit(100);

    if (!isManager) {
      ratesQuery.eq("tutor_id", user.id).eq("source", "independent");
      lessonsCountQuery.eq("tutor_id", user.id);
      unpaidQuery.eq("lessons.tutor_id", user.id);
    }

    const [{ data: rates }, { count }, { data: details }, tutorRolesResult] = await Promise.all([
      ratesQuery,
      lessonsCountQuery,
      unpaidQuery,
      isManager
        ? supabase.from("user_roles").select("user_id, role").eq("role", "tutor")
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const active = (rates ?? []).filter((r: any) => !r.archived_at);
    const studentIds = Array.from(new Set(active.map((r: any) => r.student_id)));
    const tutorIds = Array.from(
      new Set([
        ...active.map((r: any) => r.tutor_id),
        ...((tutorRolesResult.data ?? []) as any[]).map((r) => r.user_id),
        ...(isManager ? [] : [user.id]),
      ].filter(Boolean))
    );
    const profileIds = Array.from(new Set([...studentIds, ...tutorIds]));

    const { data: profs } = profileIds.length
      ? await supabase.from("profiles").select("id, first_name, last_name").in("id", profileIds)
      : { data: [] as any[] };

    const nameOf = new Map(
      (profs ?? []).map((p: any) => [
        p.id,
        `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Без імені",
      ])
    );

    const tutorOptions = tutorIds
      .map((id) => ({ id, name: nameOf.get(id) ?? "Репетитор" }))
      .sort((a, b) => a.name.localeCompare(b.name, "uk"));
    setTutors(tutorOptions);

    const byPair = new Map<string, any>();
    active.forEach((r: any) => {
      const key = `${r.tutor_id}:${r.student_id}:${r.subject || ""}`;
      if (!byPair.has(key)) byPair.set(key, r);
    });

    const rows: StudentRow[] = Array.from(byPair.values()).map((r: any) => ({
      rate_id: r.id,
      rate_key: r.id || `${r.tutor_id}:${r.student_id}:${r.subject || ""}`,
      tutor_id: r.tutor_id,
      tutor_name: nameOf.get(r.tutor_id) ?? "Репетитор",
      student_id: r.student_id,
      name: nameOf.get(r.student_id) ?? "Учень",
      subject: r.subject || "",
      price: Number(r.price_per_lesson ?? 0),
      source: r.source || (isManager ? "hub" : "independent"),
      currency: r.currency ?? "UAH",
    }));
    rows.sort((a, b) => {
      const byStudent = a.name.localeCompare(b.name, "uk");
      return byStudent || a.tutor_name.localeCompare(b.tutor_name, "uk");
    });
    setStudents(rows);
    setLessonsCount(count ?? 0);

    const u = ((details ?? []) as any[])
      .map((d) => ({
        id: d.lessons.id,
        starts_at: d.lessons.starts_at,
        subject: d.lessons.subject,
        student_id: d.lessons.student_id,
        tutor_id: d.lessons.tutor_id,
      }))
      .sort((a, b) => (a.starts_at < b.starts_at ? 1 : -1));
    setUnpaid(u);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isManager]);

  const hasStudents = students.length > 0;
  const hasLessons = lessonsCount > 0;

  return (
    <Card className="p-3 sm:p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold text-foreground">Швидкі дії</h2>
      </div>

      {!hasStudents && !loading && (
        <p className="mb-3 text-xs text-muted-foreground">
          Додайте першого учня щоб почати 👋
        </p>
      )}

      <div className="space-y-2 lg:grid lg:grid-cols-3 lg:gap-3 lg:space-y-0 lg:items-start">
        <ActionTab
          icon={<UserPlus className="h-4 w-4" />}
          title="Учень"
          highlight={!hasStudents}
          isOpen={open.student}
          onToggle={() => setOpen((o) => ({ ...o, student: !o.student }))}
        >
          <AddStudentForm
            tutors={tutors}
            isManager={isManager}
            onCreated={() => { refresh(); onChanged?.(); }}
          />
        </ActionTab>

        <ActionTab
          icon={<CalendarPlus className="h-4 w-4" />}
          title="Урок"
          highlight={hasStudents && !hasLessons}
          isOpen={open.lesson}
          onToggle={() => setOpen((o) => ({ ...o, lesson: !o.lesson }))}
        >
          <AddLessonForm students={students} onCreated={() => { refresh(); onChanged?.(); }} />
        </ActionTab>

        <ActionTab
          icon={<BadgeDollarSign className="h-4 w-4" />}
          title="Отримана оплата"
          isOpen={open.payment}
          onToggle={() => setOpen((o) => ({ ...o, payment: !o.payment }))}
        >
          <AddPaymentForm
            students={students}
            unpaid={unpaid}
            onSaved={() => { refresh(); onChanged?.(); }}
          />
        </ActionTab>
      </div>
    </Card>
  );
}

function ActionTab({
  icon,
  title,
  highlight,
  isOpen,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  highlight?: boolean;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-background/50 transition-colors",
        highlight && "border-primary/40 bg-primary/5",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className="text-primary">{icon}</span>
          <span>＋ {title}</span>
        </span>
        <ChevronDown
          className={cn("h-4 w-4 text-muted-foreground transition-transform", isOpen && "rotate-180")}
        />
      </button>
      {isOpen && <div className="border-t border-border px-3 py-3">{children}</div>}
    </div>
  );
}

function AddStudentForm({
  tutors,
  isManager,
  onCreated,
}: {
  tutors: TutorOption[];
  isManager: boolean;
  onCreated: () => void;
}) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [tutorId, setTutorId] = useState("");
  const [subject, setSubject] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState<string>("UAH");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isManager && !tutorId && tutors[0]) setTutorId(tutors[0].id);
  }, [isManager, tutorId, tutors]);

  const submit = async () => {
    if (!user) return;
    const fn = name.trim();
    const ownerTutorId = isManager ? tutorId : user.id;
    if (!fn) return toast.error("Вкажіть ім'я учня");
    if (isManager && !ownerTutorId) return toast.error("Виберіть репетитора");
    if (!subject) return toast.error("Виберіть предмет");
    const normalizedSubject = subject.trim();
    const p = Number(price);
    if (isNaN(p) || p < 0) return toast.error("Введіть коректну ціну");

    setBusy(true);
    const newId = crypto.randomUUID();
    const { error: profErr } = await supabase
      .from("profiles")
      .insert({ id: newId, first_name: fn, last_name: "", is_pending: true });
    if (profErr) {
      setBusy(false);
      return toast.error(profErr.message || "Не вдалося");
    }
    const { error: roleErr } = await supabase.from("user_roles").insert({ user_id: newId, role: "student" });
    if (roleErr) {
      await supabase.from("profiles").delete().eq("id", newId);
      setBusy(false);
      return toast.error("Не вдалося призначити роль");
    }
    const { error: rateErr } = await supabase.from("student_rates").insert({
      tutor_id: ownerTutorId,
      student_id: newId,
      subject: normalizedSubject,
      price_per_lesson: p,
      currency,
      source: isManager ? "hub" : "independent",
    });
    setBusy(false);
    if (rateErr) {
      await supabase.from("user_roles").delete().eq("user_id", newId);
      await supabase.from("profiles").delete().eq("id", newId);
      return toast.error("Не вдалося зберегти");
    }
    await ensureTutorHasSubject(ownerTutorId, normalizedSubject);
    toast.success(`${fn} додано 🎉`);
    setName("");
    setSubject("");
    setPrice("");
    onCreated();
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Ім'я</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
        </div>
        {isManager && (
          <div className="space-y-1">
            <Label className="text-xs">Репетитор</Label>
            <Select value={tutorId} onValueChange={setTutorId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Виберіть" /></SelectTrigger>
              <SelectContent>
                {tutors.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-xs">Предмет</Label>
          <SubjectSelect value={subject} onValueChange={setSubject} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Ціна ({currencySymbol(currency)})</Label>
            <Input
              type="number"
              min={0}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Валюта</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CURRENCY_OPTIONS.map((c) => (
                  <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={submit} disabled={busy || (isManager && tutors.length === 0)}>
          {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Додати
        </Button>
      </div>
    </div>
  );
}

function AddLessonForm({
  students,
  onCreated,
}: {
  students: StudentRow[];
  onCreated: () => void;
}) {
  const { user } = useAuth();
  const today = new Date().toISOString().slice(0, 10);
  const [rateKey, setRateKey] = useState(students[0]?.rate_key ?? "");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("18:00");
  const [duration, setDuration] = useState("60");
  const [busy, setBusy] = useState(false);
  const { year, month, day } = datePartsFromIso(date);

  useEffect(() => {
    if (!rateKey && students[0]) setRateKey(students[0].rate_key);
  }, [students, rateKey]);

  const selected = students.find((x) => x.rate_key === rateKey);

  const submit = async () => {
    if (!user) return;
    if (!selected) return toast.error("Виберіть учня");
    if (!selected.subject) return toast.error("У учня не вказаний предмет");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return toast.error("Вкажіть час у форматі 18:00");
    setBusy(true);
    const startsAt = new Date(`${date}T${time}:00`);
    const { data: created, error } = await supabase
      .from("lessons")
      .insert({
        tutor_id: selected.tutor_id,
        student_id: selected.student_id,
        subject: selected.subject,
        starts_at: startsAt.toISOString(),
        duration_minutes: Number(duration) || 60,
        status: "scheduled" as const,
        created_by: user.id,
        source: selected.source || "independent",
      })
      .select("id")
      .single();
    if (!error && created) {
      await supabase
        .from("lesson_details")
        .upsert(
          { lesson_id: created.id, student_price: selected.price || 0, tutor_payout: 0 } as any,
          { onConflict: "lesson_id" },
        );
    }
    setBusy(false);
    if (error) return toast.error(error.message || "Не вдалося");
    toast.success("Урок створено");
    onCreated();
  };

  if (students.length === 0) {
    return <p className="text-xs text-muted-foreground">Спочатку додайте учня — після цього урок створюється за кілька секунд.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Учень</Label>
          <Select value={rateKey} onValueChange={setRateKey}>
            <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {students.map((s) => (
                <SelectItem key={s.rate_key} value={s.rate_key}>
                  {s.name} {s.subject ? `· ${s.subject}` : ""} {s.tutor_name ? `· ${s.tutor_name}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selected && (
            <p className="text-[11px] text-muted-foreground">
              Ціна за урок: <span className="font-medium text-foreground">{formatPrice(selected.price, selected.currency)}</span>
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Тривалість, хв</Label>
          <Input
            type="number"
            min={15}
            step={15}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="h-9"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Число</Label>
          <Input
            type="number"
            min={1}
            max={31}
            value={day || ""}
            onChange={(e) => setDate(isoFromDateParts(year, month, Number(e.target.value)))}
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Місяць</Label>
          <Select value={String(month || 1)} onValueChange={(v) => setDate(isoFromDateParts(year, Number(v), day))}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {UKRAINIAN_MONTHS.map((name, index) => (
                <SelectItem key={name} value={String(index + 1)}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Рік</Label>
          <Input
            type="number"
            min={2024}
            max={2100}
            value={year || ""}
            onChange={(e) => setDate(isoFromDateParts(Number(e.target.value), month, day))}
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Час, 24 год</Label>
          <Input
            type="text"
            inputMode="numeric"
            pattern="[0-2][0-9]:[0-5][0-9]"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            placeholder="18:00"
            className="h-9"
          />
        </div>
      </div>
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
        <p className="text-[11px] font-medium uppercase text-muted-foreground">Дата і час уроку</p>
        <p className="text-sm font-semibold text-foreground">{formatUkrainianDateTimeFromParts(date, time)}</p>
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={submit} disabled={busy}>
          {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Додати
        </Button>
      </div>
    </div>
  );
}

function AddPaymentForm({
  students,
  unpaid,
  onSaved,
}: {
  students: StudentRow[];
  unpaid: UnpaidLesson[];
  onSaved: () => void;
}) {
  const [rateKey, setRateKey] = useState(students[0]?.rate_key ?? "");
  const [paymentType, setPaymentType] = useState<PaymentType>("wallet");
  const [paymentUnit, setPaymentUnit] = useState<PaymentUnit>("amount");
  const [lessonId, setLessonId] = useState("");
  const [lessonsCount, setLessonsCount] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!rateKey && students[0]) setRateKey(students[0].rate_key);
  }, [students, rateKey]);

  const selected = useMemo(
    () => students.find((s) => s.rate_key === rateKey) ?? null,
    [students, rateKey],
  );
  const selectedCurrency = selected?.currency ?? "UAH";
  const selectedCurrencySymbol = currencySymbol(selectedCurrency);

  const lessonOptions = useMemo(
    () => selected ? unpaid.filter((u) => u.student_id === selected.student_id && u.tutor_id === selected.tutor_id) : [],
    [unpaid, selected],
  );

  useEffect(() => {
    if (lessonOptions[0]) setLessonId(lessonOptions[0].id);
    else setLessonId("");
  }, [lessonOptions]);

  const submit = async () => {
    if (!selected) return toast.error("Виберіть учня");
    setBusy(true);

    if (paymentType === "lesson") {
      if (!lessonId) {
        setBusy(false);
        return toast.error("Виберіть урок");
      }
      const { error } = await supabase
        .from("lesson_details")
        .upsert(
          { lesson_id: lessonId, student_payment_status: "paid", student_paid_at: new Date().toISOString() } as any,
          { onConflict: "lesson_id" },
        );
      setBusy(false);
      if (error) return toast.error(error.message);
      toast.success("Позначено як оплачено");
      onSaved();
      return;
    }

    let lessonsDelta = 0;
    let amountDelta = 0;
    if (paymentUnit === "lessons") {
      const n = parseInt(lessonsCount, 10);
      if (!Number.isFinite(n) || n <= 0) {
        setBusy(false);
        return toast.error("Вкажіть додатну кількість уроків");
      }
      lessonsDelta = n;
    } else {
      const n = parseFloat(amount.replace(",", "."));
      if (!Number.isFinite(n) || n <= 0) {
        setBusy(false);
        return toast.error("Вкажіть додатну суму");
      }
      amountDelta = n;
    }

    const { error } = await supabase.rpc("wallet_topup" as any, {
      _tutor_id: selected.tutor_id,
      _student_id: selected.student_id,
      _lessons_delta: lessonsDelta,
      _amount_delta: amountDelta,
      _note: note.trim() || "Отримана оплата",
    });
    setBusy(false);
    if (error) return toast.error("Не вдалося зберегти оплату", { description: error.message });
    toast.success("Оплату додано");
    setLessonsCount("");
    setAmount("");
    setNote("");
    onSaved();
  };

  if (students.length === 0) {
    return <p className="text-xs text-muted-foreground">Спочатку додайте учня — тоді тут можна буде швидко внести оплату.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Учень</Label>
          <Select value={rateKey} onValueChange={setRateKey}>
            <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {students.map((s) => (
                <SelectItem key={s.rate_key} value={s.rate_key}>
                  {s.name} · {s.subject || "предмет"} · {formatPrice(s.price, s.currency)} · {s.tutor_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selected && (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Валюта оплати</span>
                <span className="font-semibold text-foreground">{selectedCurrency} · {selectedCurrencySymbol}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Ціна уроку</span>
                <span className="font-semibold text-foreground">{formatPrice(selected.price, selectedCurrency)}</span>
              </div>
            </div>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Дія</Label>
          <Select value={paymentType} onValueChange={(v) => setPaymentType(v as PaymentType)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="wallet">Додати отриману оплату</SelectItem>
              <SelectItem value="lesson" disabled={lessonOptions.length === 0}>Позначити урок оплаченим</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {paymentType === "lesson" ? (
        <div className="space-y-1">
          <Label className="text-xs">Урок</Label>
          <Select value={lessonId} onValueChange={setLessonId}>
            <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {lessonOptions.map((u) => {
                return (
                  <SelectItem key={u.id} value={u.id}>
                    {formatUkrainianDateTime(u.starts_at)} · {u.subject}
                    {selected ? ` · ${formatPrice(selected.price, selected.currency)}` : ""}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Формат</Label>
              <Select value={paymentUnit} onValueChange={(v) => setPaymentUnit(v as PaymentUnit)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="amount">Сума ({selectedCurrencySymbol})</SelectItem>
                  <SelectItem value="lessons">Кількість уроків</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                {paymentUnit === "lessons" ? `Кількість уроків · ${formatPrice(selected?.price ?? 0, selectedCurrency)} за урок` : `Сума оплати (${selectedCurrencySymbol})`}
              </Label>
              <Input
                type="number"
                min={paymentUnit === "lessons" ? 1 : 0}
                step={paymentUnit === "lessons" ? 1 : 0.01}
                value={paymentUnit === "lessons" ? lessonsCount : amount}
                onChange={(e) => paymentUnit === "lessons" ? setLessonsCount(e.target.value) : setAmount(e.target.value)}
                placeholder={paymentUnit === "lessons" ? "напр. 4" : `напр. 500 ${selectedCurrencySymbol}`}
                className="h-9"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Коментар</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="напр. готівка, переказ"
              className="h-9"
            />
          </div>
        </>
      )}

      <div className="flex justify-end">
        <Button size="sm" onClick={submit} disabled={busy || !selected}>
          {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Зберегти
        </Button>
      </div>
    </div>
  );
}

export default QuickActionsCard;
