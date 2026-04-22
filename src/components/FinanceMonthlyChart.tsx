import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface LessonForChart {
  starts_at: string;
  status: string;
  student_price: number;
  tutor_payout: number;
  student_payment_status: "paid" | "unpaid";
  tutor_payout_status: "paid" | "unpaid";
}

interface FinanceMonthlyChartProps {
  lessons: LessonForChart[];
}

function monthLabel(key: string) {
  const [y, m] = key.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("uk-UA", { month: "short", year: "2-digit" });
}

export function FinanceMonthlyChart({ lessons }: FinanceMonthlyChartProps) {
  const data = useMemo(() => {
    const buckets: Record<
      string,
      { income: number; expense: number; pendingIncome: number; pendingExpense: number }
    > = {};
    lessons
      .filter((l) => l.status === "completed")
      .forEach((l) => {
        const key = l.starts_at.slice(0, 7);
        if (!buckets[key]) buckets[key] = { income: 0, expense: 0, pendingIncome: 0, pendingExpense: 0 };
        if (l.student_payment_status === "paid") buckets[key].income += Number(l.student_price);
        else buckets[key].pendingIncome += Number(l.student_price);
        if (l.tutor_payout_status === "paid") buckets[key].expense += Number(l.tutor_payout);
        else buckets[key].pendingExpense += Number(l.tutor_payout);
      });
    return Object.keys(buckets)
      .sort()
      .slice(-12)
      .map((key) => ({
        month: monthLabel(key),
        Надходження: buckets[key].income,
        Виплати: buckets[key].expense,
        Прибуток: buckets[key].income - buckets[key].expense,
      }));
  }, [lessons]);

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        Немає завершених уроків для побудови графіка
      </div>
    );
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
          <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(v: number) => `${v} ₴`}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Надходження" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Виплати" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Прибуток" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
