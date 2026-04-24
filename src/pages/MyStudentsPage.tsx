import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings, FREE_STUDENT_LIMIT } from "@/hooks/useWorkspaceSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserAvatar } from "@/components/UserAvatar";
import { SubscriptionLimitDialog } from "@/components/SubscriptionLimitDialog";
import { EmptyState } from "@/components/EmptyState";
import {
  UserPlus,
  Loader2,
  Phone,
  Mail,
  Send,
  Facebook,
  Instagram,
  Pencil,
  Trash2,
  Hourglass,
  Crown,
  Banknote,
} from "lucide-react";
import { toast } from "sonner";

interface MyStudent {
  id: string;
  first_name: string;
  last_name: string;
  is_pending: boolean;
  avatar_url: string | null;
  phone: string | null;
  email: string | null;
  telegram: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  rate_id: string | null;
  price: number;
  subject: string;
}

interface FormData {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  telegram: string;
  facebook_url: string;
  instagram_url: string;
  subject: string;
  price: string;
}

const emptyForm: FormData = {
  first_name: "",
  last_name: "",
  phone: "",
  email: "",
  telegram: "",
  facebook_url: "",
  instagram_url: "",
  subject: "",
  price: "",
};

export default function MyStudentsPage() {
  const navigate = useNavigate();
  const { user, roles } = useAuth();
  const isTutor = roles.includes("tutor");
  const { isIndependent, studentCount, isAtLimit, refresh, loading: wsLoading } =
    useWorkspaceSettings();

  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<MyStudent[]>([]);
  const [dialog, setDialog] = useState<{ open: boolean; mode: "create" | "edit"; studentId: string | null }>(
    { open: false, mode: "create", studentId: null }
  );
  const [form, setForm] = useState<FormData>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);

  useEffect(() => {
    if (!wsLoading && user && (!isTutor || !isIndependent)) {
      navigate("/onboarding", { replace: true });
    }
  }, [wsLoading, user, isTutor, isIndependent, navigate]);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data: rates } = await supabase
      .from("student_rates")
      .select("id, student_id, subject, price_per_lesson")
      .eq("tutor_id", user.id)
      .eq("source", "independent");

    const ids = Array.from(new Set((rates ?? []).map((r: any) => r.student_id)));
    if (ids.length === 0) {
      setStudents([]);
      setLoading(false);
      return;
    }

    const [{ data: profiles }, { data: contacts }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, first_name, last_name, is_pending, avatar_url")
        .in("id", ids),
      supabase
        .from("profile_contacts")
        .select("user_id, phone, email, telegram, facebook_url, instagram_url")
        .in("user_id", ids),
    ]);

    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    const contactMap = new Map((contacts ?? []).map((c: any) => [c.user_id, c]));

    const merged: MyStudent[] = ids.map((id) => {
      const p = profileMap.get(id) ?? {};
      const c = contactMap.get(id) ?? {};
      const r = (rates ?? []).find((x: any) => x.student_id === id);
      return {
        id,
        first_name: p.first_name ?? "",
        last_name: p.last_name ?? "",
        is_pending: p.is_pending ?? false,
        avatar_url: p.avatar_url ?? null,
        phone: c.phone ?? null,
        email: c.email ?? null,
        telegram: c.telegram ?? null,
        facebook_url: c.facebook_url ?? null,
        instagram_url: c.instagram_url ?? null,
        rate_id: r?.id ?? null,
        price: Number(r?.price_per_lesson ?? 0),
        subject: r?.subject ?? "",
      };
    });
    merged.sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`, "uk"));
    setStudents(merged);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [user?.id]);

  const openCreate = () => {
    if (isAtLimit) {
      setLimitOpen(true);
      return;
    }
    setForm(emptyForm);
    setDialog({ open: true, mode: "create", studentId: null });
  };

  const openEdit = (s: MyStudent) => {
    setForm({
      first_name: s.first_name,
      last_name: s.last_name,
      phone: s.phone ?? "",
      email: s.email ?? "",
      telegram: s.telegram ?? "",
      facebook_url: s.facebook_url ?? "",
      instagram_url: s.instagram_url ?? "",
      subject: s.subject ?? "",
      price: String(s.price ?? ""),
    });
    setDialog({ open: true, mode: "edit", studentId: s.id });
  };

  const submit = async () => {
    if (!user) return;
    const fn = form.first_name.trim();
    const ln = form.last_name.trim();
    const email = form.email.trim().toLowerCase();
    const phone = form.phone.trim();
    const subject = form.subject.trim();
    const price = parseFloat(form.price);

    if (!fn && !ln) {
      toast.error("Вкажіть ім'я або прізвище учня");
      return;
    }
    if (!email && !phone) {
      toast.error("Потрібен email або телефон, щоб учень міг приєднатися");
      return;
    }
    if (!subject) {
      toast.error("Вкажіть предмет");
      return;
    }
    if (isNaN(price) || price < 0) {
      toast.error("Введіть коректну ціну за урок");
      return;
    }

    setSubmitting(true);

    if (dialog.mode === "create") {
      // Re-check limit at submit time
      if (isAtLimit) {
        setSubmitting(false);
        setDialog({ open: false, mode: "create", studentId: null });
        setLimitOpen(true);
        return;
      }

      const newId = crypto.randomUUID();

      // 1. Ghost profile
      const { error: profErr } = await supabase
        .from("profiles")
        .insert({ id: newId, first_name: fn, last_name: ln, is_pending: true });
      if (profErr) {
        console.error(profErr);
        toast.error(profErr.message || "Не вдалося створити профіль");
        setSubmitting(false);
        return;
      }

      // 2. Student role (RLS allows independent tutor to assign 'student' role to a pending ghost profile)
      const { error: roleErr } = await supabase
        .from("user_roles")
        .insert({ user_id: newId, role: "student" });
      if (roleErr) {
        console.error(roleErr);
        await supabase.from("profiles").delete().eq("id", newId);
        toast.error("Не вдалося призначити роль");
        setSubmitting(false);
        return;
      }

      // 3. Rate (independent source) — must exist BEFORE contacts/details so RLS for independent tutor passes
      const { error: rateErr } = await supabase.from("student_rates").insert({
        tutor_id: user.id,
        student_id: newId,
        subject,
        price_per_lesson: price,
        source: "independent",
      });
      if (rateErr) {
        console.error(rateErr);
        await supabase.from("user_roles").delete().eq("user_id", newId);
        await supabase.from("profiles").delete().eq("id", newId);
        toast.error("Не вдалося зберегти ціну");
        setSubmitting(false);
        return;
      }

      // 4. Contacts (now allowed by 'Independent tutor manages own student contacts' RLS)
      const { error: contErr } = await supabase.from("profile_contacts").insert({
        user_id: newId,
        email: email || null,
        phone: phone || null,
        telegram: form.telegram.trim() || null,
        facebook_url: form.facebook_url.trim() || null,
        instagram_url: form.instagram_url.trim() || null,
      });
      if (contErr) {
        console.error(contErr);
        await supabase.from("student_rates").delete().eq("tutor_id", user.id).eq("student_id", newId);
        await supabase.from("user_roles").delete().eq("user_id", newId);
        await supabase.from("profiles").delete().eq("id", newId);
        toast.error(
          String(contErr.message || "").includes("email_lower")
            ? "Цей email вже зареєстровано"
            : "Не вдалося зберегти контакти"
        );
        setSubmitting(false);
        return;
      }

      // 5. Student details
      await supabase.from("student_details").upsert({ user_id: newId }, { onConflict: "user_id" });

      toast.success("Учня додано. Дані зв'яжуться з його акаунтом після реєстрації.");
    } else if (dialog.mode === "edit" && dialog.studentId) {
      // Update profile
      await supabase
        .from("profiles")
        .update({ first_name: fn, last_name: ln })
        .eq("id", dialog.studentId);

      // Update contacts (upsert)
      await supabase.from("profile_contacts").upsert(
        {
          user_id: dialog.studentId,
          email: email || null,
          phone: phone || null,
          telegram: form.telegram.trim() || null,
          facebook_url: form.facebook_url.trim() || null,
          instagram_url: form.instagram_url.trim() || null,
        },
        { onConflict: "user_id" }
      );

      // Update rate
      const existing = students.find((s) => s.id === dialog.studentId);
      if (existing?.rate_id) {
        await supabase
          .from("student_rates")
          .update({ subject, price_per_lesson: price })
          .eq("id", existing.rate_id);
      }

      toast.success("Дані учня оновлено");
    }

    setSubmitting(false);
    setDialog({ open: false, mode: "create", studentId: null });
    await Promise.all([load(), refresh()]);
  };

  const remove = async (s: MyStudent) => {
    if (!confirm(`Видалити учня ${s.first_name} ${s.last_name} з ваших учнів?`)) return;
    if (s.rate_id) {
      await supabase.from("student_rates").delete().eq("id", s.rate_id);
    }
    // Delete ghost profile if pending
    if (s.is_pending) {
      await supabase.from("profiles").delete().eq("id", s.id);
    }
    toast.success("Видалено");
    await Promise.all([load(), refresh()]);
  };

  const remainingFree = Math.max(0, FREE_STUDENT_LIMIT - studentCount);

  return (
    <AppLayout>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Мої учні</h1>
          <p className="text-sm text-muted-foreground">
            Учні, яких ви ведете самостійно. Ціни і розклад — повністю на вас.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
            {studentCount} / {FREE_STUDENT_LIMIT} безкоштовно
          </span>
          <Button onClick={openCreate}>
            <UserPlus className="mr-2 h-4 w-4" />
            Додати учня
          </Button>
        </div>
      </div>

      {isAtLimit && (
        <Card className="mb-4 border-warning/50 bg-warning/5">
          <CardContent className="flex items-start gap-3 p-4">
            <Crown className="mt-0.5 h-5 w-5 text-warning" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                Ви досягли ліміту безкоштовного плану
              </p>
              <p className="text-xs text-muted-foreground">
                Оформіть підписку 145 ₴/міс, щоб додавати більше учнів.
              </p>
            </div>
            <Button size="sm" onClick={() => setLimitOpen(true)}>
              Підписка
            </Button>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : students.length === 0 ? (
        <EmptyState
          icon={UserPlus}
          title="У вас поки немає власних учнів"
          description="Додайте першого учня — і почніть планувати уроки. До 5 учнів — безкоштовно."
          actionLabel="Додати учня"
          onAction={openCreate}
        />
      ) : (
        <div className="space-y-3">
          {students.map((s) => (
            <Card key={s.id}>
              <CardContent className="flex items-start gap-4 p-4">
                <UserAvatar
                  url={s.avatar_url}
                  firstName={s.first_name}
                  lastName={s.last_name}
                  className="h-10 w-10"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">
                      {`${s.first_name} ${s.last_name}`.trim() || "Без імені"}
                    </p>
                    {s.is_pending && (
                      <span
                        className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning"
                        title="Учень ще не зареєструвався"
                      >
                        <Hourglass className="h-3 w-3" />
                        Очікує реєстрації
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{s.subject}</span>
                    <span className="inline-flex items-center gap-1">
                      <Banknote className="h-3 w-3" />
                      {s.price} ₴/урок
                    </span>
                    {s.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {s.phone}
                      </span>
                    )}
                    {s.email && (
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {s.email}
                      </span>
                    )}
                    {s.telegram && (
                      <span className="inline-flex items-center gap-1">
                        <Send className="h-3 w-3" />
                        {s.telegram}
                      </span>
                    )}
                    {s.facebook_url && (
                      <a
                        href={s.facebook_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        <Facebook className="h-3 w-3" />
                        Facebook
                      </a>
                    )}
                    {s.instagram_url && (
                      <a
                        href={s.instagram_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        <Instagram className="h-3 w-3" />
                        Instagram
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(s)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(s)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog
        open={dialog.open}
        onOpenChange={(v) => !v && setDialog({ open: false, mode: "create", studentId: null })}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {dialog.mode === "create" ? "Додати учня" : "Редагувати учня"}
            </DialogTitle>
            <DialogDescription>
              Заповніть контакти — учень отримає запрошення приєднатися до вашого кабінету.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Ім'я</Label>
                <Input
                  value={form.first_name}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Прізвище</Label>
                <Input
                  value={form.last_name}
                  onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Телефон</Label>
                <Input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Telegram</Label>
              <Input
                placeholder="@username або +380..."
                value={form.telegram}
                onChange={(e) => setForm({ ...form, telegram: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Facebook</Label>
                <Input
                  placeholder="https://facebook.com/..."
                  value={form.facebook_url}
                  onChange={(e) => setForm({ ...form, facebook_url: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Instagram</Label>
                <Input
                  placeholder="https://instagram.com/..."
                  value={form.instagram_url}
                  onChange={(e) => setForm({ ...form, instagram_url: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Предмет</Label>
                <Input
                  placeholder="Англійська, математика…"
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Ціна за урок (₴)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialog({ open: false, mode: "create", studentId: null })}
            >
              Скасувати
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {dialog.mode === "create" ? "Додати" : "Зберегти"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SubscriptionLimitDialog
        open={limitOpen}
        onOpenChange={setLimitOpen}
        studentCount={studentCount}
      />
    </AppLayout>
  );
}
