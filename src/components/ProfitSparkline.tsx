import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

interface Point {
  week: string;
  profit: number;
}

function shortLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("uk-UA", { day: "2-digit", month: "short" });
}

export function ProfitSparkline({ data }: { data: Point[] }) {
  const hasAny = data.some((d) => d.profit !== 0);
  if (!hasAny) {
    return (
      <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
        Поки немає даних за останні 4 тижні
      </div>
    );
  }
  const display = data.map((d) => ({ ...d, label: shortLabel(d.week) }));
  return (
    <div className="h-24 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={display} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="profit-spark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(v: number) => [`${v} ₴`, "Прибуток"]}
            labelFormatter={(l) => t("profitSparkline.weekFrom", { date: l })}
          />
          <Area
            type="monotone"
            dataKey="profit"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            fill="url(#profit-spark)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
