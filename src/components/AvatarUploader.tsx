import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { UserAvatar } from "./UserAvatar";

interface AvatarUploaderProps {
  userId: string;
  currentUrl?: string | null;
  firstName?: string;
  lastName?: string;
  onChanged?: (newUrl: string | null) => void;
}

export function AvatarUploader({
  userId,
  currentUrl,
  firstName,
  lastName,
  onChanged,
}: AvatarUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error(t("avatarUploader.imageOnly"));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t("avatarUploader.tooLarge"));
      return;
    }
    setBusy(true);
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${userId}/avatar.${ext}`;

    // Cleanup any old avatar files for this user
    const { data: list } = await supabase.storage.from("avatars").list(userId);
    if (list && list.length > 0) {
      await supabase.storage
        .from("avatars")
        .remove(list.map((f) => `${userId}/${f.name}`));
    }

    const { error: upErr } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true, cacheControl: "3600" });
    if (upErr) {
      console.error(upErr);
      toast.error(t("avatarUploader.uploadFailed"));
      setBusy(false);
      return;
    }

    const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
    const url = `${pub.publicUrl}?t=${Date.now()}`;
    const { error: profErr } = await supabase
      .from("profiles")
      .update({ avatar_url: url })
      .eq("id", userId);
    if (profErr) {
      console.error(profErr);
      toast.error(t("avatarUploader.updateFailed"));
      setBusy(false);
      return;
    }
    toast.success(t("avatarUploader.uploaded"));
    onChanged?.(url);
    setBusy(false);
  };

  const handleRemove = async () => {
    setBusy(true);
    const { data: list } = await supabase.storage.from("avatars").list(userId);
    if (list && list.length > 0) {
      await supabase.storage
        .from("avatars")
        .remove(list.map((f) => `${userId}/${f.name}`));
    }
    await supabase.from("profiles").update({ avatar_url: null }).eq("id", userId);
    toast.success(t("avatarUploader.deleted"));
    onChanged?.(null);
    setBusy(false);
  };

  return (
    <div className="flex items-center gap-4">
      <UserAvatar
        url={currentUrl}
        firstName={firstName}
        lastName={lastName}
        className="h-16 w-16"
      />
      <div className="flex flex-col gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Завантажити фото
        </Button>
        {currentUrl && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={handleRemove}
          >
            <Trash2 className="h-4 w-4" />
            Видалити
          </Button>
        )}
      </div>
    </div>
  );
}
