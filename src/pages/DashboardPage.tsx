import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { StatCard } from "@/components/StatCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { CalendarDays, DollarSign, Users, TrendingUp, Clock, Loader2 } from "lucide-react";

type LessonStatus = "pending" | "scheduled" | "completed" | "cancelled";
type PaymentStatus = "paid" | "unpaid";

interface LessonRow {
  id: string;
  tutor_id: string;
  student_id: string;
  subject: string;
  starts_at: string;
  duration_minutes: number;
  status: LessonStatus;
  student_price: number;
  tutor_payout: number;
  student_payment_status: PaymentStatus;
  tutor_payout_status: PaymentStatus;
}

interface ProfileRow {
  id: string;
  first_name: string;
  last_name: string;
}

const statusLabel: Record<LessonStatus, string> = {
  pending: "Запит",
  scheduled: "Заплановано",
  completed: "Проведено",
  cancelled: "Скасовано",
};

const statusClass: Record<LessonStatus, string> = {
  pending: "bg-warning/10 text-warning border-0",
  scheduled: "bg-primary/10 text-primary border-0",
  completed: "bg-success/10 text-success border-0",
  cancelled: "bg-destructive/10 text-destructive border-0",
};

export default function DashboardPage() {
  const { user, roles } = useAuth();
  const isManager = roles.includes("manager");
  const [loading, setLoading] = useState(true);
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [tutorCount, setTutorCount] = useState(0);
  const [studentCount, setStudentCount] = useState(0);

  useEffect(() => {
    const loadData = async () => {
      if (!user) return;
      setLoading(true);

      const [{ data: lessonsData }, { data: profilesData }, { data: rolesData }] = await Promise.all([
        supabase.from("lessons_visible").select("id, tutor_id, student_id, subject, starts_at, duration_minutes, status, student_price, tutor_payout, student_payment_status, tutor_payout_status").order("starts_at", { ascending: true }),
        supabase.from("profiles").select("id, first_name, last_name"),
        supabase.from("user_roles").select("user_id, role"),
      ]);

      const profileMap: Record<string, string> = {};
      (profilesData as ProfileRow[] | null ?? []).forEach((profile) => {
        profileMap[profile.id] = `${profile.first_name} ${profile.last_name}`.trim() || "Без імені";
      });

      const roleRows = (rolesData ?? []) as Array<{ user_id: string; role: string }>;
      setTutorCount(roleRows.filter((row) => row.role === "tutor").length);
      setStudentCount(roleRows.filter((row) => row.role === "student").length);
      setProfiles(profileMap);
      setLessons((lessonsData ?? []) as LessonRow[]);
      setLoading(false);
    };

    loadData();
  }, [user?.id]);

  const todayKey = new Date().toISOString().slice(0, 10);

  const todayLessons = useMemo(
    () => lessons.filter((lesson) => lesson.starts_at.slice(0, 10) === todayKey),
    [lessons, todayKey]
  );

  const billableLessons = lessons.filter((lesson) => lesson.status === "completed");
  const totalIncome = billableLessons
    .filter((lesson) => lesson.student_payment_status === "paid")
    .reduce((sum, lesson) => sum + Number(lesson.student_price), 0);
  const totalExpense = billableLessons
    .filter((lesson) => lesson.tutor_payout_status === "paid")
    .reduce((sum, lesson) => sum + Number(lesson.tutor_payout), 0);
  const profit = totalIncome - totalExpense;
  const pendingPayments = billableLessons.filter(
    (lesson) => lesson.student_payment_status === "unpaid" || lesson.tutor_payout_status === "unpaid"
  );

  return (
    <AppLayout>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Дашборд</h1>
          <p className="text-sm text-muted-foreground">
            {isManager ? "Керуйте уроками, людьми та оплатами" : "Огляд ваших занять"}
          </p>
        </div>
        {isManager && (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link to="/people">Люди</Link></Button>
            <Button asChild variant="outline"><Link to="/schedule">Уроки</Link></Button>
            <Button asChild><Link to="/finances">Оплати</Link></Button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Репетитори" value={tutorCount} icon={Users} />
            <StatCard label="Учні" value={studentCount} icon={Users} />
            <StatCard label="Уроків сьогодні" value={todayLessons.length} icon={CalendarDays} />
            {isManager && (
              <StatCard label="Прибуток" value={`${profit} ₴`} icon={TrendingUp} variant="success" />
            )}
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
            <section>
              <h2 className="mb-4 font-display text-lg font-semibold text-foreground">Найближчі уроки</h2>
              <div className="space-y-3">
                {todayLessons.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
                    Сьогодні уроків ще немає.
                  </div>
                ) : (
                  todayLessons.map((lesson) => (
                    <div key={lesson.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-4 gap-3">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                          <Clock className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{lesson.subject}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {profiles[lesson.tutor_id] ?? "—"} → {profiles[lesson.student_id] ?? "—"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-sm font-medium text-foreground">
                          {new Date(lesson.starts_at).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <Badge className={statusClass[lesson.status]}>{statusLabel[lesson.status]}</Badge>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section>
              <h2 className="mb-4 font-display text-lg font-semibold text-foreground">Що зробити далі</h2>
              <div className="space-y-3">
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="text-sm font-medium text-foreground">Додати минулі уроки</p>
                  <p className="mt-1 text-xs text-muted-foreground">У розділі “Розклад” можна вносити уроки заднім числом.</p>
                  <Button asChild size="sm" variant="outline" className="mt-3"><Link to="/schedule">Відкрити розклад</Link></Button>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="text-sm font-medium text-foreground">Внести оплату або виплату</p>
                  <p className="mt-1 text-xs text-muted-foreground">У “Фінансах” можна позначати проведені оплати по завершених уроках.</p>
                  <Button asChild size="sm" variant="outline" className="mt-3"><Link to="/finances">Відкрити фінанси</Link></Button>
                </div>
                {isManager && pendingPayments.length > 0 && (
                  <div className="rounded-xl border border-border bg-card p-4">
                    <p className="text-sm font-medium text-foreground">Очікують дії: {pendingPayments.length}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Є завершені уроки без повністю внесених оплат або виплат.</p>
                    <Button asChild size="sm" className="mt-3"><Link to="/finances">Перейти до оплат</Link></Button>
                  </div>
                )}
              </div>
            </section>
          </div>

          {isManager && pendingPayments.length > 0 && (
            <div className="mt-8">
              <h2 className="mb-4 font-display text-lg font-semibold text-foreground">Очікують оплати</h2>
              <div className="space-y-3">
                {pendingPayments.slice(0, 5).map((lesson) => (
                  <div key={lesson.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-4 gap-3">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/10">
                        <DollarSign className="h-4 w-4 text-warning" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{lesson.subject}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          Учень: {profiles[lesson.student_id] ?? "—"} · Репетитор: {profiles[lesson.tutor_id] ?? "—"}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-foreground">{lesson.student_price} ₴ / {lesson.tutor_payout} ₴</p>
                      <Badge className="bg-warning/10 text-warning border-0">Потребує внесення</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </AppLayout>
  );
}
