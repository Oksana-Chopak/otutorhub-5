import { AppLayout } from "@/components/AppLayout";
import { StatCard } from "@/components/StatCard";
import { lessons, payments, tutors, students, getTutorById, getStudentById } from "@/lib/mock-data";
import { CalendarDays, DollarSign, Users, TrendingUp, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function DashboardPage() {
  const totalIncome = payments.filter(p => p.type === "income" && p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const totalExpense = payments.filter(p => p.type === "expense" && p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const profit = totalIncome - totalExpense;
  const todayLessons = lessons.filter(l => l.date === "2026-03-19");
  const pendingPayments = payments.filter(p => p.status === "pending");

  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground">Дашборд</h1>
        <p className="text-sm text-muted-foreground">Огляд вашої онлайн-школи</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Репетитори" value={tutors.length} icon={Users} />
        <StatCard label="Учні" value={students.length} icon={Users} />
        <StatCard label="Уроків сьогодні" value={todayLessons.length} icon={CalendarDays} />
        <StatCard label="Прибуток" value={`${profit} ₴`} icon={TrendingUp} variant="success" />
      </div>

      {/* Today's lessons */}
      <div className="mt-8">
        <h2 className="font-display text-lg font-semibold text-foreground mb-4">Сьогоднішні заняття</h2>
        <div className="space-y-3">
          {todayLessons.map((lesson) => {
            const tutor = getTutorById(lesson.tutorId);
            const student = getStudentById(lesson.studentId);
            return (
              <div key={lesson.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Clock className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{lesson.subject}</p>
                    <p className="text-xs text-muted-foreground">
                      {tutor?.name} → {student?.name}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-foreground">{lesson.time}</span>
                  <Badge
                    variant={lesson.status === "completed" ? "default" : "secondary"}
                    className={lesson.status === "completed" ? "bg-success text-success-foreground" : ""}
                  >
                    {lesson.status === "completed" ? "Проведено" : "Заплановано"}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pending payments */}
      {pendingPayments.length > 0 && (
        <div className="mt-8">
          <h2 className="font-display text-lg font-semibold text-foreground mb-4">Очікують оплати</h2>
          <div className="space-y-3">
            {pendingPayments.map((payment) => (
              <div key={payment.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/10">
                    <DollarSign className="h-4 w-4 text-warning" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{payment.personName}</p>
                    <p className="text-xs text-muted-foreground">{payment.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-foreground">{payment.amount} ₴</span>
                  <Badge className="bg-warning/10 text-warning border-0">Очікує</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </AppLayout>
  );
}
