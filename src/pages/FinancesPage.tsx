import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { StatCard } from "@/components/StatCard";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowDownLeft,
  ArrowUpRight,
  TrendingUp,
  DollarSign,
  Loader2,
  Download,
  CheckCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { FinanceWeeklyChart } from "@/components/FinanceWeeklyChart";
import { Percent } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";

type PaymentStatus = "paid" | "unpaid";
type LessonStatus = "pending" | "scheduled" | "completed" | "cancelled";

interface LessonRow {
  id: string;
  subject: string;
  starts_at: string;
  status: LessonStatus;
  student_id: string;
  tutor_id: string;
  student_price: number;
  tutor_payout: number;
  student_payment_status: PaymentStatus;
  tutor_payout_status: PaymentStatus;
  student_paid_at: string | null;
  tutor_paid_at: string | null;
}

interface Profile {
  id: string;
  first_name: string;
  last_name: string;
}

const monthKey = (iso: string) => iso.slice(0, 7);
const formatMonth = (key: string) => {
  const [y, m] = key.split("-");
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleDateString("uk-UA", { month: "long", year: "numeric" });
};
const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

export default function FinancesPage() {
  const { roles } = useAuth();
  const { isIndependent } = useWorkspaceSettings();
  const isManager = roles.includes("manager");
  const isTutor = roles.includes("tutor");
  const isIndependentTutor = isTutor && !isManager && isIndependent;

  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [tutorFilter, setTutorFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all"); // all|need_pay|need_payout|done
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const [{ data: lessonsData, error: lErr }, { data: profilesData, error: pErr }] =
      await Promise.all([
        supabase
          .from("lessons_visible")
          .select(
            "id, subject, starts_at, status, student_id, tutor_id, student_price, tutor_payout, student_payment_status, tutor_payout_status, student_paid_at, tutor_paid_at"
          )
          .order("starts_at", { ascending: false }),
        supabase.from("profiles").select("id, first_name, last_name"),
      ]);
    if (lErr) toast.error("Помилка завантаження уроків");
    if (pErr) toast.error("Помилка завантаження профілів");
    setLessons((lessonsData ?? []) as LessonRow[]);
    const map: Record<string, Profile> = {};
    (profilesData ?? []).forEach((p) => (map[p.id] = p as Profile));
    setProfiles(map);
    setSelected(new Set());
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const nameOf = (id: string) => {
    const p = profiles[id];
    if (!p) return "—";
    return `${p.first_name} ${p.last_name}`.trim() || "Без імені";
  };

  const months = useMemo(() => {
    const set = new Set(lessons.map((l) => monthKey(l.starts_at)));
    return Array.from(set).sort().reverse();
  }, [lessons]);

  const tutorOptions = useMemo(() => {
    const ids = Array.from(new Set(lessons.map((l) => l.tutor_id)));
    return ids
      .map((id) => ({ id, name: nameOf(id) }))
      .sort((a, b) => a.name.localeCompare(b.name, "uk"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessons, profiles]);

  const filtered = useMemo(
    () =>
      lessons.filter(
        (l) =>
          (monthFilter === "all" || monthKey(l.starts_at) === monthFilter) &&
          (tutorFilter === "all" || l.tutor_id === tutorFilter)
      ),
    [lessons, monthFilter, tutorFilter]
  );

  const billable = filtered.filter((l) => l.status === "completed");

  const visibleRows = useMemo(() => {
    switch (statusFilter) {
      case "need_pay":
        return billable.filter((l) => l.student_payment_status === "unpaid");
      case "need_payout":
        return billable.filter((l) => l.tutor_payout_status === "unpaid");
      case "done":
        return billable.filter(
          (l) =>
            l.student_payment_status === "paid" && l.tutor_payout_status === "paid"
        );
      default:
        return billable;
    }
  }, [billable, statusFilter]);

  const totalIncome = billable
    .filter((l) => l.student_payment_status === "paid")
    .reduce((s, l) => s + Number(l.student_price), 0);
  const totalExpense = billable
    .filter((l) => l.tutor_payout_status === "paid")
    .reduce((s, l) => s + Number(l.tutor_payout), 0);
  const profit = totalIncome - totalExpense;
  const pendingIncome = billable
    .filter((l) => l.student_payment_status === "unpaid")
    .reduce((s, l) => s + Number(l.student_price), 0);
  const pendingExpense = billable
    .filter((l) => l.tutor_payout_status === "unpaid")
    .reduce((s, l) => s + Number(l.tutor_payout), 0);

  // Markup % ("маржа" як націнка): (income - payout) / payout * 100
  // Рахуємо тільки по уроках, де відомі обидві суми (price > 0 і payout > 0),
  // інакше націнка не визначена.
  const computeMarkup = (rows: LessonRow[]): number | null => {
    const valid = rows.filter(
      (l) => l.status === "completed" && Number(l.student_price) > 0 && Number(l.tutor_payout) > 0
    );
    if (valid.length === 0) return null;
    const income = valid.reduce((s, l) => s + Number(l.student_price), 0);
    const payout = valid.reduce((s, l) => s + Number(l.tutor_payout), 0);
    if (payout === 0) return null;
    return ((income - payout) / payout) * 100;
  };

  const hubMarkup = useMemo(() => computeMarkup(billable), [billable]);

  const markupByTutor = useMemo(() => {
    const groups: Record<string, LessonRow[]> = {};
    billable.forEach((l) => {
      if (!groups[l.tutor_id]) groups[l.tutor_id] = [];
      groups[l.tutor_id].push(l);
    });
    return Object.entries(groups)
      .map(([tutorId, rows]) => ({
        tutorId,
        name: nameOf(tutorId),
        markup: computeMarkup(rows),
        lessonsCount: rows.length,
      }))
      .filter((r) => r.markup !== null)
      .sort((a, b) => (b.markup ?? 0) - (a.markup ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billable, profiles]);

  const togglePayment = async (
    lesson: LessonRow,
    field: "student_payment_status" | "tutor_payout_status"
  ) => {
    const next: PaymentStatus = lesson[field] === "paid" ? "unpaid" : "paid";
    const payload =
      field === "student_payment_status"
        ? { student_payment_status: next }
        : { tutor_payout_status: next };
    const { error } = await supabase.from("lessons").update(payload).eq("id", lesson.id);
    if (error) {
      toast.error("Не вдалося оновити статус");
      return;
    }
    toast.success(next === "paid" ? "Позначено як оплачено" : "Скинуто на неоплачено");
    fetchData();
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === visibleRows.length && visibleRows.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleRows.map((r) => r.id)));
    }
  };

  const bulkMark = async (field: "student_payment_status" | "tutor_payout_status") => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    const payload =
      field === "student_payment_status"
        ? { student_payment_status: "paid" as PaymentStatus }
        : { tutor_payout_status: "paid" as PaymentStatus };
    const { error } = await supabase.from("lessons").update(payload).in("id", ids);
    setBulkBusy(false);
    if (error) {
      toast.error("Не вдалося оновити записи");
      return;
    }
    toast.success(`Оновлено ${ids.length} записів`);
    fetchData();
  };

  const exportCsv = () => {
    const header = [
      "Дата",
      "Предмет",
      "Учень",
      "Ціна учня (₴)",
      "Статус оплати учня",
      "Дата оплати учня",
      "Репетитор",
      "Виплата (₴)",
      "Статус виплати",
      "Дата виплати",
      "Прибуток (₴)",
    ];
    const rows = visibleRows.map((l) => [
      formatDate(l.starts_at),
      l.subject,
      nameOf(l.student_id),
      String(l.student_price),
      l.student_payment_status === "paid" ? "Оплачено" : "Очікує",
      l.student_paid_at ? formatDate(l.student_paid_at) : "",
      nameOf(l.tutor_id),
      String(l.tutor_payout),
      l.tutor_payout_status === "paid" ? "Виплачено" : "Очікує",
      l.tutor_paid_at ? formatDate(l.tutor_paid_at) : "",
      String(Number(l.student_price) - Number(l.tutor_payout)),
    ]);
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((r) => r.map(escape).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `finances_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("CSV завантажено");
  };

  const allSelected = selected.size === visibleRows.length && visibleRows.length > 0;
  const someSelected = selected.size > 0 && !allSelected;

  return (
    <AppLayout>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Фінанси</h1>
          <p className="text-sm text-muted-foreground">
            {isIndependentTutor
              ? "Оплати від ваших учнів"
              : "Оплати від учнів та виплати репетиторам"}
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-3 sm:w-auto">
          {!isIndependentTutor && (
            <div className="w-full sm:w-44">
              <Select value={tutorFilter} onValueChange={setTutorFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Репетитор" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Всі репетитори</SelectItem>
                  {tutorOptions.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="w-full sm:w-44">
            <Select value={monthFilter} onValueChange={setMonthFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Період" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Всі періоди</SelectItem>
                {months.map((m) => (
                  <SelectItem key={m} value={m}>
                    {formatMonth(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full sm:w-44">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Статус" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Всі статуси</SelectItem>
                <SelectItem value="need_pay">Очікує оплати учня</SelectItem>
                {!isIndependentTutor && (
                  <SelectItem value="need_payout">Очікує виплати</SelectItem>
                )}
                <SelectItem value="done">Все закрито</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Завантаження...
        </div>
      ) : (
        <>
          <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${isIndependentTutor ? "lg:grid-cols-2" : "lg:grid-cols-4 xl:grid-cols-5"}`}>
            <StatCard
              label={isIndependentTutor ? "Отримано" : "Надходження"}
              value={`${totalIncome} ₴`}
              icon={ArrowDownLeft}
              variant="success"
            />
            {!isIndependentTutor && (
              <StatCard label="Виплати" value={`${totalExpense} ₴`} icon={ArrowUpRight} />
            )}
            {!isIndependentTutor && (
              <StatCard
                label="Прибуток"
                value={`${profit} ₴`}
                icon={TrendingUp}
                variant={profit >= 0 ? "success" : "warning"}
              />
            )}
            <StatCard
              label={isIndependentTutor ? "Очікує оплати" : "Очікує (отримати/виплатити)"}
              value={isIndependentTutor ? `${pendingIncome} ₴` : `${pendingIncome} / ${pendingExpense} ₴`}
              icon={DollarSign}
              variant="warning"
            />
            {!isIndependentTutor && (
              <div className="col-span-2 rounded-xl border border-border bg-card p-3 lg:col-span-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium leading-tight text-muted-foreground sm:text-xs">
                      Середня націнка хабу
                    </p>
                    <p
                      className={`mt-1 truncate font-display text-lg font-bold sm:text-xl ${
                        hubMarkup === null
                          ? "text-muted-foreground"
                          : hubMarkup >= 0
                          ? "text-success"
                          : "text-destructive"
                      }`}
                    >
                      {hubMarkup === null ? "—" : `${hubMarkup.toFixed(1)}%`}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      (надходження − виплати) / виплати
                    </p>
                  </div>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Percent className="h-3.5 w-3.5 text-primary" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {!isIndependentTutor && (
            <div className="mt-6 rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">
                  Тижнева динаміка прибутку по репетиторах (12 тижнів)
                </h2>
                <span className="text-xs text-muted-foreground">Завершені уроки</span>
              </div>
              <FinanceWeeklyChart
                tutorNames={Object.fromEntries(
                  Object.values(profiles).map((p) => [
                    p.id,
                    `${p.first_name} ${p.last_name}`.trim() || "Без імені",
                  ])
                )}
                lessons={filtered.map((l) => ({
                  starts_at: l.starts_at,
                  status: l.status,
                  tutor_id: l.tutor_id,
                  student_price: Number(l.student_price),
                  tutor_payout: Number(l.tutor_payout),
                  student_payment_status: l.student_payment_status,
                  tutor_payout_status: l.tutor_payout_status,
                }))}
              />
            </div>
          )}
          {!isIndependentTutor && (
            <div className="mt-6 rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">
                  Середня націнка по репетиторах
                </h2>
                <span className="text-xs text-muted-foreground">
                  (ціна учня − виплата) / виплата
                </span>
              </div>
              {markupByTutor.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Немає даних: для розрахунку потрібні завершені уроки з заповненими ціною учня та виплатою.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="px-2 py-2 text-left font-medium">Репетитор</th>
                        <th className="px-2 py-2 text-right font-medium">Уроків</th>
                        <th className="px-2 py-2 text-right font-medium">Націнка</th>
                      </tr>
                    </thead>
                    <tbody>
                      {markupByTutor.map((row) => (
                        <tr key={row.tutorId} className="border-b border-border last:border-0">
                          <td className="px-2 py-2 text-foreground">{row.name}</td>
                          <td className="px-2 py-2 text-right text-muted-foreground">
                            {row.lessonsCount}
                          </td>
                          <td
                            className={`px-2 py-2 text-right font-semibold ${
                              (row.markup ?? 0) >= 0 ? "text-success" : "text-destructive"
                            }`}
                          >
                            {row.markup === null ? "—" : `${row.markup.toFixed(1)}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Bulk action bar */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {selected.size > 0 ? (
                <span className="font-medium text-foreground">
                  Обрано: {selected.size}
                </span>
              ) : (
                <span>Оберіть рядки для масових дій</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={selected.size === 0 || bulkBusy}
                onClick={() => bulkMark("student_payment_status")}
              >
                <CheckCheck className="h-4 w-4" />
                Учні оплатили
              </Button>
              {!isIndependentTutor && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={selected.size === 0 || bulkBusy}
                  onClick={() => bulkMark("tutor_payout_status")}
                >
                  <CheckCheck className="h-4 w-4" />
                  Виплачено репетиторам
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={exportCsv}>
                <Download className="h-4 w-4" />
                Експорт CSV
              </Button>
            </div>
          </div>

          {/* Unified table */}
          <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
            {visibleRows.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={DollarSign}
                  title="Немає платежів за фільтрами"
                  description="Спробуйте змінити місяць, репетитора або скиньте фільтри. Завершені уроки з'являться тут одразу."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/50">
                      <th className="px-3 py-3 w-10">
                        <Checkbox
                          checked={allSelected ? true : someSelected ? "indeterminate" : false}
                          onCheckedChange={toggleAll}
                          aria-label="Обрати все"
                        />
                      </th>
                      <th className="px-3 py-3 text-left font-medium text-muted-foreground">
                        Дата
                      </th>
                      <th className="px-3 py-3 text-left font-medium text-muted-foreground">
                        Урок
                      </th>
                      <th className="px-3 py-3 text-left font-medium text-muted-foreground">
                        Учень
                      </th>
                      <th className="px-3 py-3 text-right font-medium text-success">
                        Надходження
                      </th>
                      <th className="px-3 py-3 text-left font-medium text-muted-foreground">
                        Репетитор
                      </th>
                      <th className="px-3 py-3 text-right font-medium text-destructive">
                        Виплата
                      </th>
                      <th className="px-3 py-3 text-right font-medium text-muted-foreground">
                        Прибуток
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((l) => {
                      const profit = Number(l.student_price) - Number(l.tutor_payout);
                      const isSelected = selected.has(l.id);
                      return (
                        <tr
                          key={l.id}
                          className={`border-b border-border last:border-0 ${
                            isSelected ? "bg-primary/5" : ""
                          }`}
                        >
                          <td className="px-3 py-3">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleRow(l.id)}
                              aria-label="Обрати рядок"
                            />
                          </td>
                          <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">
                            {formatDate(l.starts_at)}
                          </td>
                          <td className="px-3 py-3 text-foreground">{l.subject}</td>
                          {/* Student column */}
                          <td className="px-3 py-3">
                            <div className="font-medium text-foreground">
                              {nameOf(l.student_id)}
                            </div>
                            {l.student_paid_at && (
                              <div className="text-xs text-muted-foreground">
                                опл.: {formatDate(l.student_paid_at)}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <div className="font-semibold text-success">
                              +{l.student_price} ₴
                            </div>
                            <button
                              onClick={() => togglePayment(l, "student_payment_status")}
                              className="mt-1 inline-block"
                            >
                              <Badge
                                className={
                                  l.student_payment_status === "paid"
                                    ? "bg-success/10 text-success border-0 hover:bg-success/20 cursor-pointer"
                                    : "bg-warning/10 text-warning border-0 hover:bg-warning/20 cursor-pointer"
                                }
                              >
                                {l.student_payment_status === "paid"
                                  ? "Оплачено"
                                  : "Очікує"}
                              </Badge>
                            </button>
                          </td>
                          {/* Tutor column */}
                          <td className="px-3 py-3">
                            <div className="font-medium text-foreground">
                              {nameOf(l.tutor_id)}
                            </div>
                            {l.tutor_paid_at && (
                              <div className="text-xs text-muted-foreground">
                                вип.: {formatDate(l.tutor_paid_at)}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <div className="font-semibold text-destructive">
                              -{l.tutor_payout} ₴
                            </div>
                            <button
                              onClick={() => togglePayment(l, "tutor_payout_status")}
                              className="mt-1 inline-block"
                            >
                              <Badge
                                className={
                                  l.tutor_payout_status === "paid"
                                    ? "bg-success/10 text-success border-0 hover:bg-success/20 cursor-pointer"
                                    : "bg-warning/10 text-warning border-0 hover:bg-warning/20 cursor-pointer"
                                }
                              >
                                {l.tutor_payout_status === "paid"
                                  ? "Виплачено"
                                  : "Очікує"}
                              </Badge>
                            </button>
                          </td>
                          <td
                            className={`px-3 py-3 text-right font-semibold ${
                              profit >= 0 ? "text-foreground" : "text-destructive"
                            }`}
                          >
                            {profit} ₴
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </AppLayout>
  );
}
