import { useEffect, useMemo, useState } from "react";
import { getLocale } from "@/lib/locale";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { DeleteAccountSection } from "@/components/DeleteAccountSection";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { THEME_KEYS, type RewardTheme } from "@/lib/rewardThemes";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Plus, Crown, BarChart3, Trophy, HandHeart,
  CalendarClock, ShieldAlert, ChevronRight, Sparkles, Inbox,
} from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { AvailabilityManager } from "@/components/AvailabilityManager";
import { BookOpen, Settings, Calendar, CheckCircle2, Star, Users, Video, Pencil, Mail } from "lucide-react";
import { SUBJECT_OPTIONS } from "@/lib/subjects";
import { AutoCompleteLessonsCard } from "@/components/AutoCompleteLessonsCard";
import { ProRulesCard } from "@/components/ProRulesCard";
import { GoogleCalendarCard } from "@/components/GoogleCalendarCard";
import { PushNotificationToggle } from "@/components/PushNotificationToggle";
import { SubjectComboBox } from "@/components/SubjectComboBox";
import { AvatarUploader } from "@/components/AvatarUploader";
import { ContactEditDialog, type ContactFields } from "@/components/ContactEditDialog";

type SectionItem = { to: string; label: string; icon: typeof Crown; desc?: string };
type SectionGroup = { title: string; items: SectionItem[] };

function PushSettingsCard() {
  const { t } = useTranslation();
  return (
    <div className="mb-4 rounded-[16px] border-[0.5px] bg-white p-4" style={{ borderColor: "var(--border,#eceef3)" }}>
      <p style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 15, color: "#0f0f1a" }}>
        {t("pushNotif.cardTitle")}
      </p>
      <p className="mt-0.5 mb-3 text-[13px]" style={{ color: "#9398b0" }}>
        {t("pushNotif.cardDesc")}
      </p>
      <PushNotificationToggle />
    </div>
  );
}

