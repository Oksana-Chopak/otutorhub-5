import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FileText, Download, Loader2, Image as ImageIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface ChatAttachmentData {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
}

interface Props {
  attachment: ChatAttachmentData;
  mine: boolean;
}

function formatBytes(b: number | null) {
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

const SIGNED_URL_TTL_SEC = 60 * 60; // 1 hour

export function ChatAttachment({ attachment, mine }: Props) {
  const { t } = useTranslation();
  const isImage = !!attachment.mime_type?.startsWith("image/");
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchUrl = async () => {
      setLoading(true);
      setError(null);
      const { data, error: err } = await supabase.storage
        .from("chat-attachments")
        .createSignedUrl(attachment.storage_path, SIGNED_URL_TTL_SEC);
      if (cancelled) return;
      if (err || !data?.signedUrl) {
        setError(err?.message ?? t("chatAttachment.fetchFailed"));
      } else {
        setUrl(data.signedUrl);
      }
      setLoading(false);
    };
    fetchUrl();
    return () => {
      cancelled = true;
    };
  }, [attachment.storage_path]);

  // Image preview tile (Telegram-like)
  if (isImage) {
    return (
      <>
        <div
          className={cn(
            "group relative overflow-hidden rounded-lg border",
            mine ? "border-primary-foreground/30" : "border-border"
          )}
        >
          {loading || !url ? (
            <div className="flex aspect-video w-full max-w-[240px] items-center justify-center bg-muted/40">
              {error ? (
                <span className="text-[11px] text-destructive px-2 text-center">{error}</span>
              ) : (
                <Loader2 className="h-4 w-4 animate-spin opacity-60" />
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              className="block w-full"
              title={attachment.file_name}
            >
              <img
                src={url}
                alt={attachment.file_name}
                loading="lazy"
                className="block max-h-[260px] w-auto max-w-[240px] object-cover"
              />
            </button>
          )}
          {url && (
            <a
              href={url}
              download={attachment.file_name}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-foreground opacity-0 shadow-sm transition-opacity hover:bg-background group-hover:opacity-100",
                "max-md:opacity-100"
              )}
              title={t("chatAttachment.download")}
            >
              <Download className="h-3.5 w-3.5" />
            </a>
          )}
        </div>

        <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
          <DialogContent className="max-w-3xl p-2 sm:p-4">
            <DialogTitle className="sr-only">{attachment.file_name}</DialogTitle>
            {url && (
              <div className="space-y-2">
                <img
                  src={url}
                  alt={attachment.file_name}
                  className="mx-auto max-h-[80vh] w-auto rounded-md object-contain"
                />
                <div className="flex items-center justify-between gap-2 px-1">
                  <span className="truncate text-xs text-muted-foreground" title={attachment.file_name}>
                    {attachment.file_name}
                  </span>
                  <a
                    href={url}
                    download={attachment.file_name}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-accent"
                  >
                    <Download className="h-3 w-3" />
                    {t("chatAttachment.download")}
                  </a>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // Non-image file: standard <a download> (works on mobile, no popup blocker)
  return (
    <a
      href={url ?? "#"}
      download={attachment.file_name}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        if (!url) e.preventDefault();
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors",
        mine
          ? "border-primary-foreground/30 bg-primary-foreground/10 hover:bg-primary-foreground/20"
          : "border-border bg-background/60 hover:bg-background",
        !url && "cursor-wait opacity-70"
      )}
      title={attachment.file_name}
    >
      <FileText className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">{attachment.file_name}</span>
      <span className="shrink-0 opacity-60">{formatBytes(attachment.size_bytes)}</span>
      {loading ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
      ) : error ? (
        <ImageIcon className="h-3 w-3 shrink-0 opacity-60" />
      ) : (
        <Download className="h-3 w-3 shrink-0 opacity-60" />
      )}
    </a>
  );
}
