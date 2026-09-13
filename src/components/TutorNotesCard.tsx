import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface Note {
  id: string;
  text: string;
  created_at: string;
}

export function TutorNotesCard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const load = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("tutor_notes" as any)
      .select("id, text, created_at")
      .eq("tutor_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10);
    if (!error && data) setNotes(data as unknown as Note[]);
  };

  useEffect(() => { load(); }, [user?.id]);

  const add = async () => {
    if (!user || !text.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("tutor_notes" as any)
        .insert({ tutor_id: user.id, text: text.trim() } as any);
      setSaving(false);
      if (error) { toast.error(t("tutorNotes.saveFailed")); return; }
      setText("");
      textareaRef.current?.focus();
      load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    const { error } = await supabase.from("tutor_notes" as any).delete().eq("id", id);
    if (error) { load(); toast.error(t("tutorNotes.deleteFailed")); }
  };

  return (
    /* 13.09: на десктопі це був самотній тонкий рядок на пів екрана — поруч із
       повітряною карткою «вільний час» він читався як службове поле, а не як
       «мої нотатки». Тепер це картка з підписом: та сама висота на телефоні,
       але на широкому екрані вона має вагу, співмірну із сусідами. */
    <div className="rounded-[16px] bg-card p-3.5 shadow-[0_1px_4px_rgba(0,0,0,0.05)] sm:p-4">
      <p className="mb-2.5 text-[13px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sub,#62677E)" }}>
        {t("tutorNotes.title")}
      </p>
      {/* Input row */}
      <div className="flex items-end gap-2">
        <textarea aria-label={t("tutorNotes.placeholder")}
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("tutorNotes.placeholder")}
          maxLength={500}
          rows={2}
          className="min-h-[72px] flex-1 resize-none rounded-xl border border-border bg-background px-3.5 py-2.5 text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); add(); }
          }}
        />
        <button
          onClick={add}
          disabled={saving || !text.trim()}
          aria-label={t("tutorNotes.add")}
          className={cn("tap-44", 
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-opacity",
            text.trim() ? "opacity-100" : "opacity-30 cursor-default"
          )}
          style={{ background: "var(--teal, #2BBFAA)" }}
        >
          {saving
            ? <Loader2 className="h-4 w-4 animate-spin text-white" />
            : <Check className="h-4 w-4 text-white" strokeWidth={2.5} />
          }
        </button>
      </div>

      {/* Notes list — plain, no cards, no borders */}
      <div className={notes.length ? "mt-2.5 space-y-0.5" : ""}>
      {notes.map((note) => (
        <div
          key={note.id}
          className="group flex items-start gap-2 px-1 py-1.5"
        >
          <p className="flex-1 text-[15px] italic leading-snug text-foreground/90">{note.text}</p>
          <button
            onClick={() => remove(note.id)}
            aria-label={t("tutorNotes.delete")}
            className="mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground/50 transition-colors hover:text-destructive hover:bg-destructive/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      </div>
    </div>
  );
}
