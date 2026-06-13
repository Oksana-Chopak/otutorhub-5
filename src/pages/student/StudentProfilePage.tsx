import { useEffect, useState } from "react";
import { StudentLayout } from "@/components/student/StudentLayout";
import { DeleteAccountSection } from "@/components/DeleteAccountSection";
import { AvatarUploader } from "@/components/AvatarUploader";
import { StudentProgressBar } from "@/components/student/StudentProgressBar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TelegramLinkCard } from "@/components/TelegramLinkCard";
import { GoogleCalendarCard } from "@/components/GoogleCalendarCard";
import { Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

const C = {
  teal: "#2BBFAA", tealD: "#1f8e7e", ink: "#0f0f1a", sub: "#9398b0",
  border: "#eceef3", surface: "#fff", bg: "#F5F4F0",
  display: "Inter, system-ui, sans-serif", body: "'Plus Jakarta Sans', system-ui",
};

export default function StudentProfilePage() {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [completed, setCompleted] = useState(0);
  const [weekly, setWeekly] = useState(0);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: profile }, { data: contact }, { data: lessons }] = await Promise.all([
        supabase.from("profiles").select("first_name, last_name, avatar_url").eq("id", user.id).maybeSingle(),
        supabase.from("profile_contacts").select("phone").eq("user_id", user.id).maybeSingle(),
        supabase.from("lessons").select("starts_at, status").eq("student_id", user.id),
      ]);
      setFirstName(profile?.first_name ?? "");
      setLastName(profile?.last_name ?? "");
      setAvatarUrl((profile as { avatar_url?: string | null } | null)?.avatar_url ?? null);
      setPhone(contact?.phone ?? "");
      const done = (lessons ?? []).filter((l: any) => l.status === "completed");
      setCompleted(done.length);
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      setWeekly(done.filter((l: any) => new Date(l.starts_at).getTime() >= weekAgo).length);
      setLoading(false);
    })();
  }, [user?.id]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error: pErr } = await supabase
      .from("profiles")
      .update({ first_name: firstName.trim(), last_name: lastName.trim() })
      .eq("id", user.id);
    const { error: cErr } = await supabase
      .from("profile_contacts")
      .upsert({ user_id: user.id, phone: phone.trim() || null }, { onConflict: "user_id" });
    setSaving(false);
    if (pErr || cErr) {
      toast.error(t("studentPages.saveFailed"), { description: (pErr || cErr)?.message });
      return;
    }
    toast.success(t("studentPages.saveSuccess"));
  };

  const displayName = [firstName, lastName].filter(Boolean).join(" ") || user?.email?.split("@")[0] || t("studentPages.profileTitle");

  return (
    <StudentLayout>
      <div className="space-y-4">
        <h1 className="hidden lg:block" style={{ fontFamily: C.display, fontWeight: 800, fontSize: 24, letterSpacing: "-.01em", color: C.ink }}>
          {t("studentPages.profileTitle")}
        </h1>

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" style={{ color: C.sub }} /></div>
        ) : (
          <>
            {/* Identity card with avatar */}
            <div style={{ borderRadius: 20, border: `1px solid ${C.border}`, background: C.surface, boxShadow: "0 2px 10px -4px rgba(15,15,26,.06)", padding: 18 }}>
              <div className="flex items-center gap-4">
                <AvatarUploader
                  userId={user?.id ?? ""}
                  currentUrl={avatarUrl}
                  firstName={firstName}
                  lastName={lastName}
                  onChanged={(url) => setAvatarUrl(url)}
                />
                <div className="min-w-0">
                  <p style={{ fontFamily: C.display, fontWeight: 800, fontSize: 19, color: C.ink, lineHeight: 1.2 }}>{displayName}</p>
                  <p style={{ fontFamily: C.body, fontSize: 13.5, color: C.sub, marginTop: 3 }}>{user?.email}</p>
                </div>
              </div>
            </div>

            {/* Gamification — level & progress (real completed-lessons XP) */}
            <div style={{ borderRadius: 18, border: `1px solid ${C.border}`, background: C.surface, boxShadow: "0 2px 10px -4px rgba(15,15,26,.06)", padding: 16 }}>
              <StudentProgressBar completedCount={completed} weeklyCount={weekly} weeklyRecord={weekly} />
            </div>

            {/* Editable details */}
            <div style={{ borderRadius: 18, border: `1px solid ${C.border}`, background: C.surface, boxShadow: "0 2px 10px -4px rgba(15,15,26,.06)", padding: 18 }} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="fn">{t("common.name")}</Label>
                  <Input id="fn" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="h-12 rounded-[12px]" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ln">{t("studentPages.lastNameLabel")}</Label>
                  <Input id="ln" value={lastName} onChange={(e) => setLastName(e.target.value)} className="h-12 rounded-[12px]" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ph">{t("studentPages.phoneLabel")}</Label>
                <Input id="ph" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-12 rounded-[12px]" />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={user?.email ?? ""} disabled className="h-12 rounded-[12px]" />
              </div>
              <button onClick={save} disabled={saving}
                style={{ width: "100%", height: 48, borderRadius: 13, border: "none", cursor: saving ? "default" : "pointer",
                  background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#fff", fontFamily: C.display, fontWeight: 700, fontSize: 15,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 8px 20px -8px rgba(43,191,170,.6)" }}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("common.save")}
              </button>
            </div>

            <TelegramLinkCard />
            <GoogleCalendarCard />

            <button onClick={signOut}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 44, padding: "0 18px", borderRadius: 12, cursor: "pointer",
                border: `1.5px solid ${C.border}`, background: C.surface, color: C.ink, fontFamily: C.display, fontWeight: 600, fontSize: 14 }}>
              <LogOut className="h-4 w-4" />
              {t("common.logout")}
            </button>

            <DeleteAccountSection />
          </>
        )}
      </div>
    </StudentLayout>
  );
}
