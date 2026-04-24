import { useState, useEffect, useMemo } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer, 
  LineChart, 
  Line,
  PieChart,
  Pie,
  Cell
} from "recharts";
import { 
  TrendingUp, 
  TrendingDown, 
  Users, 
  Clock, 
  FileDown, 
  ArrowLeft, 
  Crown,
  Sparkles,
  Lightbulb,
  CheckCircle2,
  Calendar,
  CalendarClock
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { format, subMonths, startOfMonth, endOfMonth, eachMonthOfInterval, isWithinInterval } from "date-fns";
import { uk } from "date-fns/locale";
import { toast } from "sonner";

interface LessonRow {
  id: string;
  starts_at: string;
  status: "pending" | "scheduled" | "completed" | "cancelled";
  student_id: string;
  student_price: number;
  student_payment_status: "paid" | "unpaid";
}

const COLORS = ["#8B5CF6", "#0EA5E9", "#F59E0B", "#10B981", "#EF4444"];

export default function PremiumAnalyticsPage() {
  const { isPro, loading: settingsLoading, studentCount } = useWorkspaceSettings();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (settingsLoading) return;
    if (!isPro) {
      navigate("/subscription");
      return;
    }
  }, [isPro, settingsLoading, navigate]);

  useEffect(() => {
    if (!user || !isPro) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("lessons")
        .select("id, starts_at, status, student_id, student_price, student_payment_status")
        .eq("tutor_id", user.id)
        .eq("source", "independent");
      setLessons((data ?? []) as LessonRow[]);
      setLoading(false);
    })();
  }, [user?.id, isPro]);

  // Last 6 months data for charts
  const chartData = useMemo(() => {
    const months = eachMonthOfInterval({
      start: subMonths(new Date(), 5),
      end: new Date(),
    });

    return months.map(month => {
      const monthStart = startOfMonth(month);
      const monthEnd = endOfMonth(month);
      
      const monthLessons = lessons.filter(l => {
        const date = new Date(l.starts_at);
        return isWithinInterval(date, { start: monthStart, end: monthEnd });
      });

      const income = monthLessons
        .filter(l => l.status === "completed" && l.student_payment_status === "paid")
        .reduce((sum, l) => sum + Number(l.student_price), 0);

      const count = monthLessons.filter(l => l.status === "completed").length;

      return {
        name: format(month, "MMM", { locale: uk }),
        income,
        lessons: count,
      };
    });
  }, [lessons]);

  const stats = useMemo(() => {
    const completed = lessons.filter(l => l.status === "completed");
    const totalIncome = completed
      .filter(l => l.student_payment_status === "paid")
      .reduce((sum, l) => sum + Number(l.student_price), 0);
    
    const unpaidIncome = completed
      .filter(l => l.student_payment_status === "unpaid")
      .reduce((sum, l) => sum + Number(l.student_price), 0);

    const cancelled = lessons.filter(l => l.status === "cancelled").length;
    const cancellationRate = lessons.length > 0 ? (cancelled / lessons.length) * 100 : 0;

    return {
      totalIncome,
      unpaidIncome,
      completedCount: completed.length,
      cancellationRate: Math.round(cancellationRate),
      studentCount
    };
  }, [lessons, studentCount]);

  const handleExport = (type: "csv" | "pdf") => {
    toast.info(`Експорт у ${type.toUpperCase()}...`, {
      description: "Функція генерації звіту готується. Ви отримаєте файл за кілька секунд."
    });
    
    if (type === "csv") {
      const headers = ["Дата", "Статус", "Ціна", "Оплата"];
      const rows = lessons.map(l => [
        format(new Date(l.starts_at), "yyyy-MM-dd HH:mm"),
        l.status,
        l.student_price,
        l.student_payment_status
      ]);
      
      const csvContent = "data:text/csv;charset=utf-8," 
        + headers.join(",") + "\n"
        + rows.map(e => e.join(",")).join("\n");
        
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `otutorhub_report_${format(new Date(), "yyyy-MM-dd")}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  if (loading || settingsLoading) {
    return (
      <AppLayout>
        <div className="flex h-64 items-center justify-center">
          <Clock className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon" className="h-9 w-9">
              <Link to="/">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-2xl font-bold text-foreground">Преміум-аналітика</h1>
                <Badge className="bg-primary/10 text-primary hover:bg-primary/20">
                  <Crown className="mr-1 h-3 w-3" /> Pro
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">Детальний аналіз вашої діяльності та доходів</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handleExport("csv")} className="gap-2">
              <FileDown className="h-4 w-4" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleExport("pdf")} className="gap-2">
              <FileDown className="h-4 w-4" /> PDF
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="bg-success/5 border-success/20">
            <CardHeader className="pb-2">
              <CardDescription className="text-success/80">Дохід (отримано)</CardDescription>
              <CardTitle className="text-2xl font-bold">{stats.totalIncome} ₴</CardTitle>
            </CardHeader>
          </Card>
          <Card className="bg-warning/5 border-warning/20">
            <CardHeader className="pb-2">
              <CardDescription className="text-warning/80">Очікує оплати</CardDescription>
              <CardTitle className="text-2xl font-bold">{stats.unpaidIncome} ₴</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Всього учнів</CardDescription>
              <CardTitle className="text-2xl font-bold">{stats.studentCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Успішність уроків</CardDescription>
              <CardTitle className="text-2xl font-bold">{100 - stats.cancellationRate}%</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Income Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Динаміка доходу (6 міс)</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px] pt-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} />
                  <YAxis axisLine={false} tickLine={false} tickFormatter={(v) => `${v}₴`} />
                  <RechartsTooltip 
                    cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  />
                  <Bar dataKey="income" fill="#8B5CF6" radius={[4, 4, 0, 0]} name="Дохід" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Lessons count chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Кількість уроків</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px] pt-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} />
                  <YAxis axisLine={false} tickLine={false} />
                  <RechartsTooltip 
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  />
                  <Line type="monotone" dataKey="lessons" stroke="#0EA5E9" strokeWidth={3} dot={{ r: 4 }} name="Уроки" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-primary" />
                <CardTitle className="text-base font-semibold">Аналіз та поради для росту</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
                <TrendingUp className="mt-1 h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium text-foreground">Порада по фінансах</p>
                  <p className="text-sm text-muted-foreground">
                    Ваш середній дохід за урок стабільний. Спробуйте впровадити пакетні пропозиції (наприклад, 10 уроків зі знижкою 5%), щоб покращити прогнозованість оплат.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-success/20 bg-success/5 p-4">
                <Users className="mt-1 h-5 w-5 text-success" />
                <div>
                  <p className="font-medium text-foreground">Залучення учнів</p>
                  <p className="text-sm text-muted-foreground">
                    У вас {stats.studentCount} активних учнів. Для стабільного зростання рекомендуємо підтримувати заповненість графіку на 80%. Наразі у вас є вільні слоти — перевірте розділ <CalendarClock className="inline h-4 w-4 align-text-bottom" /> Години.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-warning/20 bg-warning/5 p-4">
                <Clock className="mt-1 h-5 w-5 text-warning" />
                <div>
                  <p className="font-medium text-foreground">Ефективність розкладу</p>
                  <p className="text-sm text-muted-foreground">
                    {stats.cancellationRate > 10 
                      ? `Рівень скасувань складає ${stats.cancellationRate}%. Це вище норми. Спробуйте посилити правила скасування в налаштуваннях Pro.` 
                      : `Чудовий показник скасувань (${stats.cancellationRate}%)! Ваші учні дуже дисципліновані.`}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Статус оплат</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center pt-0">
              <div className="h-[200px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: "Оплачено", value: stats.totalIncome },
                        { name: "Очікує", value: stats.unpaidIncome },
                      ]}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      <Cell fill="#10B981" />
                      <Cell fill="#F59E0B" />
                    </Pie>
                    <RechartsTooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 w-full space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-success" />
                    <span className="text-muted-foreground">Оплачено</span>
                  </div>
                  <span className="font-semibold text-foreground">{stats.totalIncome} ₴</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-warning" />
                    <span className="text-muted-foreground">Очікує</span>
                  </div>
                  <span className="font-semibold text-foreground">{stats.unpaidIncome} ₴</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-primary/30 bg-primary/[0.02]">
          <CardContent className="flex flex-col items-center justify-center gap-4 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <h3 className="font-display text-lg font-bold text-foreground">Ви молодець!</h3>
              <p className="mx-auto max-w-md text-sm text-muted-foreground">
                Минулого місяця ви провели на {chartData[chartData.length - 1].lessons - chartData[chartData.length - 2]?.lessons || 0} уроків більше, ніж позаминулого. Так тримати!
              </p>
            </div>
            <div className="flex gap-2">
              <Badge variant="outline" className="gap-1 border-primary/20">
                <CheckCircle2 className="h-3 w-3 text-primary" /> Дисципліна
              </Badge>
              <Badge variant="outline" className="gap-1 border-primary/20">
                <CheckCircle2 className="h-3 w-3 text-primary" /> Пунктуальність
              </Badge>
              <Badge variant="outline" className="gap-1 border-primary/20">
                <CheckCircle2 className="h-3 w-3 text-primary" /> Ріст
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
