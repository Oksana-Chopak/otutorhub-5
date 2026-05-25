import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
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
  Loader2, Plus, X, Crown, BarChart3, Trophy, HandHeart,
  CalendarClock, ShieldAlert, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { SUBJECT_OPTIONS } from "@/lib/subjects";
import { AutoCompleteLessonsCard } from "@/components/AutoCompleteLessonsCard";
import { ProRulesCard } from "@/components/ProRulesCard";
import { GoogleCalendarCard } from "@/components/GoogleCalendarCard";
import { SubjectComboBox } from "@/components/SubjectComboBox";

type SectionItem = { to: string; label: string; icon: typeof Crown; desc?: string };
type SectionGroup = { title: string; items: SectionItem[] };

function MoreSection({ title, groups }: { title: string; groups: SectionGroup[] }) {
  const nonEmpty = groups.filter((g) => g.items.length > 0);
  if (nonEmpty.length === 0) return null;
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {nonEmpty.map((group) => (
          <div key={group.title}>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {group.title}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {group.items.map((it) => (
                <Link
                  key={it.to}
                  to={it.to}
                  className="group flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-secondary"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
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
  const { isIndependent, settings, updateSettings } = useWorkspaceSettings();

  const tutorGroups: SectionGroup[] = isTutor
    ? [
        {
          title: t("profile.groupScheduleAvail"),
          items: [{ to: "/availability", label: t("profile.itemAvailability"), icon: CalendarClock }],
        },
        {
          title: t("profile.groupAccount"),
          items: [
            { to: "/subscription", label: t("profile.itemSubscription"), icon: Crown },
            { to: "/achievements", label: t("profile.itemAchievements"), icon: Trophy },
            { to: "/my-referrals", label: t("profile.itemReferrals"), icon: HandHeart },
            { to: "/analytics", label: t("profile.itemAnalytics"), icon: BarChart3 },
          ].filter((it) => {
            if (!isIndependent && ["/subscription", "/analytics", "/achievements", "/my-referrals"].includes(it.to)) return false;
            return true;
          }),
        },
      ]
    : [];

  const managerGroups: SectionGroup[] = isManager
    ? [
        {
          title: t("profile.groupScheduleAvail"),
          items: [{ to: "/availability", label: t("profile.itemAvailability"), icon: CalendarClock }],
        },
        {
          title: t("profile.groupStudentsRequests"),
          items: [
            { to: "/referrals", label: t("profile.itemTutorRequests"), icon: HandHeart },
            { to: "/subscription-requests", label: t("profile.itemSubRequests"), icon: Crown },
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
  const [saving, setSaving] = useState(false);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [newSubject, setNewSubject] = useState("");

  useEffect(() => {
    if (!user || !isTutor) {
      setLoading(false);
      return;
    }
    (async () => {
      const [detailsRes, lessonsRes, ratesRes] = await Promise.all([
        supabase.from("tutor_details").select("subjects").eq("user_id", user.id).maybeSingle(),
        supabase.from("lessons").select("subject").eq("tutor_id", user.id),
        supabase.from("student_rates").select("subject").eq("tutor_id", user.id),
      ]);

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

  if (!isTutor) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-2xl">
          <div className="mb-6">
            <h1 className="font-display text-2xl font-bold text-foreground">{t("profile.managerTitle")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("profile.managerSub")}
            </p>
          </div>
          <GoogleCalendarCard />
          <MoreSection title={t("profile.sectionsTitle")} groups={managerGroups} />
          {managerGroups.every((g) => g.items.length === 0) && (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                {t("profile.noExtraSettings")}
              </CardContent>
            </Card>
          )}
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-2xl">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold text-foreground">{t("profile.tutorTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("profile.tutorSub")}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("profile.subjectsCardTitle")}</CardTitle>
            <CardDescription>
              {t("profile.subjectsCardDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {SUBJECT_OPTIONS.map((subject) => {
                    const checked = subjects.includes(subject);
                    return (
                      <Label
                        key={subject}
                        className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm font-normal transition-colors hover:bg-secondary"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleSubject(subject)}
                        />
                        <span className="flex-1">{subject}</span>
                      </Label>
                    );
                  })}
                </div>

                <div className="mt-6 space-y-3 rounded-lg border border-dashed border-border p-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">{t("profile.customSubjectsTitle")}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("profile.customSubjectsDesc")}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <SubjectComboBox
                      value=""
                      onChange={(picked) => {
                        const trimmed = picked.trim();
                        if (!trimmed) return;
                        if (trimmed.length > 60) {
                          toast.error(t("profile.subjectNameTooLong"));
                          return;
                        }
                        if (subjects.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
                          toast.info(t("profile.subjectAlreadyExists"));
                          return;
                        }
                        setSubjects((prev) => [...prev, trimmed]);
                        setNewSubject("");
                      }}
                      className="flex-1"
                    />
                  </div>

                  {customSubjects.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {customSubjects.map((subject) => (
                        <Badge
                          key={subject}
                          variant="secondary"
                          className="gap-1 py-1 pl-3 pr-1 text-sm font-normal"
                        >
                          {subject}
                          <button
                            type="button"
                            onClick={() => removeCustomSubject(subject)}
                            className="ml-1 rounded-full p-0.5 transition-colors hover:bg-background"
                            aria-label={t("profile.removeAria", { name: subject })}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-6 flex justify-end">
                  <Button onClick={save} disabled={saving}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t("common.save")}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Reward theme picker */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{t("rewardThemes.pickerTitle")}</CardTitle>
            <CardDescription>{t("rewardThemes.pickerDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {THEME_KEYS.map((themeKey) => {
                const selected = (settings?.reward_theme ?? "fruits") === themeKey;
                return (
                  <button
                    key={themeKey}
                    type="button"
                    onClick={() => updateSettings({ reward_theme: themeKey })}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                      selected
                        ? "border-primary bg-primary/10 font-medium text-primary"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    {t(`rewardThemes.${themeKey}`)}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {isIndependent && (
          <div className="mt-6">
            <ProRulesCard />
          </div>
        )}
        {isIndependent && <AutoCompleteLessonsCard />}
        <GoogleCalendarCard />
        <MoreSection title={t("profile.moreTitle")} groups={tutorGroups} />
      </div>
    </AppLayout>
  );
}
