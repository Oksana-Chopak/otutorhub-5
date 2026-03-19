import { AppLayout } from "@/components/AppLayout";
import { tutors, students, lessons } from "@/lib/mock-data";
import { BookOpen, GraduationCap } from "lucide-react";

export default function PeoplePage() {
  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground">Люди</h1>
        <p className="text-sm text-muted-foreground">Репетитори та учні</p>
      </div>

      {/* Tutors */}
      <h2 className="font-display text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
        <GraduationCap className="h-5 w-5 text-primary" />
        Репетитори
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-8">
        {tutors.map((tutor) => {
          const tutorLessons = lessons.filter((l) => l.tutorId === tutor.id && l.status === "completed").length;
          return (
            <div key={tutor.id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  {tutor.avatar}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{tutor.name}</p>
                  <p className="text-xs text-muted-foreground">{tutor.subject}</p>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Ставка: {tutor.rate} ₴/урок</span>
                <span>Уроків: {tutorLessons}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Students */}
      <h2 className="font-display text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
        <BookOpen className="h-5 w-5 text-primary" />
        Учні
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {students.map((student) => {
          const studentLessons = lessons.filter((l) => l.studentId === student.id && l.status === "completed").length;
          return (
            <div key={student.id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-foreground">
                  {student.avatar}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{student.name}</p>
                  <p className="text-xs text-muted-foreground">{student.subject}</p>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                Проведено уроків: {studentLessons}
              </div>
            </div>
          );
        })}
      </div>
    </AppLayout>
  );
}
