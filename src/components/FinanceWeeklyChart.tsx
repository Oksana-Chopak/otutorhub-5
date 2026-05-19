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
  tutor_id: string;
  student_price: number;
  tutor_payout: number;
  student_payment_status: "paid" | "unpaid";
  tutor_payout_status: "paid" | "unpaid";
}

interface FinanceWeeklyChartProps {
  lessons: LessonForChart[];
  tutorNames: Record<string, string>;
  weeks?: number;
}

// ISO week start (Monday, local time)
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

// ISO week number
function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function weekLabel(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const wn = isoWeekNumber(date);
  const short = date.toLocaleDateString("uk-UA", { day: "2-digit", month: "short" });
  return `Т${wn} · ${short}`;
}

// Stable distinct colors for tutor lines
const TUTOR_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--success))",
  "hsl(var(--warning))",
  "hsl(var(--destructive))",
  "hsl(217 91% 60%)",
  "hsl(280 70% 60%)",
  "hsl(160 70% 45%)",
  "hsl(30 90% 55%)",
  "hsl(340 75% 55%)",
  "hsl(190 80% 45%)",
];

export function FinanceWeeklyChart({
  lessons,
  tutorNames,
  weeks = 12,
}: FinanceWeeklyChartProps) {
  const { data, tutorIds } = useMemo(() => {
    // Pre-fill last N week keys
    const today = new Date();
    const currentWeek = weekStart(today.toISOString());
    const weekKeys: string[] = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const d = new Date(currentWeek);
      d.setDate(currentWeek.getDate() - i * 7);
      weekKeys.push(weekKey(d));
    }

    // tutorId -> weekKey -> profit
    const perTutor: Record<string, Record<string, number>> = {};

    lessons
      .filter((l) => l.status === "completed")
      .forEach((l) => {
        const key = weekKey(weekStart(l.starts_at));
        if (!weekKeys.includes(key)) return;
        const income =
          l.student_payment_status === "paid" ? Number(l.student_price) : 0;
        const expense =
          l.tutor_payout_status === "paid" ? Number(l.tutor_payout) : 0;
        if (!perTutor[l.tutor_id]) perTutor[l.tutor_id] = {};
        perTutor[l.tutor_id][key] =
          (perTutor[l.tutor_id][key] ?? 0) + (income - expense);
      });

    const tutorIds = Object.keys(perTutor).sort((a, b) =>
      (tutorNames[a] ?? "").localeCompare(tutorNames[b] ?? "", "uk")
    );

    const data = weekKeys.map((key) => {
      const row: Record<string, number | string> = { week: weekLabel(key) };
      tutorIds.forEach((tid) => {
        row[tutorNames[tid] ?? t("shared.noName")] = perTutor[tid][key] ?? 0;
      });
      return row;
    });

    return { data, tutorIds };
  }, [lessons, tutorNames, weeks]);

  const hasData = tutorIds.length > 0 && data.some((row) =>
    tutorIds.some((tid) => Number(row[tutorNames[tid] ?? t("shared.noName")]) !== 0)
  );

  if (!hasData) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        Немає завершених уроків для побудови графіка
      </div>
    );
  }

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="week"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            interval="preserveStartEnd"
          />
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
          {tutorIds.map((tid, idx) => {
            const name = tutorNames[tid] ?? t("shared.noName");
            return (
              <Line
                key={tid}
                type="monotone"
                dataKey={name}
                stroke={TUTOR_COLORS[idx % TUTOR_COLORS.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
