import { AppLayout } from "@/components/AppLayout";
import { lessons, getTutorById, getStudentById } from "@/lib/mock-data";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";

const days = [
  { date: "2026-03-17", label: "Пн, 17 бер" },
  { date: "2026-03-18", label: "Вт, 18 бер" },
  { date: "2026-03-19", label: "Ср, 19 бер (сьогодні)" },
  { date: "2026-03-20", label: "Чт, 20 бер" },
];

export default function SchedulePage() {
  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground">Розклад занять</h1>
        <p className="text-sm text-muted-foreground">Тижневий огляд</p>
      </div>

      <div className="space-y-6">
        {days.map((day) => {
          const dayLessons = lessons.filter((l) => l.date === day.date);
          const isToday = day.date === "2026-03-19";
          return (
            <div key={day.date}>
              <h3 className={`font-display text-sm font-semibold mb-3 ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                {day.label}
              </h3>
              {dayLessons.length === 0 ? (
                <p className="text-xs text-muted-foreground pl-4">Немає занять</p>
              ) : (
                <div className="space-y-2">
                  {dayLessons.map((lesson) => {
                    const tutor = getTutorById(lesson.tutorId);
                    const student = getStudentById(lesson.studentId);
                    return (
                      <div
                        key={lesson.id}
                        className={`flex items-center justify-between rounded-xl border p-4 ${
                          isToday ? "border-primary/20 bg-primary/5" : "border-border bg-card"
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                            <Clock className="h-4 w-4 text-primary" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {lesson.subject} — {lesson.time}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {tutor?.name} → {student?.name} · {lesson.duration} хв
                            </p>
                          </div>
                        </div>
                        <Badge
                          variant={lesson.status === "completed" ? "default" : lesson.status === "cancelled" ? "destructive" : "secondary"}
                          className={lesson.status === "completed" ? "bg-success text-success-foreground" : ""}
                        >
                          {lesson.status === "completed" ? "Проведено" : lesson.status === "cancelled" ? "Скасовано" : "Заплановано"}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </AppLayout>
  );
}
