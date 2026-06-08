import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { NotificationBell } from "@/components/NotificationBell";
import { PageFAB } from "@/components/PageFAB";
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
  X,
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
import { PersonCard, PersonAva } from "@/components/PersonCard";

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
  next_lesson_at?: string | null;
  total_lessons?: number;
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

  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  const activeStudents = students.filter((s) => !s.archived_at);
  const archivedStudents = students.filter((s) => !!s.archived_at);
  const baseList = view === "active" ? activeStudents : archivedStudents;
  const visibleStudents = searchQuery
    ? baseList.filter(s => `${s.first_name} ${s.last_name} ${s.subject}`.toLowerCase().includes(searchQuery.toLowerCase()))
    : baseList;
  const selectedStudent = visibleStudents.find(s => s.id === selectedStudentId) ?? null;

  const statusOf = (s: MyStudent) => computeStudentStatus(s);
  const statusDotClass = studentStatusDotClass;

  const T = {
    teal: "#2BBFAA", tealD: "#25a896", border: "#eceef3",
    bg: "#F5F4F0", txt: "#0f0f1a", sub: "#9398b0", muted: "#b0b4c8",
    display: "Inter, system-ui, sans-serif", body: "'Plus Jakarta Sans', system-ui, sans-serif",
  };

  // Profile panel helper
  const inactiveDaysOf = (s: MyStudent) => {
    if (!s.last_lesson_at) return undefined;
    return Math.round((Date.now() - new Date(s.last_lesson_at).getTime()) / 86400000);
  };

  return (
    <AppLayout>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-black text-[22px] leading-tight" style={{ fontFamily: T.display }}>{t("myStudents.title")}</h1>
          <p className="text-[14px] mt-0.5" style={{ color: T.sub }}>{t("myStudents.subtitle")}</p>
        </div>
        <Button onClick={openCreate} className="flex items-center gap-1.5 h-10 rounded-full">
          <UserPlus className="h-4 w-4" />
          {t("myStudents.addStudentBtn")}
        </Button>
      </div>

      {/* ── Search ─────────────────────────────────────────────────────── */}
      <div className="relative mb-4">
        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: T.muted }} />
        <input
          value={searchQuery}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setSearchQuery(e.target.value); setSelectedStudentId(null); }}
          placeholder={t("myStudents.searchPlaceholder") || "Пошук за іменем, предметом…"}
          className="w-full h-10 pl-9 pr-3 rounded-[12px] text-[14px] outline-none"
          style={{ border: `1px solid ${T.border}`, background: "#fbfbfc", fontFamily: T.body }}
        />
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex gap-0.5 mb-4 rounded-[12px] p-1" style={{ background: T.bg, width: "fit-content" }}>
        {([["active", t("myStudents.tabActive", { count: activeStudents.length })],
           ["archived", t("myStudents.tabArchived", { count: archivedStudents.length })]] as const).map(([key, label]) => (
          <button key={key} onClick={() => setView(key)}
            className="px-4 h-8 rounded-[9px] text-[13px] font-bold transition-all"
            style={view === key
              ? { background: "#fff", color: T.txt, fontFamily: T.display, boxShadow: "0 1px 3px rgba(15,15,26,.1)" }
              : { background: "transparent", color: T.sub, fontFamily: T.display }}>
            {label}
          </button>
        ))}
      </div>

      {loading ? <StudentsSkeleton /> : visibleStudents.length === 0 ? (
        view === "active" ? (
          <EmptyState icon={UserPlus} title={t("myStudents.emptyActiveTitle")}
            description={t("myStudents.emptyActiveDesc")} actionLabel={t("myStudents.addStudentBtn")} onAction={openCreate} />
        ) : (
          <EmptyState icon={Archive} title={t("myStudents.emptyArchiveTitle")} description={t("myStudents.emptyArchiveDesc")} />
        )
      ) : (
        /* ── Two-column desktop layout ─────────────────────────────────── */
        <div className="flex gap-5 items-start">
          {/* Left: list */}
          <div className={`flex flex-col gap-2.5 flex-shrink-0 ${selectedStudent ? "hidden lg:flex lg:w-[400px]" : "w-full"}`}>
            {visibleStudents.map(s => {
              const st = statusOf(s);
              const inactiveDays = inactiveDaysOf(s);
              const name = `${s.first_name} ${s.last_name}`.trim() || "—";
              return (
                <PersonCard
                  key={s.id}
                  id={s.id}
                  name={name}
                  avatarUrl={s.avatar_url}
                  status={s.is_pending ? "pending" : st.status}
                  subLine={`${s.subject} · ₴${s.price}/урок`}
                  email={s.email}
                  isPending={s.is_pending}
                  inactiveDays={st.status === "inactive" ? inactiveDays : undefined}
                  unpaidTotal={s.unpaid_total}
                  kind="student"
                  active={selectedStudentId === s.id}
                  onOpen={() => setSelectedStudentId(s.id === selectedStudentId ? null : s.id)}
                  onWrite={() => navigate(`/chats?with=${s.id}`)}
                />
              );
            })}
          </div>

          {/* Right: profile panel (desktop always, mobile overlay) */}
          {selectedStudent && (() => {
            const s = selectedStudent;
            const st = statusOf(s);
            const name = `${s.first_name} ${s.last_name}`.trim() || "—";
            const nextLessonLabel = (s as any).next_lesson_at
              ? new Date((s as any).next_lesson_at).toLocaleDateString("uk-UA", { day: "numeric", month: "short" })
              : t("myStudents.noUpcoming") || "—";

            return (
              <div className="flex-1 min-w-0 rounded-[20px] border bg-white"
                style={{ borderColor: T.border, boxShadow: "0 2px 12px rgba(15,15,26,.06)" }}>
                {/* Back button (mobile only) */}
                <button className="lg:hidden flex items-center gap-1.5 px-4 pt-4 pb-2 text-[14px] font-semibold"
                  style={{ color: T.tealD, fontFamily: T.display }}
                  onClick={() => setSelectedStudentId(null)}>
                  ← Назад
                </button>

                {/* Hero */}
                <div className="flex items-center gap-4 px-5 pt-5 pb-4" style={{ borderBottom: `1px solid ${T.border}` }}>
                  <PersonAva name={name} avatarUrl={s.avatar_url} status={s.is_pending ? "pending" : st.status} size={56} />
                  <div className="min-w-0 flex-1">
                    <p className="font-black text-[20px] leading-tight truncate" style={{ fontFamily: T.display, color: T.txt }}>{name}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[13px] font-semibold px-2.5 py-0.5 rounded-full"
                        style={{ background: st.status === "debt" ? "rgba(245,158,11,.12)" : st.status === "ok" ? "rgba(34,197,94,.12)" : "rgba(148,155,185,.12)",
                                 color: st.status === "debt" ? "#b45309" : st.status === "ok" ? "#16a34a" : T.sub }}>
                        {s.is_pending ? "⏳ Очікує входу" : st.label}
                      </span>
                      <span className="text-[13px]" style={{ color: T.sub }}>{s.subject}</span>
                    </div>
                  </div>
                  <button className="p-2 rounded-full hover:bg-gray-50" onClick={() => openEdit(s)} title={t("common.edit")}>
                    <Pencil size={16} style={{ color: T.muted }} />
                  </button>
                </div>

                {/* Actions */}
                <div className="flex gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${T.border}` }}>
                  <button onClick={() => navigate(`/chats?with=${s.id}`)}
                    className="flex-1 h-12 rounded-[14px] font-bold text-[15px] text-white flex items-center justify-center gap-2"
                    style={{ background: `linear-gradient(135deg,${T.teal},${T.tealD})`, fontFamily: T.display,
                             boxShadow: "0 6px 18px -6px rgba(43,191,170,.6)" }}>
                    <Send size={18} strokeWidth={2} /> {t("people.write") || "Написати"}
                  </button>
                  {s.phone && (
                    <a href={`tel:${s.phone}`}
                      className="flex-shrink-0 h-12 px-5 rounded-[14px] border font-bold text-[15px] flex items-center justify-center gap-2"
                      style={{ borderColor: T.border, color: T.tealD, fontFamily: T.display, textDecoration: "none" }}>
                      <Phone size={17} strokeWidth={2} /> {t("people.call") || "Подзвонити"}
                    </a>
                  )}
                </div>

                {/* Debt alert */}
                {s.unpaid_total > 0 && (
                  <div className="mx-5 my-3 rounded-[14px] flex items-center justify-between px-4 py-3"
                    style={{ background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.3)" }}>
                    <div>
                      <p className="text-[13px] font-bold" style={{ color: "#b45309" }}>
                        ⚠️ Заборгованість ₴{s.unpaid_total}
                      </p>
                      <p className="text-[12px]" style={{ color: "#b45309" }}>
                        {s.unpaid_count} неоплачений{s.unpaid_count > 1 ? "х" : ""} урок{s.unpaid_count > 1 ? "ів" : ""}
                      </p>
                    </div>
                    <button onClick={() => setWalletDialog({ open: true, tutorId: user!.id, studentId: s.id,
                        studentName: name, tutorName: t("common.you"), rate: s.price })}
                      className="h-8 px-3 rounded-[9px] text-[12.5px] font-bold"
                      style={{ background: "rgba(245,158,11,.2)", color: "#b45309", border: "1px solid rgba(245,158,11,.4)", fontFamily: T.display }}>
                      Нагадати
                    </button>
                  </div>
                )}

                {/* Stats */}
                <div className="grid grid-cols-2 gap-3 px-5 py-4" style={{ borderTop: s.unpaid_total > 0 ? "none" : `1px solid ${T.border}` }}>
                  <div className="rounded-[14px] p-3" style={{ background: T.bg }}>
                    <p className="font-black text-[24px]" style={{ fontFamily: T.display, color: T.txt }}>{(s as any).total_lessons ?? 0}</p>
                    <p className="text-[13px]" style={{ color: T.sub }}>уроків разом</p>
                  </div>
                  <div className="rounded-[14px] p-3" style={{ background: T.bg }}>
                    <p className="font-black text-[18px]" style={{ fontFamily: T.display,
                       color: (s as any).next_lesson_at ? T.tealD : T.muted }}>
                      {nextLessonLabel}
                    </p>
                    <p className="text-[13px]" style={{ color: T.sub }}>наступний урок</p>
                  </div>
                </div>

                {/* Contacts */}
                <div className="px-5 pb-4 flex flex-col gap-2.5" style={{ borderTop: `1px solid ${T.border}`, paddingTop: 16 }}>
                  {[
                    { icon: <Mail size={15} />, label: "Email",    value: s.email },
                    { icon: <Phone size={15} />, label: "Телефон", value: s.phone },
                    { icon: <Send size={15} />,  label: "Telegram", value: s.telegram },
                    { icon: <Video size={15} />, label: "Постійна кімната", value: s.default_meeting_url },
                  ].filter(c => c.value).map(({ icon, label, value }) => (
                    <div key={label} className="flex items-center gap-3 rounded-[12px] px-3 py-2.5"
                      style={{ border: `1px solid ${T.border}`, background: "#fbfbfc" }}>
                      <span style={{ color: T.muted, flexShrink: 0 }}>{icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] uppercase tracking-wide" style={{ color: T.muted, fontFamily: T.display }}>{label}</p>
                        <p className="text-[14px] truncate" style={{ color: T.txt, fontFamily: T.body }}>{value}</p>
                      </div>
                      {label === "Телефон" && (
                        <a href={`tel:${value}`} className="p-1.5 rounded-full hover:bg-gray-100"
                          style={{ color: T.tealD }}>
                          <Phone size={15} />
                        </a>
                      )}
                    </div>
                  ))}
                </div>

                {/* Actions: edit / archive / wallet */}
                <div className="flex gap-2 px-5 pb-5">
                  <Button size="sm" variant="outline" onClick={() => openEdit(s)} className="flex-1">
                    <Pencil className="h-3.5 w-3.5 mr-1" /> {t("common.edit")}
                  </Button>
                  {!s.archived_at ? (
                    <Button size="sm" variant="outline" onClick={() => archive(s)}>
                      <Archive className="h-3.5 w-3.5 mr-1" /> {t("people.archiveBtn")}
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => unarchive(s)}>
                      <ArchiveRestore className="h-3.5 w-3.5 mr-1" /> {t("people.unarchiveBtn")}
                    </Button>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}


            {/* Add/Edit Dialog */}
      <Dialog
        open={dialog.open}
        onOpenChange={(v) => !v && setDialog({ open: false, mode: "create", studentId: null })}
      >
        <DialogContent className="max-w-lg rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%]">
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
      <PageFAB onClick={() => setDialog({ open: true, mode: "create", studentId: null })} label={t("myStudents.addStudent")} />
    </AppLayout>
  );
}
