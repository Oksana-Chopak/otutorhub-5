import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

/**
 * One-time prompt for independent tutors: how to mark lessons as completed.
 * Saves choice into tutor_workspace_settings.auto_complete_lessons and sets
 * auto_complete_prompted = true so it never shows again.
 */
export function AutoCompletePromptDialog({ enabled }: { enabled: boolean }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!enabled || !user) return;
    (async () => {
      const { data } = await supabase
        .from("tutor_workspace_settings")
        .select("auto_complete_prompted")
        .eq("tutor_id", user.id)
        .maybeSingle();
      if (!(data as any)?.auto_complete_prompted) {
        setOpen(true);
      }
    })();
  }, [enabled, user?.id]);

  const choose = async (auto: boolean) => {
    if (!user) return;
    setSaving(true);
    await supabase
      .from("tutor_workspace_settings")
      .upsert(
        {
          tutor_id: user.id,
          auto_complete_lessons: auto,
          auto_complete_prompted: true,
        } as any,
        { onConflict: "tutor_id" },
      );
    setSaving(false);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("autoComplete.dialogTitle")}</DialogTitle>
          <DialogDescription>
            Можна автоматично через 1 годину після закінчення уроку, або вручну —
            кнопкою «Проведено» на дашборді. Завжди можна змінити в налаштуваннях.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            disabled={saving}
            className="w-full sm:w-auto"
            onClick={() => choose(false)}
          >
            Вручну
          </Button>
          <Button disabled={saving} className="w-full sm:w-auto" onClick={() => choose(true)}>
            Автоматично
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
