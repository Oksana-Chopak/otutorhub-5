import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { BarChart3, Loader2, MousePointerClick, Users, TrendingUp } from "lucide-react";

interface PaywallEventRow {
  id: string;
  user_id: string;
  feature_key: string;
  source: string;
  subscription_status: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const FEATURE_LABELS: Record<string, string> = {
  ai_summary: t("paywallMetrics.aiSummary"),
  premium_analytics: t("paywallMetrics.premiumAnalytics"),
  payment_reminder: t("paywallMetrics.paymentReminder"),
  bulk_actions: t("paywallMetrics.bulkActions"),
  subscription_page_visit: t("paywallMetrics.subscriptionPageVisit"),
  upgrade_banner: t("paywallMetrics.upgradeBanner"),
};

const STATUS_LABELS: Record<string, string> = {
  free: "Free",
  trial: "Trial",
  active: "Pro",
  past_due: t("paywallMetricsExtra.pastDue"),
  cancelled: t("paywallMetricsExtra.cancelled"),
};

const COLORS = ["#8B5CF6", "#0EA5E9", "#F59E0B", "#10B981", "#EF4444", "#EC4899"];

export default function PaywallMetricsPage() {
  const [events, setEvents] = useState<PaywallEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<"7" | "30" | "90">("30");
  const [statusFilter, setStatusFilter] = useState<string>("free");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const since = new Date();
      since.setDate(since.getDate() - parseInt(period, 10));
      const { data } = await supabase
        .from("paywall_events")
        .select("id, user_id, feature_key, source, subscription_status, metadata, created_at")
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(2000);
      setEvents((data ?? []) as PaywallEventRow[]);
      setLoading(false);
    })();
  }, [period]);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return events;
    return events.filter((e) => (e.subscription_status ?? "free") === statusFilter);
  }, [events, statusFilter]);

  const featureStats = useMemo(() => {
    const map = new Map<string, { clicks: number; users: Set<string> }>();
    for (const e of filtered) {
      if (e.feature_key === "subscription_page_visit") continue; // окрема воронка
      const cur = map.get(e.feature_key) ?? { clicks: 0, users: new Set() };
      cur.clicks += 1;
      cur.users.add(e.user_id);
      map.set(e.feature_key, cur);
    }
    return Array.from(map.entries())
      .map(([key, v]) => ({
        key,
        label: FEATURE_LABELS[key] ?? key,
        clicks: v.clicks,
        uniqueUsers: v.users.size,
      }))
      .sort((a, b) => b.clicks - a.clicks);
  }, [filtered]);

  const totals = useMemo(() => {
    const allClicks = filtered.filter((e) => e.feature_key !== "subscription_page_visit").length;
    const uniqueUsers = new Set(filtered.map((e) => e.user_id)).size;
    const visits = filtered.filter((e) => e.feature_key === "subscription_page_visit").length;
    return { allClicks, uniqueUsers, visits };
  }, [filtered]);

  const recent = filtered.slice(0, 100);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
              <BarChart3 className="h-6 w-6 text-primary" /> Метрики paywall
            </h1>
            <p className="text-sm text-muted-foreground">
              Які платні фічі найчастіше «провокують» кліки користувачів
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="free">{t("paywallMetricsExtra.onlyFree")}</SelectItem>
                <SelectItem value="trial">{t("paywallMetricsExtra.onlyTrial")}</SelectItem>
                <SelectItem value="active">{t("paywallMetricsExtra.onlyPro")}</SelectItem>
                <SelectItem value="all">{t("paywallMetricsExtra.allStatuses")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={period} onValueChange={(v) => setPeriod(v as "7" | "30" | "90")}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">{t("paywallMetricsExtra.days7")}</SelectItem>
                <SelectItem value="30">{t("paywallMetricsExtra.days30")}</SelectItem>
                <SelectItem value="90">{t("paywallMetricsExtra.days90")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Totals */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5">
                <MousePointerClick className="h-3.5 w-3.5" /> Кліків по фічах
              </CardDescription>
              <CardTitle className="text-3xl">{totals.allClicks}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" /> Унікальних користувачів
              </CardDescription>
              <CardTitle className="text-3xl">{totals.uniqueUsers}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5" /> Візитів /subscription
              </CardDescription>
              <CardTitle className="text-3xl">{totals.visits}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Bar chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("paywallMetricsExtra.topFeatures")}</CardTitle>
            <CardDescription>
              {statusFilter === "free"
                ? t("paywallMetricsExtra.conversionHint")
                : t("paywallMetricsExtra.generalHint")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-[300px] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : featureStats.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Поки немає подій за обраний період.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(220, featureStats.length * 56)}>
                <BarChart data={featureStats} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    width={180}
                  />
                  <RechartsTooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                    }}
                    formatter={(value: number, name: string) => [
                      value,
                      name === "clicks" ? t("paywallMetricsExtra.clicksLabel") : t("paywallMetricsExtra.uniqueUsers"),
                    ]}
                  />
                  <Bar dataKey="clicks" radius={[0, 6, 6, 0]}>
                    {featureStats.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Per-feature breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("paywallMetricsExtra.details")}</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Mobile cards */}
            <div className="space-y-2 md:hidden">
              {featureStats.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("paywallMetricsExtra.noData")}</p>
              ) : (
                featureStats.map((f) => (
                  <div key={f.key} className="rounded-xl border border-border bg-card p-3">
                    <div className="mb-2 text-sm font-medium text-foreground">{f.label}</div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground">{t("paywallMetricsExtra.clicksCol")}</div>
                        <div className="text-sm font-semibold">{f.clicks}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground">{t("paywallMetricsExtra.usersSmall")}</div>
                        <div className="text-sm font-semibold">{f.uniqueUsers}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground">К/Ю</div>
                        <div className="text-sm font-semibold">
                          {(f.clicks / Math.max(1, f.uniqueUsers)).toFixed(1)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("paywallMetricsExtra.featureCol")}</TableHead>
                    <TableHead className="text-right">{t("paywallMetricsExtra.clicksCol")}</TableHead>
                    <TableHead className="text-right">Унікальних юзерів</TableHead>
                    <TableHead className="text-right">{t("paywallMetricsExtra.ratioCol")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {featureStats.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                        Немає даних
                      </TableCell>
                    </TableRow>
                  ) : (
                    featureStats.map((f) => (
                      <TableRow key={f.key}>
                        <TableCell className="font-medium">{f.label}</TableCell>
                        <TableCell className="text-right">{f.clicks}</TableCell>
                        <TableCell className="text-right">{f.uniqueUsers}</TableCell>
                        <TableCell className="text-right">
                          {(f.clicks / Math.max(1, f.uniqueUsers)).toFixed(1)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Recent events */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("paywallMetricsExtra.recentEvents")}</CardTitle>
            <CardDescription>{t("paywallMetricsExtra.recentEventsDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Mobile cards */}
            <div className="space-y-2 md:hidden">
              {recent.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("paywallMetricsExtra.noEvents")}</p>
              ) : (
                recent.map((e) => (
                  <div key={e.id} className="rounded-xl border border-border bg-card p-3">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <div className="text-sm font-medium text-foreground">
                        {FEATURE_LABELS[e.feature_key] ?? e.feature_key}
                      </div>
                      <Badge
                        variant={
                          e.subscription_status === "active"
                            ? "default"
                            : e.subscription_status === "trial"
                              ? "secondary"
                              : "outline"
                        }
                        className="shrink-0 text-[10px]"
                      >
                        {STATUS_LABELS[e.subscription_status ?? "free"] ?? e.subscription_status}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="whitespace-nowrap">
                        {new Date(e.created_at).toLocaleString("uk-UA", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span>· {e.source}</span>
                      <span className="font-mono">· {e.user_id.slice(0, 8)}…</span>
                    </div>
                  </div>
                ))
              )}
            </div>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("paywallMetricsExtra.timeCol")}</TableHead>
                    <TableHead>{t("paywallMetricsExtra.featureCol")}</TableHead>
                    <TableHead>{t("paywallMetricsExtra.fromCol")}</TableHead>
                    <TableHead>{t("paywallMetricsExtra.statusCol")}</TableHead>
                    <TableHead>User</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                        Немає подій
                      </TableCell>
                    </TableRow>
                  ) : (
                    recent.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {new Date(e.created_at).toLocaleString("uk-UA", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </TableCell>
                        <TableCell className="text-sm">
                          {FEATURE_LABELS[e.feature_key] ?? e.feature_key}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{e.source}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              e.subscription_status === "active"
                                ? "default"
                                : e.subscription_status === "trial"
                                  ? "secondary"
                                  : "outline"
                            }
                          >
                            {STATUS_LABELS[e.subscription_status ?? "free"] ?? e.subscription_status}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {e.user_id.slice(0, 8)}…
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
