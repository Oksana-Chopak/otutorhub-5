import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { StickyNote, Trash2, Loader2, Plus, X } from "lucide-react";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

interface ManagerNote {
  id: string;
  content: string;
  author_id: string;
  created_at: string;
}

interface ManagerNotesProps {
  subjectUserId: string;
  currentUserId: string;
  compact?: boolean;
}

export function ManagerNotes({ subjectUserId, currentUserId, compact = false }: ManagerNotesProps) {
  const [notes, setNotes] = useState<ManagerNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("manager_notes")
      .select("id, content, author_id, created_at")
      .eq("subject_user_id", subjectUserId)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Failed to load notes", error);
    } else {
      setNotes((data ?? []) as ManagerNote[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (expanded) load();
  }, [expanded, subjectUserId]);

  const addNote = async () => {
    const content = draft.trim();
    if (!content) return;
    setSaving(true);
    const { error } = await supabase.from("manager_notes").insert({
      subject_user_id: subjectUserId,
      author_id: currentUserId,
      content,
    });
    setSaving(false);
    if (error) {
      console.error("Failed to add note", error);
      toast.error(t("managerNotes.saveFailed"));
      return;
    }
    setDraft("");
    toast.success(t("managerNotes.added"));
    load();
  };

  const deleteNote = async (id: string) => {
    if (!confirm(t("managerNotes.confirmDelete"))) return;
    const { error } = await supabase.from("manager_notes").delete().eq("id", id);
    if (error) {
      console.error("Failed to delete note", error);
      toast.error(t("managerNotes.deleteFailed"));
      return;
    }
    setNotes((prev) => prev.filter((n) => n.id !== id));
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("uk-UA", { day: "2-digit", month: "short", year: "numeric" });
  };

  return (
    <div className={compact ? "mt-2 border-t border-border pt-2" : "mt-3 border-t border-border pt-3"}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <StickyNote className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Приватні нотатки {notes.length > 0 && t("managerNotesExtra.titleWithCount", { count: notes.length }).replace("Приватні нотатки (", "").replace(")", "")}</span>
        {expanded ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
      </button>

      {expanded && (
        <div className={compact ? "mt-2 space-y-2" : "mt-3 space-y-3"}>
          <div className="flex gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("managerNotes.placeholder")}
              className={compact ? "min-h-[52px] resize-none text-xs" : "min-h-[60px] resize-none text-xs"}
            />
          </div>
          <Button
            size="sm"
            onClick={addNote}
            disabled={saving || !draft.trim()}
            className="w-full h-8 text-xs"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : t("managerNotesExtra.addBtn")}
          </Button>

          {loading ? (
            <div className="flex justify-center py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : notes.length === 0 ? (
            <p className="text-xs text-muted-foreground italic text-center py-1">{t("managerNotesExtra.noNotes")}</p>
          ) : (
            <div className="space-y-2">
              {notes.map((n) => (
                <div
                  key={n.id}
                  className="rounded-md bg-muted/40 border border-border p-2.5 text-xs space-y-1"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-foreground whitespace-pre-wrap flex-1 break-words">{n.content}</p>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteNote(n.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{formatDate(n.created_at)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
