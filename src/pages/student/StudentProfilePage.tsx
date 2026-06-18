import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { StudentLayout } from "@/components/student/StudentLayout";
import { DeleteAccountSection } from "@/components/DeleteAccountSection";
import { AvatarUploader } from "@/components/AvatarUploader";
import { UserAvatar } from "@/components/UserAvatar";
import { StudentProgressBar } from "@/components/student/StudentProgressBar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TelegramLinkCard } from "@/components/TelegramLinkCard";
import { GoogleCalendarCard } from "@/components/GoogleCalendarCard";
import { Loader2, LogOut, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface MyTutor {
  id: string;
  firstName: string;
  lastName: string;
  subject: string;
  avatarUrl: string | null;
}

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
  const [tutors, setTutors] = useState<MyTutor[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: profile }, { data: contact }, { data: lessons }, { data: rates }] = await Promise.all([
        supabase.from("profiles").select("first_name, last_name, avatar_url").eq("id", user.id).maybeSingle(),
        supabase.from("profile_contacts").select("phone").eq("user_id", user.id).maybeSingle(),
        supabase.from("lessons").select("starts_at, status").eq("student_id", user.id),
        supabase.from("student_rates").select("tutor_id, subject").eq("student_id", user.id).is("archived_at", null),
      ]);
      setFirstName(profile?.first_name ?? "");
      setLastName(profile?.last_name ?? "");
      setAvatarUrl((profile as { avatar_url?: string | null } | null)?.avatar_url ?? null);
      setPhone(contact?.phone ?? "");
      const done = (lessons ?? []).filter((l: any) => l.status === "completed");
      setCompleted(done.length);
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      setWeekly(done.filter((l: any) => new Date(l.starts_at).getTime() >= weekAgo).length);

      // "Мої репетитори": distinct tutors from the student↔tutor relationship
      // (student_rates), with their subjects. Names/avatars from profiles.
      const subjectsByTutor = new Map<string, Set<string>>();
      ((rates ?? []) as { tutor_id: string; subject: string | null }[]).forEach((r) => {
        if (!r.tutor_id) return;
        const set = subjectsByTutor.get(r.tutor_id) ?? new Set<string>();
        if (r.subject) set.add(r.subject);
        subjectsByTutor.set(r.tutor_id, set);
      });
      const tutorIds = Array.from(subjectsByTutor.keys());
      if (tutorIds.length) {
        const { data: tProfiles } = await supabase
          .from("profiles")
          .select("id, first_name, last_name, avatar_url")
          .in("id", tutorIds);
        const pMap: Record<string, { first_name: string | null; last_name: string | null; avatar_url: string | null }> = {};
        ((tProfiles ?? []) as any[]).forEach((p) => {
          pMap[p.id] = { first_name: p.first_name, last_name: p.last_name, avatar_url: p.avatar_url };
        });
        setTutors(
          tutorIds.map((id) => ({
            id,
            firstName: pMap[id]?.first_name ?? "",
            lastName: pMap[id]?.last_name ?? "",
            subject: Array.from(subjectsByTutor.get(id) ?? []).join(" · "),
            avatarUrl: pMap[id]?.avatar_url ?? null,
          })),
        );
      } else {
        setTutors([]);
      }
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

            {/* Мої репетитори — student's tutors with compact teal-tint chat button */}
            {tutors.length > 0 && (
              <div>
                <p style={{ fontFamily: C.display, fontWeight: 700, fontSize: 13, letterSpacing: ".09em", textTransform: "uppercase", color: C.sub, margin: "2px 2px 8px" }}>
                  {t("studentPagesExtra.myTutorsTitle")}
                </p>
                <div style={{ borderRadius: 16, border: `1px solid ${C.border}`, background: C.surface, boxShadow: "0 2px 10px -4px rgba(15,15,26,.06)", overflow: "hidden" }}>
                  {tutors.map((tt, i) => {
                    const name = [tt.firstName, tt.lastName].filter(Boolean).join(" ").trim() || t("studentPages.tutorFallback");
                    return (
                      <div key={tt.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", borderBottom: i < tutors.length - 1 ? `1px solid ${C.border}` : "none" }}>
                        <UserAvatar url={tt.avatarUrl} firstName={tt.firstName} lastName={tt.lastName} className="h-10 w-10" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontFamily: C.display, fontWeight: 700, fontSize: 14.5, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</p>
                          {tt.subject && <p style={{ fontFamily: C.body, fontSize: 13, color: C.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tt.subject}</p>}
                        </div>
                        <Link to={`/chats?with=${tt.id}`} aria-label={t("studentPages.chatWithTutorAria")}
                          style={{ width: 44, height: 44, borderRadius: 13, flexShrink: 0, background: "rgba(43,191,170,.12)", color: C.tealD, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "inset 0 0 0 1px rgba(43,191,170,.28)" }}>
                          <MessageCircle size={18} />
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Gamification — level & progress (real completed-lessons XP) */}
            <div style={{ borderRadius: 18, border: `1px solid ${C.border}`, background: C.surface, boxShadow: "0 2px 10px -4px rgba(15,15,26,.06)", padding: 16 }}>
              <StudentProgressBar completedCount={completed} weeklyCount={weekly} weeklyRecord={weekly} />
            </div>

            {/* Editable details */}
            <div style={{ borderRadius: 18, border: `1px solid ${C.border}`, background: C.surface, boxShadow: "0 2px 10px -4px rgba(15,15,26,.06)", padding: 18 }} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="fn">{t("common.name")}</Label>
                  <Input id="fn" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="h-11 rounded-[12px] text-[15px]" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ln">{t("studentPages.lastNameLabel")}</Label>
                  <Input id="ln" value={lastName} onChange={(e) => setLastName(e.target.value)} className="h-11 rounded-[12px] text-[15px]" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ph">{t("studentPages.phoneLabel")}</Label>
                <Input id="ph" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-11 rounded-[12px] text-[15px]" />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={user?.email ?? ""} disabled className="h-11 rounded-[12px] text-[15px]" />
              </div>
              <button onClick={save} disabled={saving}
                style={{ width: "100%", height: 48, borderRadius: 13, border: "none", cursor: saving ? "default" : "pointer",
                  background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", fontFamily: C.display, fontWeight: 700, fontSize: 15,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 8px 20px -8px rgba(43,191,170,.6)" }}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("common.save")}
              </button>
            </div>

            <TelegramLinkCard />
            <GoogleCalendarCard />

            <button onClick={signOut}
              style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "center", gap: 8, height: 50, borderRadius: 14, cursor: "pointer",
                border: `1.5px solid ${C.border}`, background: C.surface, color: "#e0552f", fontFamily: C.display, fontWeight: 600, fontSize: 14 }}>
              <LogOut className="h-4 w-4" />
              {t("common.logout")}
            </button>

            <DeleteAccountSection />

            <div style={{ display: "flex", justifyContent: "center", gap: 16, paddingTop: 2, fontSize: 13 }}>
              <Link to="/privacy" style={{ color: C.sub, textDecoration: "underline" }}>{t("landing.footer.privacy")}</Link>
              <Link to="/terms" style={{ color: C.sub, textDecoration: "underline" }}>{t("landing.footer.terms")}</Link>
            </div>
          </>
        )}
      </div>
    </StudentLayout>
  );
}
