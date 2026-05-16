import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

interface Slice {
  student_id: string;
  name: string;
  amount: number;
}

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--success))",
  "hsl(var(--warning))",
  "hsl(217 91% 60%)",
  "hsl(280 70% 60%)",
  "hsl(340 75% 55%)",
  "hsl(190 80% 45%)",
];

export function IncomeByStudentPie({ data }: { data: Slice[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-44 items-center justify-center text-xs text-muted-foreground">
        Поки немає оплачених уроків
      </div>
    );
  }
  const total = data.reduce((s, d) => s + d.amount, 0);
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="h-44 w-full sm:w-44">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="amount"
              nameKey="name"
              innerRadius={36}
              outerRadius={70}
              paddingAngle={2}
              stroke="hsl(var(--card))"
            >
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(v: number, n: string) => [`${v} ₴`, n]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex-1 space-y-1 text-xs">
        {data.map((d, i) => {
          const pct = total > 0 ? Math.round((d.amount / total) * 100) : 0;
          return (
            <li key={d.student_id} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: COLORS[i % COLORS.length] }}
              />
              <span className="flex-1 truncate text-foreground">{d.name}</span>
              <span className="shrink-0 text-muted-foreground">
                {d.amount} ₴ · {pct}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
