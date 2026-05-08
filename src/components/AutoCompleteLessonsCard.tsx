import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Toggle for independent tutors: auto-mark lessons as completed
 * 1 hour after they end (executed by lesson-reminders cron).
 */
export function AutoCompleteLessonsCard() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("tutor_workspace_settings")
        .select("auto_complete_lessons")
        .eq("tutor_id", user.id)
        .maybeSingle();
      setEnabled(Boolean((data as any)?.auto_complete_lessons));
    })();
  }, [user?.id]);

  const onToggle = async (next: boolean) => {
    if (!user) return;
    setSaving(true);
    setEnabled(next);
    const { error } = await supabase
      .from("tutor_workspace_settings")
      .upsert(
        { tutor_id: user.id, auto_complete_lessons: next, auto_complete_prompted: true } as any,
        { onConflict: "tutor_id" },
      );
    setSaving(false);
    if (error) {
      toast.error("Не вдалося зберегти");
      setEnabled(!next);
      return;
    }
    toast.success(next ? "Авто-відмітка увімкнена" : "Авто-відмітка вимкнена");
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-base">Як відмічати проведені уроки</CardTitle>
        <CardDescription>
          Якщо увімкнено — урок автоматично стає «Проведено» через 1 годину після закінчення.
          Інакше — відмічайте вручну на дашборді.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="auto-complete" className="text-sm">
            Автоматично відмічати уроки як проведені
          </Label>
          <Switch id="auto-complete" checked={enabled} onCheckedChange={onToggle} disabled={saving} />
        </div>
      </CardContent>
    </Card>
  );
}
