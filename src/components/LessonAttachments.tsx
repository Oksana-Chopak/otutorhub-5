import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { Paperclip, Upload, Trash2, Loader2, FileText, Image as ImageIcon, Download } from "lucide-react";

interface LessonAttachmentsProps {
  lessonId: string;
  tutorId: string;
  studentId: string;
  compact?: boolean;
}

interface AttachmentRow {
  id: string;
  uploader_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
}

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const ACCEPT = "application/pdf,image/png,image/jpeg,image/jpg,image/webp,image/gif";

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isImage(mime: string | null): boolean {
  return !!mime && mime.startsWith("image/");
}

export function LessonAttachments({ lessonId, tutorId, studentId, compact = false }: LessonAttachmentsProps) {
  const { user, roles } = useAuth();
  const isManager = roles.includes("manager");
  const isTutor = user?.id === tutorId;
  const isStudent = user?.id === studentId;
  const canUpload = isManager || isTutor || isStudent;

  const [items, setItems] = useState<AttachmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("lesson_attachments")
      .select("*")
      .eq("lesson_id", lessonId)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast({ title: t("lessonAttachments.loadFailed"), description: error.message, variant: "destructive" });
      return;
    }
    setItems(data ?? []);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  const handleUpload = async (file: File) => {
    if (!user) return;
    if (file.size > MAX_BYTES) {
      toast({ title: t("lessonAttachments.tooLarge"), description: t("lessonAttachments.tooLargeDesc"), variant: "destructive" });
      return;
    }
    setUploading(true);
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${lessonId}/${crypto.randomUUID()}-${safeName}`;

    const { error: upErr } = await supabase.storage
      .from("lesson-attachments")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) {
      setUploading(false);
      toast({ title: t("lessonAttachments.uploadFailed"), description: upErr.message, variant: "destructive" });
      return;
    }

    const { error: insErr } = await supabase.from("lesson_attachments").insert({
      lesson_id: lessonId,
      uploader_id: user.id,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
    });
    setUploading(false);
    if (insErr) {
      await supabase.storage.from("lesson-attachments").remove([path]);
      toast({ title: t("lessonAttachments.saveFailed"), description: insErr.message, variant: "destructive" });
      return;
    }
    toast({ title: t("lessonAttachments.fileAdded") });
    if (inputRef.current) inputRef.current.value = "";
    load();
  };

  const handleOpen = async (item: AttachmentRow) => {
    setBusyId(item.id);
    const { data, error } = await supabase.storage
      .from("lesson-attachments")
      .createSignedUrl(item.storage_path, 60 * 10);
    setBusyId(null);
    if (error || !data?.signedUrl) {
      toast({ title: t("lessonAttachments.openFailed"), description: error?.message, variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const handleDelete = async (item: AttachmentRow) => {
    if (!confirm(`Видалити «${item.file_name}»?`)) return;
    setBusyId(item.id);
    const { error: storageErr } = await supabase.storage.from("lesson-attachments").remove([item.storage_path]);
    if (storageErr) {
      setBusyId(null);
      toast({ title: "Помилка видалення файлу", description: storageErr.message, variant: "destructive" });
      return;
    }
    const { error: dbErr } = await supabase.from("lesson_attachments").delete().eq("id", item.id);
    setBusyId(null);
    if (dbErr) {
      toast({ title: "Помилка видалення запису", description: dbErr.message, variant: "destructive" });
      return;
    }
    toast({ title: "Видалено" });
    load();
  };

  const canDelete = (item: AttachmentRow) => isManager || isTutor || item.uploader_id === user?.id;

  return (
    <div className="space-y-2">
      {!compact && (
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Paperclip className="h-4 w-4 text-primary" />
          Файли та вкладення
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Завантаження…
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Поки що файлів немає.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-center gap-2 rounded-md border border-border bg-background/60 px-2 py-1.5 text-sm"
            >
              {isImage(it.mime_type) ? (
                <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <button
                type="button"
                onClick={() => handleOpen(it)}
                className="flex-1 truncate text-left hover:underline"
                title={it.file_name}
              >
                {it.file_name}
              </button>
              <span className="shrink-0 text-xs text-muted-foreground">{formatSize(it.size_bytes)}</span>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => handleOpen(it)}
                disabled={busyId === it.id}
                title="Відкрити"
              >
                {busyId === it.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              </Button>
              {canDelete(it) && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(it)}
                  disabled={busyId === it.id}
                  title="Видалити"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canUpload && (
        <div>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
            }}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Додати файл
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">PDF або зображення, до 15 МБ.</p>
        </div>
      )}
    </div>
  );
}
