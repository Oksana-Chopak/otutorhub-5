import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Plus, X, Crown, DollarSign, Wallet, BarChart3, Trophy, HandHeart,
  CalendarClock, ShieldAlert, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { SUBJECT_OPTIONS } from "@/lib/subjects";
import { AutoCompleteLessonsCard } from "@/components/AutoCompleteLessonsCard";
import { ProRulesCard } from "@/components/ProRulesCard";
import { GoogleCalendarCard } from "@/components/GoogleCalendarCard";

type SectionItem = { to: string; label: string; icon: typeof Crown; desc?: string };

function MoreSection({ title, items }: { title: string; items: SectionItem[] }) {
  if (items.length === 0) return null;
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((it) => (
          <Link
            key={it.to}
            to={it.to}
            className="group flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-secondary"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <it.icon className="h-5 w-5" />
            </span>
            <span className="flex-1 text-sm font-medium text-foreground">{it.label}</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

export default function ProfilePage() {
  const { user, roles } = useAuth();
  const isTutor = roles.includes("tutor");
  const isManager = roles.includes("manager");
  const { isIndependent } = useWorkspaceSettings();

  const tutorMore: SectionItem[] = isTutor
    ? [
        { to: "/subscription", label: "Підписка", icon: Crown },
        { to: "/finances", label: "Фінанси", icon: DollarSign },
        { to: "/wallets", label: "Передоплати", icon: Wallet },
        { to: "/analytics", label: "Аналітика", icon: BarChart3 },
        { to: "/achievements", label: "Досягнення", icon: Trophy },
        { to: "/my-referrals", label: "Реферали", icon: HandHeart },
        { to: "/availability", label: "Доступність", icon: CalendarClock },
      ].filter((it) => {
        // Hide independent-only items for tutors who are part of a school workspace
        if (!isIndependent && ["/subscription", "/finances", "/wallets", "/analytics", "/achievements", "/my-referrals"].includes(it.to)) return false;
        return true;
      })
    : [];

  const managerMore: SectionItem[] = isManager
    ? [
        { to: "/finances", label: "Фінанси", icon: DollarSign },
        { to: "/wallets", label: "Передоплати", icon: Wallet },
        { to: "/availability", label: "Доступність", icon: CalendarClock },
        { to: "/referrals", label: "Запити на репетиторів", icon: HandHeart },
        { to: "/subscription-requests", label: "Запити на підписку", icon: Crown },
        { to: "/paywall-metrics", label: "Метрики paywall", icon: BarChart3 },
        { to: "/audit", label: "Аудит", icon: ShieldAlert },
      ]
    : [];

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [newSubject, setNewSubject] = useState("");

  useEffect(() => {
    if (!user || !isTutor) {
      setLoading(false);
      return;
    }
    (async () => {
      const [detailsRes, lessonsRes, ratesRes] = await Promise.all([
        supabase.from("tutor_details").select("subjects").eq("user_id", user.id).maybeSingle(),
        supabase.from("lessons").select("subject").eq("tutor_id", user.id),
        supabase.from("student_rates").select("subject").eq("tutor_id", user.id),
      ]);

      const stored = (detailsRes.data?.subjects as string[] | null) ?? [];
      const fromLessons = (lessonsRes.data ?? [])
        .map((l) => (l.subject ?? "").trim())
        .filter(Boolean);
      const fromRates = (ratesRes.data ?? [])
        .map((r) => (r.subject ?? "").trim())
        .filter(Boolean);

      // Об'єднуємо без дублікатів (case-insensitive), але зберігаємо першу версію назви
      const merged: string[] = [];
      const seen = new Set<string>();
      for (const item of [...stored, ...fromLessons, ...fromRates]) {
        const key = item.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(item);
        }
      }

      setSubjects(merged);

      // Якщо знайшли нові предмети з уроків/ставок — мовчки збережемо їх у профіль
      if (merged.length > stored.length) {
        await supabase
          .from("tutor_details")
          .upsert({ user_id: user.id, subjects: merged }, { onConflict: "user_id" });
      }

      setLoading(false);
    })();
  }, [user?.id, isTutor]);

  const customSubjects = useMemo(
    () => subjects.filter((s) => !(SUBJECT_OPTIONS as readonly string[]).includes(s)),
    [subjects]
  );

  const toggleSubject = (subject: string) => {
    setSubjects((prev) =>
      prev.includes(subject) ? prev.filter((s) => s !== subject) : [...prev, subject]
    );
  };

  const addCustomSubject = () => {
    const trimmed = newSubject.trim();
    if (!trimmed) return;
    if (trimmed.length > 60) {
      toast.error("Назва предмета занадто довга");
      return;
    }
    const exists = subjects.some((s) => s.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      toast.info("Цей предмет вже є у списку");
      setNewSubject("");
      return;
    }
    setSubjects((prev) => [...prev, trimmed]);
    setNewSubject("");
  };

  const removeCustomSubject = (subject: string) => {
    setSubjects((prev) => prev.filter((s) => s !== subject));
  };

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("tutor_details")
      .upsert({ user_id: user.id, subjects }, { onConflict: "user_id" });
    setSaving(false);
    if (error) {
      console.error(error);
      toast.error("Не вдалося зберегти предмети");
      return;
    }
    toast.success("Предмети збережено");
  };

  if (!isTutor) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-2xl">
          <div className="mb-6">
            <h1 className="font-display text-2xl font-bold text-foreground">Профіль</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Керуйте своїм робочим простором.
            </p>
          </div>
          <GoogleCalendarCard />
          <MoreSection title="Розділи" items={managerMore} />
          {managerMore.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Немає додаткових налаштувань.
              </CardContent>
            </Card>
          )}
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-2xl">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold text-foreground">Мій профіль</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Вкажіть предмети, які ви викладаєте — їх бачитиме менеджер та учні.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Предмети</CardTitle>
            <CardDescription>
              Оберіть зі списку або додайте власний предмет, якщо його немає.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {SUBJECT_OPTIONS.map((subject) => {
                    const checked = subjects.includes(subject);
                    return (
                      <Label
                        key={subject}
                        className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm font-normal transition-colors hover:bg-secondary"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleSubject(subject)}
                        />
                        <span className="flex-1">{subject}</span>
                      </Label>
                    );
                  })}
                </div>

                <div className="mt-6 space-y-3 rounded-lg border border-dashed border-border p-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">Власні предмети</p>
                    <p className="text-xs text-muted-foreground">
                      Додайте предмет, якого немає у списку вище.
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Input
                      value={newSubject}
                      onChange={(e) => setNewSubject(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addCustomSubject();
                        }
                      }}
                      placeholder="Напр.: Логіка, Робототехніка"
                      maxLength={60}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={addCustomSubject}
                      disabled={!newSubject.trim()}
                    >
                      <Plus className="mr-1 h-4 w-4" />
                      Додати
                    </Button>
                  </div>

                  {customSubjects.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {customSubjects.map((subject) => (
                        <Badge
                          key={subject}
                          variant="secondary"
                          className="gap-1 py-1 pl-3 pr-1 text-sm font-normal"
                        >
                          {subject}
                          <button
                            type="button"
                            onClick={() => removeCustomSubject(subject)}
                            className="ml-1 rounded-full p-0.5 transition-colors hover:bg-background"
                            aria-label={`Видалити ${subject}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-6 flex justify-end">
                  <Button onClick={save} disabled={saving}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Зберегти
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {isIndependent && (
          <div className="mt-6">
            <ProRulesCard />
          </div>
        )}
        {isIndependent && <AutoCompleteLessonsCard />}
        <GoogleCalendarCard />
        <MoreSection title="Більше" items={tutorMore} />
      </div>
    </AppLayout>
  );
}
