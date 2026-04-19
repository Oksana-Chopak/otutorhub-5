import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { StatCard } from "@/components/StatCard";
import { supabase } from "@/integrations/supabase/client";
import { ArrowDownLeft, ArrowUpRight, TrendingUp, DollarSign, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

const monthKey = (iso: string) => iso.slice(0, 7); // YYYY-MM
const formatMonth = (key: string) => {
  const [y, m] = key.split("-");
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleDateString("uk-UA", { month: "long", year: "numeric" });
};
const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" });

export default function FinancesPage() {
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [monthFilter, setMonthFilter] = useState<string>("all");

  const fetchData = async () => {
    setLoading(true);
    const [{ data: lessonsData, error: lErr }, { data: profilesData, error: pErr }] = await Promise.all([
      supabase
        .from("lessons")
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

  const filtered = useMemo(
    () => (monthFilter === "all" ? lessons : lessons.filter((l) => monthKey(l.starts_at) === monthFilter)),
    [lessons, monthFilter]
  );

  // Враховуємо лише завершені уроки для фінансів
  const billable = filtered.filter((l) => l.status === "completed");

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

  return (
    <AppLayout>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Фінанси</h1>
          <p className="text-sm text-muted-foreground">Оплати від учнів та виплати репетиторам</p>
        </div>
        <div className="w-full sm:w-56">
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
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Завантаження...
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Надходження" value={`${totalIncome} ₴`} icon={ArrowDownLeft} variant="success" />
            <StatCard label="Виплати" value={`${totalExpense} ₴`} icon={ArrowUpRight} />
            <StatCard label="Прибуток" value={`${profit} ₴`} icon={TrendingUp} variant={profit >= 0 ? "success" : "warning"} />
            <StatCard
              label="Очікує (отримати/виплатити)"
              value={`${pendingIncome} / ${pendingExpense} ₴`}
              icon={DollarSign}
              variant="warning"
            />
          </div>

          {/* Income */}
          <Section
            title="Надходження від учнів"
            empty="Немає завершених уроків у цьому періоді"
            rows={billable}
            getPersonId={(l) => l.student_id}
            amountClass="text-success"
            sign="+"
            getAmount={(l) => Number(l.student_price)}
            getStatus={(l) => l.student_payment_status}
            getPaidAt={(l) => l.student_paid_at}
            onToggle={(l) => togglePayment(l, "student_payment_status")}
            nameOf={nameOf}
          />

          {/* Expenses */}
          <Section
            title="Виплати репетиторам"
            empty="Немає завершених уроків у цьому періоді"
            rows={billable}
            getPersonId={(l) => l.tutor_id}
            amountClass="text-destructive"
            sign="-"
            getAmount={(l) => Number(l.tutor_payout)}
            getStatus={(l) => l.tutor_payout_status}
            getPaidAt={(l) => l.tutor_paid_at}
            onToggle={(l) => togglePayment(l, "tutor_payout_status")}
            nameOf={nameOf}
          />
        </>
      )}
    </AppLayout>
  );
}

interface SectionProps {
  title: string;
  empty: string;
  rows: LessonRow[];
  getPersonId: (l: LessonRow) => string;
  amountClass: string;
  sign: string;
  getAmount: (l: LessonRow) => number;
  getStatus: (l: LessonRow) => PaymentStatus;
  getPaidAt: (l: LessonRow) => string | null;
  onToggle: (l: LessonRow) => void;
  nameOf: (id: string) => string;
}

function Section({
  title,
  empty,
  rows,
  getPersonId,
  amountClass,
  sign,
  getAmount,
  getStatus,
  getPaidAt,
  onToggle,
  nameOf,
}: SectionProps) {
  return (
    <div className="mt-8">
      <h2 className="font-display text-lg font-semibold text-foreground mb-4">{title}</h2>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">{empty}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Особа</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Урок</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Дата</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Сума</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Статус</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Дія</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const status = getStatus(l);
                  const paidAt = getPaidAt(l);
                  return (
                    <tr key={l.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-medium text-foreground">{nameOf(getPersonId(l))}</td>
                      <td className="px-4 py-3 text-muted-foreground">{l.subject}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(l.starts_at)}
                        {paidAt && (
                          <span className="block text-xs text-muted-foreground/70">
                            оплата: {formatDate(paidAt)}
                          </span>
                        )}
                      </td>
                      <td className={`px-4 py-3 text-right font-semibold ${amountClass}`}>
                        {sign}
                        {getAmount(l)} ₴
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Badge
                          className={
                            status === "paid"
                              ? "bg-success/10 text-success border-0"
                              : "bg-warning/10 text-warning border-0"
                          }
                        >
                          {status === "paid" ? "Оплачено" : "Очікує"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="outline" onClick={() => onToggle(l)}>
                          {status === "paid" ? "Скасувати" : "Позначити оплату"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
