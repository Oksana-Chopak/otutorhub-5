import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { StatCard } from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Users,
  TrendingUp,
  ArrowDownLeft,
  Clock4,
  Crown,
} from "lucide-react";

type Period = "all" | "month" | "week";

const periodLabel: Record<Period, string> = {
  all: t("independentStats.periodAll"),
  month: t("independentStats.periodMonth"),
  week: t("independentStats.periodWeek"),
};

interface LessonRow {
  id: string;
  starts_at: string;
  status: "pending" | "scheduled" | "completed" | "cancelled";
  student_id: string;
  student_price: number;
  student_payment_status: "paid" | "unpaid";
}

/**
 * Stats block for an independent tutor: own students count + own income/pending.
 * Free план — без обмежень на кількість учнів. Pro дає premium-аналітику,
 * нагадування про оплату й експорт звітів.
 */
export function IndependentTutorStats() {
  const { user } = useAuth();
  const { studentCount, isPro } = useWorkspaceSettings();
  const [period, setPeriod] = useState<Period>("month");
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("lessons")
        .select("id, starts_at, status, student_id, lesson_details(student_price, student_payment_status)")
        .eq("tutor_id", user.id)
        .eq("source", "independent");
      if (!cancelled) {
        const mapped = ((data ?? []) as any[]).map((r) => {
          const d = Array.isArray(r.lesson_details) ? r.lesson_details[0] : r.lesson_details;
          return {
            id: r.id,
            starts_at: r.starts_at,
            status: r.status,
            student_id: r.student_id,
            student_price: Number(d?.student_price ?? 0),
            student_payment_status: d?.student_payment_status ?? "unpaid",
          } as LessonRow;
        });
        setLessons(mapped);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const { periodStart, priorStart } = useMemo(() => {
    const d = new Date();
    if (period === "month") {
      const s = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      const p = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
      return { periodStart: s, priorStart: p };
    }
    if (period === "week") {
      const day = (d.getDay() + 6) % 7;
      const ws = new Date(d);
      ws.setDate(d.getDate() - day);
      ws.setHours(0, 0, 0, 0);
      return { periodStart: ws.getTime(), priorStart: ws.getTime() - 7 * 86400_000 };
    }
    return { periodStart: 0, priorStart: 0 };
  }, [period]);

  const inRange = (l: LessonRow, from: number, to: number) =>
    l.status === "completed" &&
    new Date(l.starts_at).getTime() >= from &&
    new Date(l.starts_at).getTime() < to;

  const now = Date.now();
  const billable = lessons.filter((l) => inRange(l, periodStart, now));
  const priorBillable =
    period === "all"
      ? []
      : lessons.filter((l) => inRange(l, priorStart, periodStart));

  const totalIncome = billable
    .filter((l) => l.student_payment_status === "paid")
    .reduce((s, l) => s + Number(l.student_price), 0);
  const pendingIncome = billable
    .filter((l) => l.student_payment_status === "unpaid")
    .reduce((s, l) => s + Number(l.student_price), 0);
  const completedCount = billable.length;

  const priorIncome = priorBillable
    .filter((l) => l.student_payment_status === "paid")
    .reduce((s, l) => s + Number(l.student_price), 0);
  const priorCompleted = priorBillable.length;

  const incomeDelta = period === "all" ? undefined : totalIncome - priorIncome;
  const completedDelta = period === "all" ? undefined : completedCount - priorCompleted;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-foreground">
          Ваша статистика
        </h2>
        <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <SelectTrigger className="h-8 w-[170px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{periodLabel.all}</SelectItem>
            <SelectItem value="month">{periodLabel.month}</SelectItem>
            <SelectItem value="week">{periodLabel.week}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label={t("independentStats.myStudents")}
          value={loading ? "…" : studentCount}
          icon={Users}
          to="/my-students"
        />
        <StatCard
          label={t("independentStats.lessonsCompleted")}
          value={loading ? "…" : completedCount}
          icon={Clock4}
          to="/schedule"
          trendDelta={loading ? undefined : completedDelta}
        />
        <StatCard
          label={t("independentStats.earned")}
          value={loading ? "…" : `${totalIncome} ₴`}
          icon={ArrowDownLeft}
          variant="success"
          to={isPro ? "/analytics" : undefined}
          trendDelta={loading ? undefined : incomeDelta}
        />
        <StatCard
          label={t("independentStatsExtra.awaitingPayment")}
          value={loading ? "…" : `${pendingIncome} ₴`}
          icon={TrendingUp}
          variant={pendingIncome > 0 ? "warning" : "default"}
          to={isPro ? "/analytics" : undefined}
        />
      </div>

      {!isPro && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Crown className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                Перейдіть на Pro — більше керування і красива аналітика
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Авто-нагадування про оплату, скасування/перенесення учнем за вашими правилами,
                детальні звіти та експорт.
              </p>
            </div>
          </div>
          <Button asChild size="sm">
            <Link to="/subscription">{t("independentStatsExtra.detailsLink")}</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