function MoreSection({ title, groups }: { title: string; groups: SectionGroup[] }) {
  const nonEmpty = groups.filter((g) => g.items.length > 0);
  if (nonEmpty.length === 0) return null;
  return (
    <Card className="mt-6 rounded-[18px] border-[#eceef3] shadow-none">
      <CardHeader>
        <CardTitle style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 17, letterSpacing: "-.01em" }}>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {nonEmpty.map((group) => (
          <div key={group.title}>
            <p className="mb-2 text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
              {group.title}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {group.items.map((it) => (
                <Link
                  key={it.to}
                  to={it.to}
                  className="group flex items-center gap-3 rounded-[16px] border border-[#eceef3] bg-white p-3 transition-colors hover:bg-[#f0fdf9]"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-[16px] bg-primary/10 text-primary">
                    <it.icon className="h-5 w-5" />
                  </span>
                  <span className="flex-1 text-sm font-medium text-foreground">{it.label}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function ProfilePage() {
  const { t } = useTranslation();
  const { user, roles } = useAuth();
  const isTutor = roles.includes("tutor");
  const isManager = roles.includes("manager");
  const { isIndependent, settings, updateSettings, refresh: refreshSettings } = useWorkspaceSettings();

  const tutorGroups: SectionGroup[] = isTutor
    ? [
        {
          title: t("profile.groupScheduleAvail"),
          items: [
            { to: "/availability", label: t("profile.itemAvailability"), icon: CalendarClock },
            { to: "/onboarding", label: t("nav.setupGuide"), icon: Sparkles },
          ],
        },
        {
          title: t("profile.groupAccount"),
          items: [
            { to: "/subscription", label: t("profile.itemSubscription"), icon: Crown },
            { to: "/achievements", label: t("profile.itemAchievements"), icon: Trophy },
            { to: "/my-referrals", label: t("profile.itemReferrals"), icon: HandHeart },
          ].filter((it) => {
            if (!isIndependent && ["/subscription", "/achievements", "/my-referrals"].includes(it.to)) return false;
            return true;
          }),
        },
      ]
    : [];

  const managerGroups: SectionGroup[] = isManager
    ? [
        {
          title: t("profile.groupStudentsRequests"),
          items: [
            { to: "/feedback-inbox", label: t("profile.itemFeedback") ?? "Звернення", icon: Inbox },
            { to: "/referrals", label: t("profile.itemTutorRequests"), icon: HandHeart },
            { to: "/subscription-requests", label: t("profile.itemSubRequests"), icon: Crown },
          ],
        },
        {
          title: t("profile.groupScheduleAvail"),
          items: [
            { to: "/availability", label: t("profile.itemAvailability"), icon: CalendarClock },
          ],
        },
        {
          title: t("profile.groupAnalytics"),
          items: [
            { to: "/marketing", label: t("profile.emailMarketing") ?? "Email-розсилки", icon: HandHeart },
            { to: "/paywall-metrics", label: t("profile.itemPaywallMetrics"), icon: BarChart3 },
            { to: "/audit", label: t("profile.itemAudit"), icon: ShieldAlert },
          ],
        },
      ]
    : [];

  const [loading, setLoading] = useState(true);

  // Scroll to anchor if hash is present (for onboarding deep-links)
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) {
      setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
    }
  }, []);
  const [saving, setSaving] = useState(false);
  const [activeSheet, setActiveSheet] = useState<"rules"|"automark"|"subjects"|"calendar"|"availability"|"editProfile"|null>(null);
  const [profileName, setProfileName] = useState<{first: string; last: string}>({ first: "", last: "" });
  const [editFirst, setEditFirst] = useState("");
  const [editLast, setEditLast] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [contacts, setContacts] = useState<ContactFields>({ email: "", phone: "", telegram: "", messenger_url: "", facebook_url: "", instagram_url: "" });
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [reviews, setReviews] = useState<Array<{ rating: number; comment: string | null; created_at: string }>>([]);
  const [studentCount, setStudentCount] = useState(0);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [newSubject, setNewSubject] = useState("");

  useEffect(() => {
    // Менеджеру теж потрібні імʼя+аватар для ДС-картки ідентичності (легкий запит).
    if (user && isManager && !isTutor) {
      (async () => {
        const { data } = await supabase
          .from("profiles")
          .select("first_name, last_name, avatar_url")
          .eq("id", user.id)
          .maybeSingle();
        if (data) {
          setProfileName({ first: data.first_name ?? "", last: data.last_name ?? "" });
          setAvatarUrl((data as { avatar_url?: string | null }).avatar_url ?? null);
        }
      })();
    }
    if (!user || !isTutor) {
      setLoading(false);
      return;
    }
    (async () => {
      const [detailsRes, lessonsRes, ratesRes, profileRes, contactsRes, feedbackRes] = await Promise.all([
        supabase.from("tutor_details").select("subjects").eq("user_id", user.id).maybeSingle(),
        supabase.from("lessons").select("subject").eq("tutor_id", user.id),
        supabase.from("student_rates").select("subject").eq("tutor_id", user.id),
        supabase.from("profiles").select("first_name, last_name, avatar_url").eq("id", user.id).maybeSingle(),
        supabase.from("profile_contacts").select("email, phone, telegram, messenger_url, facebook_url, instagram_url").eq("user_id", user.id).maybeSingle(),
        supabase.from("lesson_feedback").select("rating, comment, created_at, student_id").eq("tutor_id", user.id).order("created_at", { ascending: false }).limit(20),
      ]);

      setProfileName({
        first: profileRes.data?.first_name ?? "",
        last: profileRes.data?.last_name ?? "",
      });
      setAvatarUrl((profileRes.data as { avatar_url?: string | null } | null)?.avatar_url ?? null);
      setContacts({
        email: contactsRes.data?.email ?? user.email ?? "",
        phone: contactsRes.data?.phone ?? "",
        telegram: contactsRes.data?.telegram ?? "",
        messenger_url: contactsRes.data?.messenger_url ?? "",
        facebook_url: contactsRes.data?.facebook_url ?? "",
        instagram_url: contactsRes.data?.instagram_url ?? "",
      });
      const fb = (feedbackRes.data ?? []) as Array<{ rating: number; comment: string | null; created_at: string }>;
      setReviews(fb);

      const stored = (detailsRes.data?.subjects as string[] | null) ?? [];
      const fromLessons = (lessonsRes.data ?? [])
        .map((l) => (l.subject ?? "").trim())
        .filter(Boolean);
      const fromRates = (ratesRes.data ?? [])
        .map((r) => (r.subject ?? "").trim())
        .filter(Boolean);

      const merged: string[] = [];
      const seen = new Set<string>();
      for (const item of [...stored, ...fromLessons, ...fromRates]) {
        const key = item.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(item);
        }
      }

      setSubjects(merged);

      if (merged.length > stored.length) {
        await supabase
          .from("tutor_details")
          .upsert({ user_id: user.id, subjects: merged }, { onConflict: "user_id" });
      }

      setLoading(false);
    })();
  }, [user?.id, isTutor]);

  const customSubjects = useMemo(
    () => subjects.filter((s) => !(SUBJECT_OPTIONS as readonly string[]).includes(s)),
    [subjects]
  );

  const toggleSubject = (subject: string) => {
    setSubjects((prev) =>
      prev.includes(subject) ? prev.filter((s) => s !== subject) : [...prev, subject]
    );
  };

  const addCustomSubject = () => {
    const trimmed = newSubject.trim();
    if (!trimmed) return;
    if (trimmed.length > 60) {
      toast.error(t("profile.subjectNameTooLong"));
      return;
    }
    const exists = subjects.some((s) => s.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      toast.info(t("profile.subjectAlreadyExists"));
      setNewSubject("");
      return;
    }
    setSubjects((prev) => [...prev, trimmed]);
    setNewSubject("");
  };

  const removeCustomSubject = (subject: string) => {
    setSubjects((prev) => prev.filter((s) => s !== subject));
  };

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("tutor_details")
      .upsert({ user_id: user.id, subjects }, { onConflict: "user_id" });
    setSaving(false);
    if (error) {
      console.error(error);
      toast.error(t("profile.subjectsSaveFailed"));
      return;
    }
    toast.success(t("profile.subjectsSaved"));
  };

  const openEditProfile = () => {
    setEditFirst(profileName.first);
    setEditLast(profileName.last);
    setActiveSheet("editProfile");
  };

  const saveProfile = async () => {
    if (!user) return;
    const first = editFirst.trim();
    const last = editLast.trim();
    if (!first && !last) {
      toast.error(t("profile.editNameRequired") || "Введіть ім'я");
      return;
    }
    setSavingProfile(true);
    const { error } = await supabase
      .from("profiles")
      .update({ first_name: first, last_name: last })
      .eq("id", user.id);
    setSavingProfile(false);
    if (error) {
      console.error(error);
      toast.error(t("profile.editSaveFailed") || "Не вдалося зберегти");
      return;
    }
    setProfileName({ first, last });
    setActiveSheet(null);
    toast.success(t("profile.editSaved") || "Профіль оновлено");
  };

  // ── Design tokens ───────────────────────────────────────────────────────────
  const P = {
    teal: "#2BBFAA", tealD: "#25a896", tealL: "#f0fdf9",
    border: "#eceef3", bg: "#F5F4F0", surface: "#fff",
    txt: "#0f0f1a", sub: "#9398b0", muted: "#b0b4c8",
    display: "Inter, system-ui, sans-serif",
    body: "'Plus Jakarta Sans', system-ui, sans-serif",
  };

  // ── Computed values ──────────────────────────────────────────────────────────
  const displayName = (profileName.first || profileName.last)
    ? [profileName.first, profileName.last].filter(Boolean).join(" ")
    : user?.email?.split("@")[0] ?? t("profile.defaultTutorName");
  const initials = ((displayName.split(" ")[0]?.[0] ?? "") + (displayName.split(" ")[1]?.[0] ?? "")).toUpperCase() || "?";

  const payRuleVal = (settings as any)?.payment_due_mode === "prepaid" ? t("profile.valPrepaid")
    : (settings as any)?.payment_due_mode === "after_lesson" ? t("profile.valAfterLesson")
    : t("profile.valBeforeLesson");

  const autoMarkVal = (settings as any)?.auto_complete_lessons ? t("profile.valAuto") : t("profile.valManual");

  const subjectsVal = subjects.length === 0 ? "—"
    : subjects.length === 1 ? subjects[0]
    : `${subjects[0]} +${subjects.length - 1}`;

  const calVal = calendarConnected ? t("profile.valCalConnected") : t("profile.valCalNone");

  // ── Nav-row helper ───────────────────────────────────────────────────────────
  type NavRowProps = {
    icon: React.ReactNode;
    label: string;
    val?: string;
    valColor?: string;
    onClick: () => void;
    noBorder?: boolean;
  };
  const NavRow = ({ icon, label, val, valColor, onClick, noBorder }: NavRowProps) => (
    <button onClick={onClick} className="flex items-center gap-3 w-full text-left transition-colors hover:bg-gray-50/70 active:bg-gray-100"
      style={{ height: 52, padding: "0 16px", borderBottom: noBorder ? "none" : `1px solid ${P.border}`, background: "transparent", border: "none", cursor: "pointer" }}>
      <span style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(43,191,170,.1)", color: P.tealD }}>
        {icon}
      </span>
      <span style={{ flex: 1, fontFamily: P.body, fontWeight: 600, fontSize: 15.5, color: P.txt }}>{label}</span>
      {val && (
        <span style={{ fontFamily: P.body, fontWeight: 500, fontSize: 14, color: valColor ?? P.sub,
          maxWidth: 120, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginRight: 6 }}>
          {val}
        </span>
      )}
      <ChevronRight size={16} style={{ color: P.muted, flexShrink: 0 }} />
    </button>
  );

  // ── Section card ─────────────────────────────────────────────────────────────
  const Sec = ({ title, children }: { title?: string; children: React.ReactNode }) => (
    <div className="rounded-[18px] overflow-hidden" style={{ border: `1px solid ${P.border}`, background: P.surface, boxShadow: "0 2px 10px -4px rgba(15,15,26,.06)" }}>
      {title && (
        <p style={{ padding: "12px 16px 0", fontFamily: P.display, fontSize: 13, fontWeight: 700,
          letterSpacing: "0.07em", textTransform: "uppercase" as const, color: P.muted }}>
          {title}
        </p>
      )}
      {children}
    </div>
  );

  const THEMES: Array<{ key: string; emoji: string; label: string }> = [
    { key: "fruits",  emoji: "🍎", label: t("profile.themeFruits") },
    { key: "sports",  emoji: "⚽", label: t("profile.themeSports")  },
    { key: "animals", emoji: "🐶", label: t("profile.themeAnimals") },
    { key: "stars",   emoji: "⭐", label: t("profile.themeStars")   },
  ];

  // ── MANAGER profile (DS: identity card + sections) ───────────────────────────
  if (!isTutor) {
    const mgrName = (profileName.first || profileName.last)
      ? [profileName.first, profileName.last].filter(Boolean).join(" ")
      : user?.email?.split("@")[0] ?? t("profile.defaultManagerName");
    const mgrInitials = ((mgrName.split(" ")[0]?.[0] ?? "") + (mgrName.split(" ")[1]?.[0] ?? "")).toUpperCase() || "?";
    return (
      <AppLayout>
        <div className="mx-auto max-w-[680px]">
          <div className="lg:grid lg:grid-cols-2 lg:gap-4 flex flex-col gap-4">

            {/* Identity card */}
            <div className="rounded-[20px] overflow-hidden lg:col-span-2" style={{ border: `1px solid ${P.border}`, background: P.surface, boxShadow: "0 2px 10px -4px rgba(15,15,26,.06)" }}>
              <div style={{ padding: "20px 18px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                  <div style={{ width: 62, height: 62, borderRadius: Math.round(62 * 0.32), flexShrink: 0,
                    background: "linear-gradient(135deg,#2BBFAA,#0EA5A0)",
                    display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
                    boxShadow: "0 6px 18px -8px rgba(43,191,170,.55)" }}>
                    {avatarUrl ? (
                      <img src={avatarUrl} alt={mgrName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <span style={{ fontFamily: P.display, fontWeight: 800, fontSize: 22, color: "#fff" }}>{mgrInitials}</span>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: P.display, fontWeight: 800, fontSize: 19, color: P.txt, lineHeight: 1.2 }}>{mgrName}</p>
                    <p style={{ fontFamily: P.body, fontSize: 14, color: P.sub, marginTop: 3 }}>{t("profile.managerSub")}</p>
                  </div>
                  <button onClick={openEditProfile} aria-label={t("profile.editTitle") || "Редагувати профіль"}
                    className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100"
                    style={{ border: `1px solid ${P.border}`, background: P.bg, flexShrink: 0 }}>
                    <Pencil size={14} style={{ color: P.sub }} />
                  </button>
                </div>
              </div>
            </div>

            {/* Integrations: calendar + push */}
            <div className="lg:col-span-2 flex flex-col gap-4">
              <GoogleCalendarCard />
              <PushSettingsCard />
            </div>

            {/* Manager sections — every existing item preserved, now in DS cards */}
            {managerGroups.map((group) => (
              group.items.length > 0 && (
                <Sec key={group.title} title={group.title}>
                  {group.items.map((item, i) => (
                    <NavRow
                      key={item.to}
                      icon={<item.icon size={18} />}
                      label={item.label}
                      onClick={() => { window.location.href = item.to; }}
                      noBorder={i === group.items.length - 1}
                    />
                  ))}
                </Sec>
              )
            ))}

            {managerGroups.every((g) => g.items.length === 0) && (
              <div className="rounded-[18px] border border-dashed lg:col-span-2" style={{ borderColor: P.border }}>
                <p className="py-8 text-center text-sm" style={{ color: P.sub }}>{t("profile.noExtraSettings")}</p>
              </div>
            )}
          </div>
        </div>

        {/* Edit-profile sheet (same as tutor branch) */}
        <Sheet open={activeSheet === "editProfile"} onOpenChange={(o) => !o && setActiveSheet(null)}>
          <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-[22px] p-0">
            <div className="flex justify-center pt-2.5 pb-1">
              <div className="w-10 h-1.5 rounded-full" style={{ background: "rgba(15,15,26,.14)" }} />
            </div>
            <div className="px-5 py-4">
              <p style={{ fontFamily: "Inter, system-ui", fontWeight: 800, fontSize: 18, color: "#0f0f1a", marginBottom: 4 }}>
                {t("profile.editTitle") || "Редагувати профіль"}
              </p>
              <div style={{ display: "flex", justifyContent: "center", margin: "12px 0 18px" }}>
                <AvatarUploader
                  userId={user?.id ?? ""}
                  currentUrl={avatarUrl}
                  firstName={profileName.first}
                  lastName={profileName.last}
                  onChanged={(url) => setAvatarUrl(url)}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontFamily: "Inter, system-ui", fontWeight: 600, fontSize: 13, color: "#0f0f1a", marginBottom: 6 }}>
                  {t("profile.editFirstName") || "Ім'я"}
                </label>
                <Input value={editFirst} onChange={(e) => setEditFirst(e.target.value)} placeholder={t("profile.editFirstName") || "Ім'я"} className="h-12 rounded-[12px]" />
              </div>
              <div style={{ marginBottom: 4 }}>
                <label style={{ display: "block", fontFamily: "Inter, system-ui", fontWeight: 600, fontSize: 13, color: "#0f0f1a", marginBottom: 6 }}>
                  {t("profile.editLastName") || "Прізвище"}
                </label>
                <Input value={editLast} onChange={(e) => setEditLast(e.target.value)} placeholder={t("profile.editLastName") || "Прізвище"} className="h-12 rounded-[12px]" />
              </div>
              <button onClick={saveProfile} disabled={savingProfile}
                style={{ marginTop: 16, width: "100%", height: 52, borderRadius: 14,
                  background: "linear-gradient(135deg,#2BBFAA,#25a896)", border: "none",
                  color: "#fff", fontFamily: "Inter, system-ui", fontWeight: 700,
                  fontSize: 16, cursor: savingProfile ? "default" : "pointer", opacity: savingProfile ? 0.7 : 1,
                  boxShadow: "0 8px 20px -8px rgba(43,191,170,.6)" }}>
                {savingProfile ? "…" : (t("profile.editSave") || "Зберегти")}
              </button>
            </div>
          </SheetContent>
        </Sheet>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-[680px]">

        {/* ── Desktop grid layout ─────────────────────────────────────────── */}
        <div className="lg:grid lg:grid-cols-2 lg:gap-4 flex flex-col gap-4">

          {/* ── Identity card ─────────────────────────────────────────────── */}
          <div className="rounded-[20px] overflow-hidden" style={{ border: `1px solid ${P.border}`, background: P.surface, boxShadow: "0 2px 10px -4px rgba(15,15,26,.06)" }}>
            <div style={{ padding: "20px 18px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                {/* Avatar */}
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <div style={{ width: 62, height: 62, borderRadius: Math.round(62 * 0.32),
                    background: "linear-gradient(135deg,#2BBFAA,#0EA5A0)",
                    display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
                    boxShadow: "0 6px 18px -8px rgba(43,191,170,.55)" }}>
                    {avatarUrl ? (
                      <img src={avatarUrl} alt={displayName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <span style={{ fontFamily: P.display, fontWeight: 800, fontSize: 22, color: "#fff" }}>{initials}</span>
                    )}
                  </div>
                </div>
                {/* Name + role */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontFamily: P.display, fontWeight: 800, fontSize: 19, color: P.txt, lineHeight: 1.2 }}>
                    {displayName}
                  </p>
                  <p style={{ fontFamily: P.body, fontSize: 14, color: P.sub, marginTop: 3 }}>
                    {t("profile.independentTutorSub")}
                  </p>
                </div>
                {/* Edit button */}
                <button
                  onClick={openEditProfile}
                  aria-label={t("profile.editTitle") || "Редагувати профіль"}
                  className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100"
                  style={{ border: `1px solid ${P.border}`, background: P.bg, flexShrink: 0 }}>
                  <Pencil size={14} style={{ color: P.sub }} />
                </button>
              </div>
              {/* Stats */}
              <div style={{ display: "flex", gap: 16, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${P.border}` }}>
                {[
                  { val: studentCount, label: t("profile.statsStudents") || "учнів" },
                  { val: subjects.length, label: t("profile.statsSubjects") || "предметів" },
                ].map(({ val, label }) => (
                  <div key={label}>
                    <span style={{ fontFamily: P.display, fontWeight: 800, fontSize: 20, color: P.txt }}>{val}</span>
                    <span style={{ fontFamily: P.body, fontSize: 13, color: P.sub, marginLeft: 5 }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Pro card ──────────────────────────────────────────────────── */}
          {isIndependent && (
            <Link to="/subscription" style={{ textDecoration: "none" }}>
              <div className="rounded-[20px] cursor-pointer hover:opacity-90 transition-opacity"
                style={{ background: "linear-gradient(135deg,#0f0f1a,#1a1a2e)", boxShadow: "0 2px 10px -4px rgba(15,15,26,.25)", padding: "20px 18px", height: "100%" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  {/* Crown icon with glow */}
                  <div style={{ width: 48, height: 48, borderRadius: 15, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    background: "radial-gradient(circle, rgba(245,181,68,.3) 0%, transparent 70%)", position: "relative" }}>
                    <Crown size={26} style={{ color: "#F5B544" }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: P.display, fontWeight: 800, fontSize: 17, color: "#fff" }}>
                      {t("profile.subscriptionTitle")}
                    </p>
                    <p style={{ fontFamily: P.body, fontSize: 13.5, color: "rgba(255,255,255,0.55)", marginTop: 3 }}>
                      {settings?.trial_until ? t("profile.trialUntil", { date: new Date(settings.trial_until).toLocaleDateString(getLocale(), { day: "numeric", month: "short", year: "numeric" }) }) : t("profile.subscriptionActive")}
                    </p>
                  </div>
                  <ChevronRight size={18} style={{ color: "rgba(255,255,255,0.35)", flexShrink: 0 }} />
                </div>
              </div>
            </Link>
          )}

          {/* ── Account section ────────────────────────────────────────────── */}
          <Sec>
            <NavRow icon={<Trophy size={18} />} label={t("profile.itemAchievements") || "Досягнення"}
              onClick={() => { window.location.href = "/achievements"; }} />
            <NavRow icon={<HandHeart size={18} />} label={t("profile.itemReferrals") || "Реферали"}
              val={t("profile.referralBonusVal")} onClick={() => { window.location.href = "/my-referrals"; }} noBorder />
          </Sec>

          {/* ── Reward theme ───────────────────────────────────────────────── */}
          <Sec title={t("profile.sectionRewards") || "СТИЛЬ НАГОРОД"}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, padding: "12px 12px 14px" }}>
              {THEMES.map(({ key, emoji, label }) => {
                const active = (settings?.reward_theme as string ?? "fruits") === key;
                return (
                  <button key={key}
                    onClick={() => updateSettings({ reward_theme: key as RewardTheme })}
                    style={{ height: 50, borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
                      border: active ? `1.5px solid ${P.teal}` : `1px solid ${P.border}`,
                      background: active ? P.tealL : P.bg, cursor: "pointer",
                      fontFamily: P.display, fontSize: 13, fontWeight: 700,
                      color: active ? P.tealD : P.muted }}>
                    <span style={{ fontSize: 20 }}>{emoji}</span>
                    {label}
                  </button>
                );
              })}
            </div>
          </Sec>

        </div>

        {/* ── Settings section (full-width) ──────────────────────────────────── */}
        <div className="mt-4">
          <Sec title={t("profile.sectionSettings") || "НАЛАШТУВАННЯ"}>
            <NavRow icon={<ShieldAlert size={18} />} label={t("profile.rowPayRules") || "Правила оплати"}
              val={payRuleVal} onClick={() => setActiveSheet("rules")} />
            <NavRow icon={<CheckCircle2 size={18} />} label={t("profile.rowAutoMark") || "Відмітка уроків"}
              val={autoMarkVal} onClick={() => setActiveSheet("automark")} />
            <NavRow icon={<BookOpen size={18} />} label={t("profile.rowSubjects") || "Предмети"}
              val={subjectsVal} onClick={() => setActiveSheet("subjects")} />
            <NavRow icon={<Calendar size={18} />} label={t("profile.rowCalendar") || "Google Calendar"}
              val={calVal} valColor={calendarConnected ? P.tealD : undefined}
              onClick={() => setActiveSheet("calendar")} />
            <NavRow icon={<CalendarClock size={18} />} label={t("profile.rowAvailability") || "Доступність"}
              onClick={() => setActiveSheet("availability")} noBorder />
          </Sec>
        </div>

        {/* ── Guide row ──────────────────────────────────────────────────────── */}
        <div className="mt-4">
          <Sec>
            <NavRow icon={<Sparkles size={18} />} label={t("profile.rowGuide") || "Гайд по налаштуванню"}
              onClick={() => { window.location.href = "/onboarding"; }} noBorder />
          </Sec>
        </div>

        {/* ── Sheets for settings components ─────────────────────────────────── */}
        <Sheet open={activeSheet === "rules"} onOpenChange={o => { if (!o) { setActiveSheet(null); refreshSettings(); } }}>
          <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-[22px] p-0">
            <div className="flex justify-center pt-2.5 pb-1">
              <div className="w-10 h-1.5 rounded-full" style={{ background: "rgba(15,15,26,.14)" }} />
            </div>
            <div id="rules"><ProRulesCard /></div>
          </SheetContent>
        </Sheet>

        <Sheet open={activeSheet === "automark"} onOpenChange={o => !o && setActiveSheet(null)}>
          <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-[22px] p-0">
            <div className="flex justify-center pt-2.5 pb-1">
              <div className="w-10 h-1.5 rounded-full" style={{ background: "rgba(15,15,26,.14)" }} />
            </div>
            <div id="automark"><AutoCompleteLessonsCard /></div>
          </SheetContent>
        </Sheet>

        <Sheet open={activeSheet === "editProfile"} onOpenChange={o => !o && setActiveSheet(null)}>
          <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-[22px] p-0">
            <div className="flex justify-center pt-2.5 pb-1">
              <div className="w-10 h-1.5 rounded-full" style={{ background: "rgba(15,15,26,.14)" }} />
            </div>
            <div className="px-5 py-4">
              <p style={{ fontFamily: "Inter, system-ui", fontWeight: 800, fontSize: 18, color: "#0f0f1a", marginBottom: 4 }}>
                {t("profile.editTitle") || "Редагувати профіль"}
              </p>
              <p style={{ fontFamily: "'Plus Jakarta Sans', system-ui", fontSize: 13.5, color: "#9398b0", marginBottom: 16 }}>
                {t("profile.editSubtitle") || "Онови своє ім'я — учні бачать його в чаті та розкладі."}
              </p>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
                <AvatarUploader
                  userId={user?.id ?? ""}
                  currentUrl={avatarUrl}
                  firstName={profileName.first}
                  lastName={profileName.last}
                  onChanged={(url) => setAvatarUrl(url)}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontFamily: "Inter, system-ui", fontWeight: 600, fontSize: 13, color: "#0f0f1a", marginBottom: 6 }}>
                  {t("profile.editFirstName") || "Ім'я"}
                </label>
                <Input
                  value={editFirst}
                  onChange={(e) => setEditFirst(e.target.value)}
                  placeholder={t("profile.editFirstName") || "Ім'я"}
                  className="h-12 rounded-[12px]"
                />
              </div>
              <div style={{ marginBottom: 4 }}>
                <label style={{ display: "block", fontFamily: "Inter, system-ui", fontWeight: 600, fontSize: 13, color: "#0f0f1a", marginBottom: 6 }}>
                  {t("profile.editLastName") || "Прізвище"}
                </label>
                <Input
                  value={editLast}
                  onChange={(e) => setEditLast(e.target.value)}
                  placeholder={t("profile.editLastName") || "Прізвище"}
                  className="h-12 rounded-[12px]"
                />
              </div>
              <button
                onClick={saveProfile}
                disabled={savingProfile}
                style={{ marginTop: 16, width: "100%", height: 52, borderRadius: 14,
                  background: "linear-gradient(135deg,#2BBFAA,#25a896)", border: "none",
                  color: "#fff", fontFamily: "Inter, system-ui", fontWeight: 700,
                  fontSize: 16, cursor: savingProfile ? "default" : "pointer", opacity: savingProfile ? 0.7 : 1,
                  boxShadow: "0 8px 20px -8px rgba(43,191,170,.6)" }}>
                {savingProfile ? "…" : (t("profile.editSave") || "Зберегти")}
              </button>

              {/* Contact details */}
              <button
                onClick={() => setContactDialogOpen(true)}
                className="hover:bg-gray-50"
                style={{ marginTop: 12, width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 8, padding: "13px 14px", borderRadius: 14, border: "1px solid #eceef3",
                  background: "#fff", cursor: "pointer" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Mail size={18} style={{ color: "#9398b0" }} />
                  <span style={{ textAlign: "left" }}>
                    <span style={{ display: "block", fontFamily: "Inter, system-ui", fontWeight: 600, fontSize: 14, color: "#0f0f1a" }}>
                      {t("profile.editContacts") || "Контактні дані"}
                    </span>
                    <span style={{ display: "block", fontFamily: "'Plus Jakarta Sans', system-ui", fontSize: 13, color: "#9398b0" }}>
                      {[contacts.email, contacts.phone].filter(Boolean).join(" · ") || (t("profile.editContactsHint") || "Email, телефон, Telegram, соцмережі")}
                    </span>
                  </span>
                </span>
                <ChevronRight size={18} style={{ color: "#d0d3e0" }} />
              </button>

              {/* Student reviews */}
              <div style={{ marginTop: 18 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={{ fontFamily: "Inter, system-ui", fontWeight: 800, fontSize: 15, color: "#0f0f1a" }}>
                    {t("profile.reviewsTitle") || "Відгуки учнів"}
                  </span>
                  {reviews.length > 0 && (
                    <span style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "Inter, system-ui", fontWeight: 700, fontSize: 14, color: "#0f0f1a" }}>
                      <Star size={15} style={{ color: "#F5B400", fill: "#F5B400" }} />
                      {(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)}
                      <span style={{ color: "#9398b0", fontWeight: 600 }}>({reviews.length})</span>
                    </span>
                  )}
                </div>
                {reviews.length === 0 ? (
                  <p style={{ fontFamily: "'Plus Jakarta Sans', system-ui", fontSize: 13.5, color: "#9398b0", padding: "10px 0" }}>
                    {t("profile.reviewsEmpty") || "Поки що немає відгуків. Вони з'являться, коли учні оцінять твої уроки 🌟"}
                  </p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {reviews.filter(r => r.comment).slice(0, 5).map((r, i) => (
                      <div key={i} style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid #eceef3", background: "#fafafa" }}>
                        <div style={{ display: "flex", gap: 2, marginBottom: 4 }}>
                          {Array.from({ length: 5 }).map((_, s) => (
                            <Star key={s} size={12} style={{ color: s < r.rating ? "#F5B400" : "#e5e7eb", fill: s < r.rating ? "#F5B400" : "#e5e7eb" }} />
                          ))}
                        </div>
                        <p style={{ fontFamily: "'Plus Jakarta Sans', system-ui", fontSize: 13.5, color: "#0f0f1a", lineHeight: 1.5 }}>
                          {r.comment}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </SheetContent>
        </Sheet>

        <Sheet open={activeSheet === "subjects"} onOpenChange={o => !o && setActiveSheet(null)}>
          <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-[22px] p-0">
            <div className="flex justify-center pt-2.5 pb-1">
              <div className="w-10 h-1.5 rounded-full" style={{ background: "rgba(15,15,26,.14)" }} />
            </div>
            <div className="px-5 py-4">
              <p style={{ fontFamily: "Inter, system-ui", fontWeight: 800, fontSize: 18, color: "#0f0f1a", marginBottom: 16 }}>
                {t("profile.subjectsSheetTitle")}
              </p>
              {/* Subject chips — existing subjects */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                {subjects.map(s => (
                  <span key={s} style={{ display: "flex", alignItems: "center", gap: 5,
                    padding: "5px 12px", borderRadius: 999, fontSize: 14, fontWeight: 600,
                    background: "rgba(43,191,170,.1)", color: "#25a896",
                    border: "1px solid rgba(43,191,170,.3)" }}>
                    {s}
                    <button onClick={() => setSubjects(prev => prev.filter(x => x !== s))}
                      style={{ background: "none", border: "none", cursor: "pointer",
                        color: "#25a896", padding: 0, lineHeight: 1, fontSize: 16 }}>×</button>
                  </span>
                ))}
              </div>
              {/* Add from predefined list */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                {[
                  t("profile.subjectEnglish"),
                  t("profile.subjectMath"),
                  t("profile.subjectUkrainian"),
                  t("profile.subjectPhysics"),
                  t("profile.subjectChemistry"),
                  t("profile.subjectGerman"),
                  t("profile.subjectBiology"),
                  t("profile.subjectInformatics"),
                  t("profile.subjectHistory"),
                  t("profile.subjectPolish"),
                ]
                  .filter(s => !subjects.includes(s))
                  .map(s => (
                    <button key={s} onClick={() => setSubjects(prev => [...prev, s])}
                      style={{ padding: "5px 12px", borderRadius: 999, fontSize: 14, fontWeight: 600,
                        background: "transparent", border: "1px solid #eceef3", cursor: "pointer",
                        color: "#9398b0" }}>
                      + {s}
                    </button>
                  ))}
              </div>
              {/* Add custom subject */}
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  placeholder={t("profile.customSubjectPlaceholder")}
                  style={{ flex: 1, height: 42, borderRadius: 11, padding: "0 12px",
                    fontSize: 14.5, border: "1.5px solid #eceef3", outline: "none",
                    fontFamily: "'Plus Jakarta Sans', system-ui" }}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      const v = (e.target as HTMLInputElement).value.trim();
                      if (v && !subjects.includes(v)) {
                        setSubjects(prev => [...prev, v]);
                        (e.target as HTMLInputElement).value = "";
                      }
                    }
                  }}
                />
              </div>
              {/* Save button */}
              <button
                onClick={async () => {
                  if (!user) return;
                  await supabase.from("tutor_details")
                    .upsert({ user_id: user.id, subjects }, { onConflict: "user_id" });
                  setActiveSheet(null);
                  toast.success(t("profile.subjectsSavedToast"));
                }}
                style={{ marginTop: 16, width: "100%", height: 48, borderRadius: 13,
                  background: "linear-gradient(135deg,#2BBFAA,#25a896)", border: "none",
                  color: "#fff", fontFamily: "Inter, system-ui", fontWeight: 700,
                  fontSize: 16, cursor: "pointer" }}>
                {t("profile.subjectsSaveBtn")}
              </button>
            </div>
          </SheetContent>
        </Sheet>

        <Sheet open={activeSheet === "calendar"} onOpenChange={o => !o && setActiveSheet(null)}>
          <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-[22px] p-0">
            <div className="flex justify-center pt-2.5 pb-1">
              <div className="w-10 h-1.5 rounded-full" style={{ background: "rgba(15,15,26,.14)" }} />
            </div>
            <div id="calendar"><GoogleCalendarCard /></div>
            <PushSettingsCard />
          </SheetContent>
        </Sheet>

        {/* Availability sheet — slides up, X to close */}
        <Sheet open={activeSheet === "availability"} onOpenChange={o => !o && setActiveSheet(null)}>
          <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-[22px] p-0">
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b"
              style={{ borderColor: "var(--border,#eceef3)" }}>
              <p className="font-black text-[18px]" style={{ fontFamily: "Inter, system-ui" }}>
                {t("profile.availableHoursTitle")}
              </p>
            </div>
            <div className="px-4 py-4">
              <AvailabilityManager />
            </div>
          </SheetContent>
        </Sheet>

        <ContactEditDialog
          open={contactDialogOpen}
          onOpenChange={setContactDialogOpen}
          userId={user?.id ?? ""}
          userName={displayName}
          initial={contacts}
          onSaved={() => {
            if (!user) return;
            supabase
              .from("profile_contacts")
              .select("email, phone, telegram, messenger_url, facebook_url, instagram_url")
              .eq("user_id", user.id)
              .maybeSingle()
              .then(({ data }) => {
                if (data) setContacts({
                  email: data.email ?? "",
                  phone: data.phone ?? "",
                  telegram: data.telegram ?? "",
                  messenger_url: data.messenger_url ?? "",
                  facebook_url: data.facebook_url ?? "",
                  instagram_url: data.instagram_url ?? "",
                });
              });
          }}
        />

        <DeleteAccountSection />

      </div>
    </AppLayout>
  );
}
