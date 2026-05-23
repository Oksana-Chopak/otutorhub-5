/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubjectComboBox } from "@/components/SubjectComboBox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CURRENCY_OPTIONS, currencySymbol, formatPrice } from "@/lib/currency";
import { CurrencyComboBox } from "@/components/CurrencyComboBox";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

type PaymentType = "wallet" | "lesson";
type PaymentUnit = "lessons" | "amount";

interface OpenState {
  student: boolean;
  lesson: boolean;
  payment: boolean;
}

const STORAGE_KEY = "otutorhub_quick_actions";

const UKRAINIAN_MONTHS = [
  t("monthsGen").split(",")[0],
  t("monthsGen").split(",")[1],
  t("monthsGen").split(",")[2],
  t("monthsGen").split(",")[3],
  t("monthsGen").split(",")[4],
  t("monthsGen").split(",")[5],
  t("monthsGen").split(",")[6],
  t("monthsGen").split(",")[7],
  t("monthsGen").split(",")[8],
  t("monthsGen").split(",")[9],
  t("monthsGen").split(",")[10],
  t("monthsGen").split(",")[11],
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
        `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || t("quickActionsCard.noName"),
      ])
    );

    const tutorOptions = tutorIds
      .map((id) => ({ id, name: nameOf.get(id) ?? t("quickActionsCard.tutorFallback") }))
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
      tutor_name: nameOf.get(r.tutor_id) ?? t("quickActionsCard.tutorFallback"),
      student_id: r.student_id,
      name: nameOf.get(r.student_id) ?? t("quickActionsCard.studentFallback"),
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

  const initialTab: keyof OpenState = !hasStudents
    ? "student"
    : !hasLessons
      ? "lesson"
      : "student";
  const [activeTab, setActiveTab] = useState<keyof OpenState>(initialTab);

  const tabs: { id: keyof OpenState; emoji: string; label: string; highlight?: boolean }[] = [
    { id: "student", emoji: "➕", label: t("quickActionsCard.addStudent"), highlight: !hasStudents },
    { id: "lesson", emoji: "📅", label: t("quickActionsCard.addLesson"), highlight: hasStudents && !hasLessons },
    { id: "payment", emoji: "💰", label: t("quickActionsCard.addPayment") },
  ];

  const renderPanel = (id: keyof OpenState) => {
    if (id === "student")
      return (
        <AddStudentForm
          tutors={tutors}
          isManager={isManager}
          onCreated={() => { refresh(); onChanged?.(); }}
        />
      );
    if (id === "lesson")
      return <AddLessonForm students={students} onCreated={() => { refresh(); onChanged?.(); }} />;
    return (
      <AddPaymentForm
        students={students}
        unpaid={unpaid}
        onSaved={() => { refresh(); onChanged?.(); }}
      />
    );
  };

  return (
    <Card className="p-3 sm:p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold text-foreground">{t("quickActionsCard.title")}</h2>
      </div>

      {!hasStudents && !loading && (
        <p className="mb-3 text-sm text-muted-foreground">
          {t("quickActionsCard.emptyStartHint")}
        </p>
      )}

      {/* Mobile: accordion with emoji icons */}
      <div className="space-y-2 lg:hidden">
        {tabs.map((tb) => (
          <ActionTab
            key={tb.id}
            emoji={tb.emoji}
            title={tb.label}
            highlight={tb.highlight}
            isOpen={open[tb.id]}
            onToggle={() => setOpen((o) => ({ ...o, [tb.id]: !o[tb.id] }))}
          >
            {renderPanel(tb.id)}
          </ActionTab>
        ))}
      </div>

      {/* Desktop: single window with tab switcher */}
      <div className="hidden lg:block">
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-3 border-b border-border bg-muted/40" role="tablist">
            {tabs.map((tb) => {
              const isActive = activeTab === tb.id;
              return (
                <button
                  key={tb.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(tb.id)}
                  className={cn(
                    "flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors border-b-2",
                    isActive
                      ? "bg-card text-foreground border-primary"
                      : "text-muted-foreground hover:text-foreground border-transparent",
                    tb.highlight && !isActive && "text-primary",
                  )}
                >
                  <span className="text-lg leading-none">{tb.emoji}</span>
                  <span>{tb.label}</span>
                </button>
              );
            })}
          </div>
          <div className="bg-card px-4 py-4">{renderPanel(activeTab)}</div>
        </div>
      </div>
    </Card>
  );
}

function ActionTab({
  emoji,
  title,
  highlight,
  isOpen,
  onToggle,
  children,
}: {
  emoji: string;
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
          <span className="text-lg leading-none">{emoji}</span>
          <span>{title}</span>
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
    if (!fn) return toast.error(t("quickActionsCard.nameRequired"));
    if (isManager && !ownerTutorId) return toast.error(t("quickActionsCard.tutorRequired"));
    if (!subject) return toast.error(t("quickActionsCard.subjectRequired"));
    const normalizedSubject = subject.trim();
    const p = Number(price);
    if (isNaN(p) || p < 0) return toast.error(t("quickActionsCard.invalidPrice"));

    setBusy(true);
    const newId = crypto.randomUUID();
    const { error: profErr } = await supabase
      .from("profiles")
      .insert({ id: newId, first_name: fn, last_name: "", is_pending: true });
    if (profErr) {
      setBusy(false);
      return toast.error(profErr.message || t("quickActionsCard.createProfileFailed"));
    }
    const { error: roleErr } = await supabase.from("user_roles").insert({ user_id: newId, role: "student" });
    if (roleErr) {
      await supabase.from("profiles").delete().eq("id", newId);
      setBusy(false);
      return toast.error(t("quickActionsCard.roleFailed"));
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
      return toast.error(t("quickActionsCard.saveFailed"));
    }
    await ensureTutorHasSubject(ownerTutorId, normalizedSubject);
    toast.success(t("quickActionsCard.studentAdded", { name: fn }));
    setName("");
    setSubject("");
    setPrice("");
    onCreated();
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2">
        <div className="space-y-1">
          <Label className="text-sm font-medium">Ім'я</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-10 md:h-9" />
        </div>
        {isManager && (
          <div className="space-y-1">
            <Label className="text-sm font-medium">{t("quickActionsCard.tutorLabel")}</Label>
            <Select value={tutorId} onValueChange={setTutorId}>
              <SelectTrigger className="h-10 md:h-9"><SelectValue placeholder={t("quickActionsCard.selectPlaceholder")} /></SelectTrigger>
              <SelectContent>
                {tutors.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-sm font-medium">{t("quickActionsCard.subjectLabel")}</Label>
          <SubjectComboBox value={subject} onChange={setSubject} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-sm font-medium">{t("quickActionsCard.priceLabel", { symbol: currencySymbol(currency) })}</Label>
            <Input
              type="number"
              min={0}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="h-10 md:h-9"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-sm font-medium">{t("quickActionsCard.currencyLabel")}</Label>
            <CurrencyComboBox value={currency} onChange={setCurrency} className="h-10 md:h-9" />
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
  const [dateInput, setDateInput] = useState(ddmmyyyyFromIso(date));
  useEffect(() => { setDateInput(ddmmyyyyFromIso(date)); }, [date]);

  useEffect(() => {
    if (!rateKey && students[0]) setRateKey(students[0].rate_key);
  }, [students, rateKey]);

  const selected = students.find((x) => x.rate_key === rateKey);

  const submit = async () => {
    if (!user) return;
    if (!selected) return toast.error(t("quickActionsCard.selectStudent"));
    if (!selected.subject) return toast.error(t("quickActionsCard.noSubjectOnStudent"));
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return toast.error(t("quickActionsCard.invalidTime"));
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
    if (error) return toast.error(error.message || t("quickActionsCard.lessonCreateFailed"));
    toast.success(t("quickActionsCard.lessonCreated"));
    onCreated();
  };

  if (students.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("quickActionsCard.firstAddStudent")}</p>;
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2">
        <div className="space-y-1">
          <Label className="text-sm font-medium">{t("quickActionsCard.studentLabel")}</Label>
          <Select value={rateKey} onValueChange={setRateKey}>
            <SelectTrigger className="h-10 md:h-9"><SelectValue placeholder="—" /></SelectTrigger>
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
          <Label className="text-sm font-medium">{t("quickActionsCard.durationLabel")}</Label>
          <Input
            type="number"
            min={15}
            step={15}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="h-10 md:h-9"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-sm font-medium">{t("quickActionsCard.dateLabel")}</Label>
          <Input
            type="text"
            inputMode="numeric"
            value={dateInput}
            onChange={(e) => {
              setDateInput(e.target.value);
              const iso = isoFromDdmmyyyy(e.target.value);
              if (iso) setDate(iso);
            }}
            placeholder="11.05.2026"
            className="h-10 md:h-9"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-sm font-medium">{t("quickActionsCard.timeLabel")}</Label>
          <Input
            type="text"
            inputMode="numeric"
            pattern="[0-2][0-9]:[0-5][0-9]"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            placeholder="18:00"
            className="h-10 md:h-9"
          />
        </div>
      </div>
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
        <p className="text-[11px] font-medium uppercase text-muted-foreground">{t("quickActionsCard.dateTimeLabel")}</p>
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
    if (!selected) return toast.error(t("quickActionsCard.selectStudent"));
    setBusy(true);

    if (paymentType === "lesson") {
      if (!lessonId) {
        setBusy(false);
        return toast.error(t("quickActionsCard.selectLesson"));
      }
      const { error } = await supabase
        .from("lesson_details")
        .upsert(
          { lesson_id: lessonId, student_payment_status: "paid", student_paid_at: new Date().toISOString() } as any,
          { onConflict: "lesson_id" },
        );
      setBusy(false);
      if (error) return toast.error(error.message);
      toast.success(t("quickActionsCard.markedPaid"));
      onSaved();
      return;
    }

    let lessonsDelta = 0;
    let amountDelta = 0;
    if (paymentUnit === "lessons") {
      const n = parseInt(lessonsCount, 10);
      if (!Number.isFinite(n) || n <= 0) {
        setBusy(false);
        return toast.error(t("quickActionsCard.lessonsRequired"));
      }
      lessonsDelta = n;
    } else {
      const n = parseFloat(amount.replace(",", "."));
      if (!Number.isFinite(n) || n <= 0) {
        setBusy(false);
        return toast.error(t("quickActionsCard.amountRequired"));
      }
      amountDelta = n;
    }

    const { error } = await supabase.rpc("wallet_topup" as any, {
      _tutor_id: selected.tutor_id,
      _student_id: selected.student_id,
      _lessons_delta: lessonsDelta,
      _amount_delta: amountDelta,
      _note: note.trim() || t("quickActionsCard.defaultNote"),
    });
    setBusy(false);
    if (error) return toast.error(t("quickActionsCard.paymentSaveFailed"), { description: error.message });
    toast.success(t("quickActionsCard.paymentAdded"));
    setLessonsCount("");
    setAmount("");
    setNote("");
    onSaved();
  };

  if (students.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("quickActionsCard.firstAddStudentPayment")}</p>;
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2">
        <div className="space-y-1">
          <Label className="text-sm font-medium">{t("quickActionsCard.studentLabel")}</Label>
          <Select value={rateKey} onValueChange={setRateKey}>
            <SelectTrigger className="h-10 md:h-9"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {students.map((s) => (
                <SelectItem key={s.rate_key} value={s.rate_key}>
                  {s.name} · {s.subject || t("quickActionsCard.subjectFallback")} · {formatPrice(s.price, s.currency)} · {s.tutor_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selected && (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t("quickActionsCard.currencyPayment")}</span>
                <span className="font-semibold text-foreground">{selectedCurrency} · {selectedCurrencySymbol}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t("quickActionsCard.lessonPrice")}</span>
                <span className="font-semibold text-foreground">{formatPrice(selected.price, selectedCurrency)}</span>
              </div>
            </div>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-sm font-medium">{t("quickActionsCard.actionLabel")}</Label>
          <Select value={paymentType} onValueChange={(v) => setPaymentType(v as PaymentType)}>
            <SelectTrigger className="h-10 md:h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="wallet">{t("quickActionsCard.addWalletPayment")}</SelectItem>
              <SelectItem value="lesson" disabled={lessonOptions.length === 0}>{t("quickActionsCard.markLessonPaid")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {paymentType === "lesson" ? (
        <div className="space-y-1">
          <Label className="text-sm font-medium">{t("quickActionsCard.lessonLabel")}</Label>
          <Select value={lessonId} onValueChange={setLessonId}>
            <SelectTrigger className="h-10 md:h-9"><SelectValue placeholder="—" /></SelectTrigger>
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
              <Label className="text-sm font-medium">{t("quickActionsCard.formatLabel")}</Label>
              <Select value={paymentUnit} onValueChange={(v) => setPaymentUnit(v as PaymentUnit)}>
                <SelectTrigger className="h-10 md:h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="amount">{t("quickActionsCard.byAmount", { symbol: selectedCurrencySymbol })}</SelectItem>
                  <SelectItem value="lessons">{t("quickActionsCard.byLessons")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-sm font-medium">
                {paymentUnit === "lessons" ? `Кількість уроків · ${formatPrice(selected?.price ?? 0, selectedCurrency)} за урок` : `Сума оплати (${selectedCurrencySymbol})`}
              </Label>
              <Input
                type="number"
                min={paymentUnit === "lessons" ? 1 : 0}
                step={paymentUnit === "lessons" ? 1 : 0.01}
                value={paymentUnit === "lessons" ? lessonsCount : amount}
                onChange={(e) => paymentUnit === "lessons" ? setLessonsCount(e.target.value) : setAmount(e.target.value)}
                placeholder={paymentUnit === "lessons" ? t("quickActionsCard.countPlaceholder") : t("quickActionsCard.amountPlaceholder", { symbol: selectedCurrencySymbol })}
                className="h-10 md:h-9"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-sm font-medium">{t("quickActionsCard.commentLabel")}</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("quickActionsCard.commentPlaceholder")}
              className="h-10 md:h-9"
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
