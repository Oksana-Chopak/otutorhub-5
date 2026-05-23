import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserAvatar } from "@/components/UserAvatar";
import { EmptyState } from "@/components/EmptyState";
import { StudentsSkeleton } from "@/components/PageSkeletons";
import { studentToasts } from "@/lib/toasts";
import { InviteLinkDialog } from "@/components/InviteLinkDialog";
import {
  UserPlus,
  Loader2,
  Phone,
  Mail,
  Send,
  Facebook,
  Instagram,
  Pencil,
  Archive,
  ArchiveRestore,
  Hourglass,
  Banknote,
  Video,
  Wallet,
  MessageSquare,
  CalendarPlus,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { SubjectComboBox } from "@/components/SubjectComboBox";
import { CurrencyComboBox } from "@/components/CurrencyComboBox";
import { toast } from "sonner";
import { RatePropagationDialog } from "@/components/RatePropagationDialog";
import { WalletDialog } from "@/components/WalletDialog";
import { ChatThreadDialog } from "@/components/ChatThreadDialog";
import { safeHref, sanitizeHttpUrl } from "@/lib/safeUrl";
import { QuickLessonDialog } from "@/components/QuickLessonDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CURRENCY_OPTIONS, formatPrice, currencySymbol } from "@/lib/currency";

interface MyStudent {
  id: string;
  first_name: string;
  last_name: string;
  is_pending: boolean;
  avatar_url: string | null;
  phone: string | null;
  email: string | null;
  telegram: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  rate_id: string | null;
  price: number;
  subject: string;
  default_meeting_url: string | null;
  archived_at: string | null;
  currency: string;
  payment_details: string | null;
  // Activity / payment status
  unpaid_count: number;
  unpaid_total: number;
  last_lesson_at: string | null;
}

import { computeStudentStatus, studentStatusDotClass } from "@/lib/studentStatus";

interface FormData {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  telegram: string;
  facebook_url: string;
  instagram_url: string;
  subject: string;
  price: string;
  default_meeting_url: string;
  currency: string;
  payment_details: string;
}

const emptyForm: FormData = {
  first_name: "",
  last_name: "",
  phone: "",
  email: "",
  telegram: "",
  facebook_url: "",
  instagram_url: "",
  subject: "",
  price: "",
  default_meeting_url: "",
  currency: "UAH",
  payment_details: "",
};

export default function MyStudentsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, roles } = useAuth();
  const isTutor = roles.includes("tutor");
  const { isIndependent, studentCount, refresh, loading: wsLoading } =
    useWorkspaceSettings();

  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<MyStudent[]>([]);
  const [view, setView] = useState<"active" | "archived">("active");
  const [dialog, setDialog] = useState<{ open: boolean; mode: "create" | "edit"; studentId: string | null }>(
    { open: false, mode: "create", studentId: null }
  );
  const [form, setForm] = useState<FormData>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [showMoreFields, setShowMoreFields] = useState(false);
  const [invite, setInvite] = useState<{
    open: boolean;
    name: string;
    email: string | null;
    phone: string | null;
    studentId: string | null;
    emailSent: boolean;
  }>({ open: false, name: "", email: null, phone: null, studentId: null, emailSent: false });

  const [propagate, setPropagate] = useState<
    | { open: boolean; tutorId: string; studentId: string; subject: string; oldPrice: number; newPrice: number }
    | null
  >(null);

  const [walletDialog, setWalletDialog] = useState<
    | { open: boolean; tutorId: string; studentId: string; studentName: string; tutorName: string; rate: number }
    | null
  >(null);
  const [chatDialog, setChatDialog] = useState<
    | { open: boolean; studentId: string; studentName: string }
    | null
  >(null);
  const [lessonDialog, setLessonDialog] = useState<
    | { open: boolean; studentId: string }
    | null
  >(null);

  useEffect(() => {
    if (!wsLoading && user && (!isTutor || !isIndependent)) {
      navigate("/onboarding", { replace: true });
    }
  }, [wsLoading, user, isTutor, isIndependent, navigate]);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data: rates } = await supabase
      .from("student_rates")
      .select("id, student_id, subject, price_per_lesson, archived_at, currency, payment_details")
      .eq("tutor_id", user.id)
      .eq("source", "independent");

    const ids = Array.from(new Set((rates ?? []).map((r: any) => r.student_id)));
    if (ids.length === 0) {
      setStudents([]);
      setLoading(false);
      return;
    }

    const [{ data: profiles }, { data: contacts }, { data: defaults }, { data: lessonsAgg }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, first_name, last_name, is_pending, avatar_url")
        .in("id", ids),
      supabase
        .from("profile_contacts")
        .select("user_id, phone, email, telegram, facebook_url, instagram_url")
        .in("user_id", ids),
      supabase
        .from("tutor_student_defaults")
        .select("student_id, default_meeting_url")
        .eq("tutor_id", user.id)
        .in("student_id", ids),
      supabase
        .from("lessons")
        .select("student_id, starts_at, status, student_payment_status, student_price")
        .eq("tutor_id", user.id)
        .in("student_id", ids),
    ]);

    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    const contactMap = new Map((contacts ?? []).map((c: any) => [c.user_id, c]));
    const defaultsMap = new Map(
      (defaults ?? []).map((d: any) => [d.student_id, d.default_meeting_url])
    );

    // Aggregate lesson stats per student
    const statsMap = new Map<
      string,
      { unpaid_count: number; unpaid_total: number; last_lesson_at: string | null }
    >();
    for (const l of (lessonsAgg ?? []) as any[]) {
      const s = statsMap.get(l.student_id) ?? {
        unpaid_count: 0,
        unpaid_total: 0,
        last_lesson_at: null as string | null,
      };
      if (l.status === "completed" && l.student_payment_status === "unpaid") {
        s.unpaid_count += 1;
        s.unpaid_total += Number(l.student_price ?? 0);
      }
      if (
        (l.status === "completed" || l.status === "scheduled") &&
        (!s.last_lesson_at || l.starts_at > s.last_lesson_at)
      ) {
        s.last_lesson_at = l.starts_at;
      }
      statsMap.set(l.student_id, s);
    }

    const merged: MyStudent[] = ids.map((id) => {
      const p: any = profileMap.get(id) ?? {};
      const c: any = contactMap.get(id) ?? {};
      const r = (rates ?? []).find((x: any) => x.student_id === id);
      const stats = statsMap.get(id) ?? {
        unpaid_count: 0,
        unpaid_total: 0,
        last_lesson_at: null,
      };
      return {
        id,
        first_name: p.first_name ?? "",
        last_name: p.last_name ?? "",
        is_pending: p.is_pending ?? false,
        avatar_url: p.avatar_url ?? null,
        phone: c.phone ?? null,
        email: c.email ?? null,
        telegram: c.telegram ?? null,
        facebook_url: c.facebook_url ?? null,
        instagram_url: c.instagram_url ?? null,
        rate_id: r?.id ?? null,
        price: Number(r?.price_per_lesson ?? 0),
        subject: r?.subject ?? "",
        default_meeting_url: (defaultsMap.get(id) as string | null) ?? null,
        archived_at: (r as any)?.archived_at ?? null,
        currency: (r as any)?.currency ?? "UAH",
        payment_details: (r as any)?.payment_details ?? null,
        unpaid_count: stats.unpaid_count,
        unpaid_total: stats.unpaid_total,
        last_lesson_at: stats.last_lesson_at,
      };
    });
    merged.sort((a, b) => {
      const aT = a.last_lesson_at ? new Date(a.last_lesson_at).getTime() : 0;
      const bT = b.last_lesson_at ? new Date(b.last_lesson_at).getTime() : 0;
      if (aT !== bT) return bT - aT;
      return `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`, "uk");
    });
    setStudents(merged);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [user?.id]);

  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("new") === "1" && isTutor && isIndependent) {
      setForm(emptyForm);
      setDialog({ open: true, mode: "create", studentId: null });
      const next = new URLSearchParams(searchParams);
      next.delete("new");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, isTutor, isIndependent, setSearchParams]);

  const openCreate = () => {
    setForm(emptyForm);
    setShowMoreFields(false);
    setDialog({ open: true, mode: "create", studentId: null });
  };

  const openEdit = (s: MyStudent) => {
    setForm({
      first_name: s.first_name,
      last_name: s.last_name,
      phone: s.phone ?? "",
      email: s.email ?? "",
      telegram: s.telegram ?? "",
      facebook_url: s.facebook_url ?? "",
      instagram_url: s.instagram_url ?? "",
      subject: s.subject ?? "",
      price: String(s.price ?? ""),
      default_meeting_url: s.default_meeting_url ?? "",
      currency: s.currency || "UAH",
      payment_details: s.payment_details ?? "",
    });
    setShowMoreFields(true);
    setDialog({ open: true, mode: "edit", studentId: s.id });
  };

  const submit = async () => {
    if (!user) return;
    const fn = form.first_name.trim();
    const ln = form.last_name.trim();
    const email = form.email.trim().toLowerCase();
    const phone = form.phone.trim();
    const subject = form.subject.trim();
    const price = parseFloat(form.price);

    if (!fn && !ln) {
      toast.error(t("myStudents.nameRequired"));
      return;
    }
    if (!email && !phone) {
      toast.error(t("myStudents.emailOrPhoneRequired"));
      return;
    }
    if (!subject) {
      toast.error(t("myStudents.subjectRequired"));
      return;
    }
    if (isNaN(price) || price < 0) {
      toast.error(t("myStudents.invalidPrice"));
      return;
    }

    setSubmitting(true);

    if (dialog.mode === "create") {
      const newId = crypto.randomUUID();

      // 1. Ghost profile
      const { error: profErr } = await supabase
        .from("profiles")
        .insert({ id: newId, first_name: fn, last_name: ln, is_pending: true });
      if (profErr) {
        console.error(profErr);
        toast.error(profErr.message || t("myStudents.createProfileFailed"));
        setSubmitting(false);
        return;
      }

      // 2. Student role (RLS allows independent tutor to assign 'student' role to a pending ghost profile)
      const { error: roleErr } = await supabase
        .from("user_roles")
        .insert({ user_id: newId, role: "student" });
      if (roleErr) {
        console.error(roleErr);
        await supabase.from("profiles").delete().eq("id", newId);
        toast.error(t("myStudents.roleAssignFailed"));
        setSubmitting(false);
        return;
      }

      // 3. Rate (independent source) — must exist BEFORE contacts/details so RLS for independent tutor passes
      const { error: rateErr } = await supabase.from("student_rates").insert({
        tutor_id: user.id,
        student_id: newId,
        subject,
        price_per_lesson: price,
        source: "independent",
        currency: form.currency || "UAH",
        payment_details: form.payment_details.trim() || null,
      } as any);
      if (rateErr) {
        console.error(rateErr);
        await supabase.from("user_roles").delete().eq("user_id", newId);
        await supabase.from("profiles").delete().eq("id", newId);
        toast.error(t("myStudents.savePriceFailed"));
        setSubmitting(false);
        return;
      }

      // 4. Contacts (now allowed by 'Independent tutor manages own student contacts' RLS)
      const { error: contErr } = await supabase.from("profile_contacts").insert({
        user_id: newId,
        email: email || null,
        phone: phone || null,
        telegram: form.telegram.trim() || null,
        facebook_url: form.facebook_url.trim() || null,
        instagram_url: form.instagram_url.trim() || null,
      });
      if (contErr) {
        console.error(contErr);
        await supabase.from("student_rates").delete().eq("tutor_id", user.id).eq("student_id", newId);
        await supabase.from("user_roles").delete().eq("user_id", newId);
        await supabase.from("profiles").delete().eq("id", newId);
        toast.error(
          String(contErr.message || "").includes("email_lower")
            ? t("myStudents.emailTaken")
            : t("myStudents.saveContactsFailed")
        );
        setSubmitting(false);
        return;
      }

      // 5. Student details
      await supabase.from("student_details").upsert({ user_id: newId }, { onConflict: "user_id" });

      // 6. Default meeting URL (Zoom/Meet) — optional
      const meetingUrlRaw = form.default_meeting_url.trim();
      const meetingUrl = meetingUrlRaw ? sanitizeHttpUrl(meetingUrlRaw) : "";
      if (meetingUrlRaw && !meetingUrl) {
        toast.error(t("myStudents.invalidMeetingUrl"));
        return;
      }
      if (meetingUrl) {
        await supabase.from("tutor_student_defaults").upsert(
          {
            tutor_id: user.id,
            student_id: newId,
            default_meeting_url: meetingUrl,
          },
          { onConflict: "tutor_id,student_id" }
        );
      }

      toast.success(t("myStudents.studentAdded"));

      // Auto-send email invite if we have an email
      let inviteSent = false;
      if (email) {
        const { data: inviteResp, error: inviteErr } = await supabase.functions.invoke(
          "send-student-invite",
          { body: { studentId: newId } }
        );
        if (!inviteErr && (inviteResp as any)?.success) {
          inviteSent = true;
          toast.success(t("myStudents.inviteSent"));
        } else if (inviteErr) {
          console.warn("Auto-invite failed", inviteErr);
        }
      }

      // Show invite dialog so the tutor can copy/resend the registration link
      setInvite({
        open: true,
        name: `${fn} ${ln}`.trim(),
        email: email || null,
        phone: phone || null,
        studentId: newId,
        emailSent: inviteSent,
      });
    } else if (dialog.mode === "edit" && dialog.studentId) {
      // Update profile
      await supabase
        .from("profiles")
        .update({ first_name: fn, last_name: ln })
        .eq("id", dialog.studentId);

      // Update contacts (upsert)
      await supabase.from("profile_contacts").upsert(
        {
          user_id: dialog.studentId,
          email: email || null,
          phone: phone || null,
          telegram: form.telegram.trim() || null,
          facebook_url: form.facebook_url.trim() || null,
          instagram_url: form.instagram_url.trim() || null,
        },
        { onConflict: "user_id" }
      );

      // Update rate
      const existing = students.find((s) => s.id === dialog.studentId);
      let priceChanged: { tutorId: string; studentId: string; subject: string; oldPrice: number; newPrice: number } | null = null;
      if (existing?.rate_id) {
        const oldPrice = Number(existing.price ?? 0);
        await supabase
          .from("student_rates")
          .update({
            subject,
            price_per_lesson: price,
            currency: form.currency || "UAH",
            payment_details: form.payment_details.trim() || null,
          } as any)
          .eq("id", existing.rate_id);
        if (oldPrice !== price) {
          priceChanged = {
            tutorId: user.id,
            studentId: dialog.studentId,
            subject,
            oldPrice,
            newPrice: price,
          };
        }
      }

      // Default meeting URL — upsert or clear
      const meetingUrlRaw = form.default_meeting_url.trim();
      const meetingUrl = meetingUrlRaw ? sanitizeHttpUrl(meetingUrlRaw) : "";
      if (meetingUrlRaw && !meetingUrl) {
        toast.error(t("myStudents.invalidMeetingUrl"));
        return;
      }
      await supabase.from("tutor_student_defaults").upsert(
        {
          tutor_id: user.id,
          student_id: dialog.studentId,
          default_meeting_url: meetingUrl || null,
        },
        { onConflict: "tutor_id,student_id" }
      );

      toast.success(t("myStudents.studentUpdated"));
      if (priceChanged) {
        setPropagate({ open: true, ...priceChanged });
      }
    }

    setSubmitting(false);
    setDialog({ open: false, mode: "create", studentId: null });
    await Promise.all([load(), refresh()]);
  };

  const archive = async (s: MyStudent) => {
    if (!s.rate_id) return;
    if (!confirm(`Перенести ${ `${s.first_name} ${s.last_name}`.trim() || t("common.noName")} в архів? Історію уроків буде збережено.`)) return;
    const { error } = await supabase
      .from("student_rates")
      .update({ archived_at: new Date().toISOString() } as any)
      .eq("id", s.rate_id);
    if (error) {
      toast.error(t("myStudents.archiveFailed"));
      return;
    }
    toast.success(t("myStudents.archived"));
    await Promise.all([load(), refresh()]);
  };

  const unarchive = async (s: MyStudent) => {
    if (!s.rate_id) return;
    const { error } = await supabase
      .from("student_rates")
      .update({ archived_at: null } as any)
      .eq("id", s.rate_id);
    if (error) {
      toast.error(t("myStudents.unarchiveFailed"));
      return;
    }
    toast.success(t("myStudents.unarchived"));
    await Promise.all([load(), refresh()]);
  };

  const activeStudents = students.filter((s) => !s.archived_at);
  const archivedStudents = students.filter((s) => !!s.archived_at);
  const visibleStudents = view === "active" ? activeStudents : archivedStudents;

  const statusOf = (s: MyStudent) => computeStudentStatus(s);
  const statusDotClass = studentStatusDotClass;

  return (
    <AppLayout>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">{t("myStudents.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("myStudents.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
            {t("myStudents.studentCount", { count: studentCount })}
          </span>
          <Button onClick={openCreate}>
            <UserPlus className="mr-2 h-4 w-4" />
            {t("myStudents.addStudentBtn")}
          </Button>
        </div>
      </div>

      <div className="mb-4 inline-flex rounded-lg border border-border bg-card p-1">
        <button
          type="button"
          onClick={() => setView("active")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            view === "active"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("myStudents.tabActive", { count: activeStudents.length })}
        </button>
        <button
          type="button"
          onClick={() => setView("archived")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            view === "archived"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("myStudents.tabArchived", { count: archivedStudents.length })}
        </button>
      </div>

      {loading ? (
        <StudentsSkeleton />
      ) : visibleStudents.length === 0 ? (
        view === "active" ? (
          <EmptyState
            icon={UserPlus}
            title={t("myStudents.emptyActiveTitle")}
            description={t("myStudents.emptyActiveDesc")}
            actionLabel={t("myStudents.addStudentBtn")}
            onAction={openCreate}
          />
        ) : (
          <EmptyState
            icon={Archive}
            title={t("myStudents.emptyArchiveTitle")}
            description={t("myStudents.emptyArchiveDesc")}
          />
        )
      ) : (
        <div className="space-y-3">
          {visibleStudents.map((s) => {
            const st = statusOf(s);
            return (
            <Card key={s.id} className={s.archived_at ? "opacity-70" : undefined}>
              <CardContent className="flex items-start gap-4 p-4">
                <div className="relative shrink-0">
                  <UserAvatar
                    url={s.avatar_url}
                    firstName={s.first_name}
                    lastName={s.last_name}
                    className="h-10 w-10"
                  />
                  {!s.archived_at && (
                    <span
                      title={st.label}
                      className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card ${statusDotClass[st.status]}`}
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">
                      {`${s.first_name} ${s.last_name}`.trim() || t("common.noName")}
                    </p>
                    {s.is_pending && !s.archived_at && (
                      <span
                        className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning"
                        title={t("myStudents.pendingBadge")}
                      >
                        <Hourglass className="h-3 w-3" />
                        {t("myStudents.pendingBadge")}
                      </span>
                    )}
                    {!s.archived_at && (st.status === "debt" || st.status === "inactive") && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                          st.status === "debt"
                            ? "bg-warning/15 text-warning"
                            : "bg-destructive/15 text-destructive"
                        }`}
                      >
                        {st.label}
                      </span>
                    )}
                    {s.archived_at && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        <Archive className="h-3 w-3" />
                        {t("myStudents.archivedBadge")}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{s.subject}</span>
                    <span className="inline-flex items-center gap-1">
                      <Banknote className="h-3 w-3" />
                      {formatPrice(s.price, s.currency)}{t("myStudents.perLesson")}
                    </span>
                    {s.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {s.phone}
                      </span>
                    )}
                    {s.email && (
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {s.email}
                      </span>
                    )}
                    {s.telegram && (
                      <span className="inline-flex items-center gap-1">
                        <Send className="h-3 w-3" />
                        {s.telegram}
                      </span>
                    )}
                    {s.facebook_url && (
                      <a
                        href={safeHref(s.facebook_url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        <Facebook className="h-3 w-3" />
                        Facebook
                      </a>
                    )}
                    {s.instagram_url && (
                      <a
                        href={safeHref(s.instagram_url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        <Instagram className="h-3 w-3" />
                        Instagram
                      </a>
                    )}
                    {s.default_meeting_url && (
                      <a
                        href={safeHref(s.default_meeting_url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <Video className="h-3 w-3" />
                        {t("myStudents.permanentRoom")}
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!s.archived_at && !s.is_pending && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setChatDialog({
                          open: true,
                          studentId: s.id,
                          studentName: `${s.first_name} ${s.last_name}`.trim() || t("common.noName"),
                        })
                      }
                      title={t("chats.noChatsOther")}
                    >
                      <MessageSquare className="h-4 w-4 text-primary" />
                    </Button>
                  )}
                  {!s.archived_at && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setLessonDialog({ open: true, studentId: s.id })}
                      title={t("schedule.addLesson")}
                    >
                      <CalendarPlus className="h-4 w-4 text-primary" />
                    </Button>
                  )}
                  {!s.archived_at && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setWalletDialog({
                          open: true,
                          tutorId: user!.id,
                          studentId: s.id,
                          studentName: `${s.first_name} ${s.last_name}`.trim() || "—",
                          tutorName: t("common.you"),
                          rate: s.price,
                        })
                      }
                      title={t("nav.wallets")}
                    >
                      <Wallet className="h-4 w-4 text-primary" />
                    </Button>
                  )}
                  {!s.archived_at && (
                    <Button size="sm" variant="ghost" onClick={() => openEdit(s)} title={t("common.edit")}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                  {s.archived_at ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => unarchive(s)}
                      title={t("people.unarchiveBtn")}
                    >
                      <ArchiveRestore className="h-4 w-4 text-primary" />
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => archive(s)}
                      title={t("people.archiveBtn")}
                    >
                      <Archive className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog
        open={dialog.open}
        onOpenChange={(v) => !v && setDialog({ open: false, mode: "create", studentId: null })}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {dialog.mode === "create" ? t("myStudents.addDialogTitle") : t("myStudents.editDialogTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("myStudents.dialogDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>{t("myStudents.fieldFirstName")}</Label>
                <Input
                  value={form.first_name}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>{t("myStudents.fieldLastName")}</Label>
                <Input
                  value={form.last_name}
                  onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t("myStudents.fieldSubject")}</Label>
              <SubjectComboBox
                value={form.subject}
                onChange={(v) => setForm({ ...form, subject: v })}
                placeholder={t("myStudents.subjectPlaceholder")}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>{t("myStudents.fieldPrice", { currency: currencySymbol(form.currency) })}</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>{t("myStudents.fieldCurrency")}</Label>
                <CurrencyComboBox
                  value={form.currency}
                  onChange={(v) => setForm({ ...form, currency: v })}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowMoreFields((v) => !v)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-full py-1"
            >
              {showMoreFields ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {showMoreFields ? t("myStudents.hideContacts") : t("myStudents.showContacts")}
            </button>

            {showMoreFields && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label>{t("myStudents.fieldPhone")}</Label>
                    <Input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>{t("myStudents.fieldEmail")}</Label>
                    <Input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>{t("myStudents.fieldTelegram")}</Label>
                  <Input
                    placeholder={t("scheduleExtra.telegramPlaceholder")}
                    value={form.telegram}
                    onChange={(e) => setForm({ ...form, telegram: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label>{t("myStudents.fieldFacebook")}</Label>
                    <Input
                      placeholder="https://facebook.com/..."
                      value={form.facebook_url}
                      onChange={(e) => setForm({ ...form, facebook_url: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>{t("myStudents.fieldInstagram")}</Label>
                    <Input
                      placeholder="https://instagram.com/..."
                      value={form.instagram_url}
                      onChange={(e) => setForm({ ...form, instagram_url: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>{t("myStudents.fieldPaymentDetails")}</Label>
                  <Textarea
                    placeholder="Monobank 4441…, Revolut @name, Swish 070-123 45 67"
                    value={form.payment_details}
                    onChange={(e) => setForm({ ...form, payment_details: e.target.value })}
                    rows={3}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("myStudents.paymentDetailsDesc")}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="flex items-center gap-1.5">
                    <Video className="h-3.5 w-3.5 text-muted-foreground" />
                    {t("myStudents.fieldMeetingUrl")}
                  </Label>
                  <Input
                    type="url"
                    placeholder={t("scheduleExtra.meetingUrlPlaceholder")}
                    value={form.default_meeting_url}
                    onChange={(e) => setForm({ ...form, default_meeting_url: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("myStudents.meetingUrlDesc")}
                  </p>
                </div>
              </div>
            )}
          </div>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialog({ open: false, mode: "create", studentId: null })}
            >
              {t("myStudents.cancelBtn")}
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {dialog.mode === "create" ? t("myStudents.addBtn") : t("myStudents.saveBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InviteLinkDialog
        open={invite.open}
        onOpenChange={(v) => setInvite((prev) => ({ ...prev, open: v }))}
        personName={invite.name}
        email={invite.email}
        phone={invite.phone}
        studentId={invite.studentId}
        emailSent={invite.emailSent}
        role="student"
      />

      {propagate && (
        <RatePropagationDialog
          open={propagate.open}
          onOpenChange={(o) => setPropagate((p) => (p ? { ...p, open: o } : p))}
          tutorId={propagate.tutorId}
          studentId={propagate.studentId}
          subject={propagate.subject}
          newPrice={propagate.newPrice}
          oldPrice={propagate.oldPrice}
          onDone={load}
        />
      )}

      {walletDialog && (
        <WalletDialog
          open={walletDialog.open}
          onOpenChange={(o) => {
            if (!o) setWalletDialog(null);
          }}
          tutorId={walletDialog.tutorId}
          studentId={walletDialog.studentId}
          studentName={walletDialog.studentName}
          tutorName={walletDialog.tutorName}
          ratePerLesson={walletDialog.rate}
          canTopUp={true}
        />
      )}

      {chatDialog && user && (
        <ChatThreadDialog
          open={chatDialog.open}
          onOpenChange={(o) => !o && setChatDialog(null)}
          tutorId={user.id}
          studentId={chatDialog.studentId}
          counterpartName={chatDialog.studentName}
        />
      )}

      {lessonDialog && (
        <QuickLessonDialog
          open={lessonDialog.open}
          onOpenChange={(o) => !o && setLessonDialog(null)}
          startsAt={new Date(Date.now() + 60 * 60 * 1000)}
          initialStudentId={lessonDialog.studentId}
          onCreated={() => {
            setLessonDialog(null);
            load();
          }}
        />
      )}
    </AppLayout>
  );
}
