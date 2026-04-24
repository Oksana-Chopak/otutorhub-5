import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SUBJECT_OPTIONS } from "@/lib/subjects";

export default function ProfilePage() {
  const { user, roles } = useAuth();
  const isTutor = roles.includes("tutor");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [subjects, setSubjects] = useState<string[]>([]);

  useEffect(() => {
    if (!user || !isTutor) {
      setLoading(false);
      return;
    }
    supabase
      .from("tutor_details")
      .select("subjects")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setSubjects((data?.subjects as string[] | null) ?? []);
        setLoading(false);
      });
  }, [user?.id, isTutor]);

  const toggleSubject = (subject: string) => {
    setSubjects((prev) =>
      prev.includes(subject) ? prev.filter((s) => s !== subject) : [...prev, subject]
    );
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
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Ця сторінка доступна репетиторам.
            </CardContent>
          </Card>
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
            <CardDescription>Оберіть один або кілька предметів зі списку.</CardDescription>
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
      </div>
    </AppLayout>
  );
}
