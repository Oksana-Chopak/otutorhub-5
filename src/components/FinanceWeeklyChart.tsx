import { useMemo } from "react";
import {
  LineChart,
  Line,
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
  student_id: string;
  student_price: number;
  tutor_payout: number;
  student_payment_status: "paid" | "unpaid";
  tutor_payout_status: "paid" | "unpaid";
}

interface FinanceWeeklyChartProps {
  lessons: LessonForChart[];
  weeks?: number;
}

// ISO week start (Monday)
function weekStart(iso: string): Date {
  const d = new Date(iso);
  const day = (d.getDay() + 6) % 7; // 0 = Mon
  const ws = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  ws.setHours(0, 0, 0, 0);
  return ws;
}

function weekKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function weekLabel(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("uk-UA", { day: "2-digit", month: "short" });
}

export function FinanceWeeklyChart({ lessons, weeks = 12 }: FinanceWeeklyChartProps) {
  const data = useMemo(() => {
    const buckets: Record<
      string,
      { profit: number; students: Set<string>; lessons: number }
    > = {};

    // Pre-fill last N weeks so the chart shows continuous timeline even with gaps
    const today = new Date();
    const currentWeek = weekStart(today.toISOString());
    for (let i = weeks - 1; i >= 0; i--) {
      const d = new Date(currentWeek);
      d.setDate(currentWeek.getDate() - i * 7);
      const key = weekKey(d);
      buckets[key] = { profit: 0, students: new Set(), lessons: 0 };
    }

    lessons
      .filter((l) => l.status === "completed")
      .forEach((l) => {
        const key = weekKey(weekStart(l.starts_at));
        if (!buckets[key]) return; // outside chart window
        const income =
          l.student_payment_status === "paid" ? Number(l.student_price) : 0;
        const expense =
          l.tutor_payout_status === "paid" ? Number(l.tutor_payout) : 0;
        buckets[key].profit += income - expense;
        buckets[key].students.add(l.student_id);
        buckets[key].lessons += 1;
      });

    return Object.keys(buckets)
      .sort()
      .map((key) => ({
        week: weekLabel(key),
        Прибуток: buckets[key].profit,
        Учні: buckets[key].students.size,
        Уроки: buckets[key].lessons,
      }));
  }, [lessons, weeks]);

  const hasData = data.some((d) => d.Прибуток !== 0 || d.Учні !== 0 || d.Уроки !== 0);

  if (!hasData) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        Немає завершених уроків для побудови графіка
      </div>
    );
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="week" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
          <YAxis
            yAxisId="money"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          />
          <YAxis
            yAxisId="count"
            orientation="right"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(v: number, name: string) =>
              name === "Прибуток" ? `${v} ₴` : v
            }
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            yAxisId="money"
            type="monotone"
            dataKey="Прибуток"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
          <Line
            yAxisId="count"
            type="monotone"
            dataKey="Учні"
            stroke="hsl(var(--success))"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
          <Line
            yAxisId="count"
            type="monotone"
            dataKey="Уроки"
            stroke="hsl(var(--warning))"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
