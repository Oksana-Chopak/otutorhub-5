import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { formatPrice } from "@/lib/currency";
import { getLocale } from "@/lib/locale";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

interface Point {
  week: string;
  profit: number;
}

function shortLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(getLocale(), { day: "2-digit", month: "short" });
}

export function ProfitSparkline({ cur = "UAH", data }: { data: Point[]; cur?: string }) {
  const hasAny = data.some((d) => d.profit !== 0);
  if (!hasAny) {
    return (
      <div className="flex h-24 items-center justify-center text-[14px] text-muted-foreground">
        {t("finances.noProfitData")}
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
          <XAxis dataKey="label" tick={{ fontSize: 14, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 14,
            }}
            formatter={(v: number) => [formatPrice(v, cur), t("profitSparkline.profit")]}
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
