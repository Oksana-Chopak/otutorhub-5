import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, StickyNote, X, Plus } from "lucide-react";
import { toast } from "sonner";

interface Note {
  id: string;
  text: string;
  created_at: string;
}

export function TutorNotesCard() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("tutor_notes" as any)
      .select("id, text, created_at")
      .eq("tutor_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10);
    if (!error && data) setNotes(data as unknown as Note[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const add = async () => {
    if (!user || !text.trim()) return;
    setSaving(true);
    const { error } = await supabase
      .from("tutor_notes" as any)
      .insert({ tutor_id: user.id, text: text.trim() } as any);
    setSaving(false);
    if (error) {
      toast.error("ÐÐµ Ð²Ð´Ð°Ð»Ð¾ÑÑ Ð·Ð±ÐµÑÐµÐ³ÑÐ¸ Ð½Ð¾ÑÐ°ÑÐºÑ");
      return;
    }
    setText("");
    load();
  };

  const remove = async (id: string) => {
    const prev = notes;
    setNotes(notes.filter((n) => n.id !== id));
    const { error } = await supabase.from("tutor_notes" as any).delete().eq("id", id);
    if (error) {
      setNotes(prev);
      toast.error("ÐÐµ Ð²Ð´Ð°Ð»Ð¾ÑÑ Ð²Ð¸Ð´Ð°Ð»Ð¸ÑÐ¸");
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
          <StickyNote className="h-4 w-4 text-primary" />
        </div>
        <p className="text-sm font-medium text-foreground">ÐÐ¾Ñ Ð½Ð¾ÑÐ°ÑÐºÐ¸</p>
      </div>
      <div className="space-y-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ð©Ð¾ Ð½Ðµ Ð·Ð°Ð±ÑÑÐ¸..."
          className="min-h-[60px] text-sm"
          maxLength={500}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add(); } }}
        />
        <Button
          size="sm"
          onClick={add}
          disabled={saving || !text.trim()}
          className="w-full sm:w-auto"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          ÐÐ¾Ð´Ð°ÑÐ¸
        </Button>
      </div>
      <div className="mt-3 space-y-1.5">
        {loading ? (
          <div className="flex justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : notes.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">Ð©Ðµ Ð½ÐµÐ¼Ð°Ñ Ð½Ð¾ÑÐ°ÑÐ¾Ðº.</p>
        ) : (
          notes.map((n) => (
            <div
              key={n.id}
              className="group flex items-start gap-2 rounded-md border border-border/60 bg-background/50 px-2.5 py-1.5"
            >
              <p className="flex-1 whitespace-pre-wrap break-words text-xs text-foreground">{n.text}</p>
              <button
                type="button"
                onClick={() => remove(n.id)}
                className="opacity-50 transition-opacity hover:opacity-100"
                aria-label="ÐÐ¸Ð´Ð°Ð»Ð¸ÑÐ¸"
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
