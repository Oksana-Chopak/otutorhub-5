import { AppLayout } from "@/components/AppLayout";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, AppRole } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { GraduationCap, BookOpen, Users as UsersIcon, Settings, Loader2 } from "lucide-react";

interface Profile {
  id: string;
  first_name: string;
  last_name: string;
}

interface UserRow {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  role: AppRole | null;
  rate_per_lesson?: number;
  subjects?: string[];
}

const roleLabel: Record<AppRole, string> = {
  manager: "Менеджер",
  tutor: "Репетитор",
  student: "Учень",
};

export default function PeoplePage() {
  const { user: currentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [tutorRates, setTutorRates] = useState<Record<string, { rate: number; subjects: string[] }>>({});
  const [studentRates, setStudentRates] = useState<
    Array<{ id: string; tutor_id: string; student_id: string; price_per_lesson: number }>
  >([]);

  // Tutor rate dialog
  const [tutorDialog, setTutorDialog] = useState<{ open: boolean; userId: string; rate: string; subjects: string }>({
    open: false,
    userId: "",
    rate: "",
    subjects: "",
  });

  // Student price dialog
  const [studentDialog, setStudentDialog] = useState<{
    open: boolean;
    studentId: string;
    studentName: string;
    tutorId: string;
    price: string;
  }>({ open: false, studentId: "", studentName: "", tutorId: "", price: "" });

  const loadData = async () => {
    setLoading(true);
    const [profilesRes, contactsRes, rolesRes, tutorRes, ratesRes] = await Promise.all([
      supabase.from("profiles").select("id, first_name, last_name"),
      supabase.from("profile_contacts").select("user_id, phone"),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("tutor_details").select("user_id, rate_per_lesson, subjects"),
      supabase.from("student_rates").select("id, tutor_id, student_id, price_per_lesson"),
    ]);

    const profiles = (profilesRes.data ?? []) as Profile[];
    const contacts = (contactsRes.data ?? []) as { user_id: string; phone: string | null }[];
    const phoneMap = new Map(contacts.map((c) => [c.user_id, c.phone]));
    const roles = (rolesRes.data ?? []) as { user_id: string; role: AppRole }[];
    const tutorMap: Record<string, { rate: number; subjects: string[] }> = {};
    (tutorRes.data ?? []).forEach((t: any) => {
      tutorMap[t.user_id] = { rate: Number(t.rate_per_lesson), subjects: t.subjects ?? [] };
    });
    setTutorRates(tutorMap);
    setStudentRates((ratesRes.data ?? []) as any);

    const merged: UserRow[] = profiles.map((p) => {
      const r = roles.find((x) => x.user_id === p.id);
      const td = tutorMap[p.id];
      return {
        id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        phone: phoneMap.get(p.id) ?? null,
        role: r?.role ?? null,
        rate_per_lesson: td?.rate,
        subjects: td?.subjects,
      };
    });
    setUsers(merged);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const changeRole = async (userId: string, newRole: AppRole) => {
    if (userId === currentUser?.id && newRole !== "manager") {
      toast.error("Не можна знімати з себе роль менеджера");
      return;
    }
    // Видалити старі ролі і додати нову
    const { error: delErr } = await supabase.from("user_roles").delete().eq("user_id", userId);
    if (delErr) {
      console.error("Failed to remove existing roles", delErr);
      toast.error("Не вдалося оновити роль. Спробуйте ще раз.");
      return;
    }
    const { error: insErr } = await supabase.from("user_roles").insert({ user_id: userId, role: newRole });
    if (insErr) {
      console.error("Failed to insert role", insErr);
      toast.error("Не вдалося оновити роль. Спробуйте ще раз.");
      return;
    }

    // Створити details, якщо потрібно
    if (newRole === "tutor") {
      await supabase.from("tutor_details").upsert({ user_id: userId }, { onConflict: "user_id" });
    } else if (newRole === "student") {
      await supabase.from("student_details").upsert({ user_id: userId }, { onConflict: "user_id" });
    }

    toast.success("Роль оновлено");
    loadData();
  };

  const saveTutorRate = async () => {
    const rate = parseFloat(tutorDialog.rate);
    if (isNaN(rate) || rate < 0) {
      toast.error("Введіть коректну ставку");
      return;
    }
    const subjects = tutorDialog.subjects
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const { error } = await supabase
      .from("tutor_details")
      .upsert(
        { user_id: tutorDialog.userId, rate_per_lesson: rate, subjects },
        { onConflict: "user_id" }
      );
    if (error) {
      console.error("Failed to save tutor rate", error);
      toast.error("Не вдалося зберегти. Спробуйте ще раз.");
      return;
    }
    toast.success("Збережено");
    setTutorDialog({ open: false, userId: "", rate: "", subjects: "" });
    loadData();
  };

  const saveStudentPrice = async () => {
    const price = parseFloat(studentDialog.price);
    if (isNaN(price) || price < 0) {
      toast.error("Введіть коректну ціну");
      return;
    }
    // upsert by (tutor_id, student_id)
    const existing = studentRates.find(
      (r) => r.tutor_id === studentDialog.tutorId && r.student_id === studentDialog.studentId
    );
    if (existing) {
      const { error } = await supabase
        .from("student_rates")
        .update({ price_per_lesson: price })
        .eq("id", existing.id);
      if (error) {
        console.error("Failed to update student rate", error);
        toast.error("Не вдалося зберегти. Спробуйте ще раз.");
        return;
      }
    } else {
      const { error } = await supabase.from("student_rates").insert({
        tutor_id: studentDialog.tutorId,
        student_id: studentDialog.studentId,
        price_per_lesson: price,
      });
      if (error) {
        console.error("Failed to insert student rate", error);
        toast.error("Не вдалося зберегти. Спробуйте ще раз.");
        return;
      }
    }
    toast.success("Ціну збережено");
    setStudentDialog({ open: false, studentId: "", studentName: "", tutorId: "", price: "" });
    loadData();
  };

  const tutors = users.filter((u) => u.role === "tutor");
  const students = users.filter((u) => u.role === "student");
  const managers = users.filter((u) => u.role === "manager");
  const noRole = users.filter((u) => !u.role);

  const fullName = (u: UserRow) => `${u.first_name} ${u.last_name}`.trim() || "Без імені";

  const renderUserCard = (u: UserRow, accent?: "primary" | "secondary") => (
    <div key={u.id} className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
              accent === "primary"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-foreground"
            }`}
          >
            {(u.first_name[0] ?? "?") + (u.last_name[0] ?? "")}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{fullName(u)}</p>
            {u.role === "tutor" && u.subjects && u.subjects.length > 0 && (
              <p className="text-xs text-muted-foreground truncate">{u.subjects.join(", ")}</p>
            )}
            {u.role === "tutor" && u.rate_per_lesson !== undefined && (
              <p className="text-xs text-muted-foreground">Ставка: {u.rate_per_lesson} ₴/урок</p>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <Label className="text-xs text-muted-foreground shrink-0">Роль:</Label>
        <Select value={u.role ?? ""} onValueChange={(v) => changeRole(u.id, v as AppRole)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Без ролі" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manager">Менеджер</SelectItem>
            <SelectItem value="tutor">Репетитор</SelectItem>
            <SelectItem value="student">Учень</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {u.role === "tutor" && (
        <Button
          variant="outline"
          size="sm"
          className="w-full mt-2"
          onClick={() =>
            setTutorDialog({
              open: true,
              userId: u.id,
              rate: String(u.rate_per_lesson ?? ""),
              subjects: (u.subjects ?? []).join(", "),
            })
          }
        >
          <Settings className="h-3.5 w-3.5 mr-2" />
          Налаштувати ставку та предмети
        </Button>
      )}

      {u.role === "student" && tutors.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-xs text-muted-foreground mb-2">Ціна за урок (для конкретного репетитора):</p>
          <div className="space-y-1.5">
            {tutors.map((t) => {
              const rate = studentRates.find((r) => r.tutor_id === t.id && r.student_id === u.id);
              return (
                <div key={t.id} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground truncate flex-1">{fullName(t)}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-medium text-foreground">
                      {rate ? `${rate.price_per_lesson} ₴` : <span className="text-muted-foreground italic">не задано</span>}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() =>
                        setStudentDialog({
                          open: true,
                          studentId: u.id,
                          studentName: fullName(u),
                          tutorId: t.id,
                          price: rate ? String(rate.price_per_lesson) : "",
                        })
                      }
                    >
                      Змінити
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground">Люди</h1>
        <p className="text-sm text-muted-foreground">Керування користувачами, ролями та ставками</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {noRole.length > 0 && (
            <section className="mb-8">
              <h2 className="font-display text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                <UsersIcon className="h-5 w-5 text-warning" />
                Без ролі ({noRole.length})
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {noRole.map((u) => renderUserCard(u))}
              </div>
            </section>
          )}

          <section className="mb-8">
            <h2 className="font-display text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <UsersIcon className="h-5 w-5 text-primary" />
              Менеджери ({managers.length})
            </h2>
            {managers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Немає менеджерів</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {managers.map((u) => renderUserCard(u, "primary"))}
              </div>
            )}
          </section>

          <section className="mb-8">
            <h2 className="font-display text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-primary" />
              Репетитори ({tutors.length})
            </h2>
            {tutors.length === 0 ? (
              <p className="text-sm text-muted-foreground">Немає репетиторів</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {tutors.map((u) => renderUserCard(u, "primary"))}
              </div>
            )}
          </section>

          <section className="mb-8">
            <h2 className="font-display text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary" />
              Учні ({students.length})
            </h2>
            {students.length === 0 ? (
              <p className="text-sm text-muted-foreground">Немає учнів</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {students.map((u) => renderUserCard(u))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Tutor rate dialog */}
      <Dialog open={tutorDialog.open} onOpenChange={(o) => setTutorDialog((s) => ({ ...s, open: o }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Налаштування репетитора</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="rate">Ставка за урок (₴)</Label>
              <Input
                id="rate"
                type="number"
                min="0"
                step="any"
                value={tutorDialog.rate}
                onChange={(e) => setTutorDialog((s) => ({ ...s, rate: e.target.value }))}
                placeholder="напр. 350"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Скільки ви виплачуєте репетитору за один проведений урок
              </p>
            </div>
            <div>
              <Label htmlFor="subjects">Предмети (через кому)</Label>
              <Input
                id="subjects"
                value={tutorDialog.subjects}
                onChange={(e) => setTutorDialog((s) => ({ ...s, subjects: e.target.value }))}
                placeholder="напр. Англійська, Німецька"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTutorDialog((s) => ({ ...s, open: false }))}>
              Скасувати
            </Button>
            <Button onClick={saveTutorRate}>Зберегти</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Student price dialog */}
      <Dialog open={studentDialog.open} onOpenChange={(o) => setStudentDialog((s) => ({ ...s, open: o }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ціна для учня</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Учень: <span className="font-medium text-foreground">{studentDialog.studentName}</span>
            </p>
            <div>
              <Label htmlFor="price">Ціна за один урок (₴)</Label>
              <Input
                id="price"
                type="number"
                min="0"
                step="any"
                value={studentDialog.price}
                onChange={(e) => setStudentDialog((s) => ({ ...s, price: e.target.value }))}
                placeholder="напр. 500"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Скільки цей учень платить за урок з обраним репетитором
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStudentDialog((s) => ({ ...s, open: false }))}>
              Скасувати
            </Button>
            <Button onClick={saveStudentPrice}>Зберегти</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
