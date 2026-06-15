import { useEffect, useState } from "react";
import { getLocale } from "@/lib/locale";
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
  Plus,
  Loader2,
  Phone,
  Search,
  Copy,
  ArrowLeft,
  MessageCircle,
  X,
  Facebook,
  Instagram,
  Pencil,
  Archive,
  ArchiveRestore,
  Hourglass,
  Banknote,
  Wallet,
  MessageSquare,
  CalendarPlus,
  ChevronDown,
  Check,
} from "lucide-react";
import { SubjectComboBox } from "@/components/SubjectComboBox";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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
  tutor_notes: string | null;
  wallet_lessons?: number;
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
  tutor_notes: string;
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
  tutor_notes: "",
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
  const [subjectDraft, setSubjectDraft] = useState("");
  const [curOpen, setCurOpen] = useState(false);
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

  // Роут уже захищений ProtectedRoute allowedRoles={["tutor"]} в App.tsx.
  // Раніше тут було додаткове викидання на /onboarding при !isIndependent, але
  // воно спрацьовувало через timing useWorkspaceSettings (поки isIndependent ще
  // не догрузилось) і відкидало незалежного репетитора назад — через що клік по
  // бульбашці «Учні» виглядав як «нічого не відбувається». Прибрано.

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

    const [{ data: profiles }, { data: contacts }, { data: defaults }, { data: lessonsAgg }, { data: tnotes }, { data: walletBal }] = await Promise.all([
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
      (supabase as any)
        .from("tutor_student_notes")
        .select("student_id, notes")
        .eq("tutor_id", user.id)
        .in("student_id", ids),
      (supabase as any)
        .from("student_wallet_balances")
        .select("student_id, lessons_balance")
        .eq("tutor_id", user.id)
        .in("student_id", ids),
    ]);

    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    const contactMap = new Map((contacts ?? []).map((c: any) => [c.user_id, c]));
    const defaultsMap = new Map(
      (defaults ?? []).map((d: any) => [d.student_id, d.default_meeting_url])
    );
    const notesMap = new Map(
      ((tnotes ?? []) as any[]).map((n: any) => [n.student_id, n.notes as string | null])
    );
    const walletMap = new Map(
      ((walletBal ?? []) as any[]).map((b: any) => [b.student_id, Number(b.lessons_balance ?? 0)])
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
        tutor_notes: (notesMap.get(id) as string | null) ?? null,
        wallet_lessons: walletMap.get(id) ?? 0,
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
      tutor_notes: s.tutor_notes ?? "",
    });
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

      // 7. Private tutor notes — tutor-only RLS table, the student can never read these
      const notesVal = form.tutor_notes.trim();
      if (notesVal) {
        await (supabase as any).from("tutor_student_notes").upsert(
          { tutor_id: user.id, student_id: newId, notes: notesVal },
          { onConflict: "tutor_id,student_id" }
        );
      }

      toast.success(t("myStudents.studentAdded"));
      {
        const newName = `${form.first_name} ${form.last_name}`.trim();
        window.setTimeout(() => {
          toast(t("myStudents.firstStepToastTitle"), {
            description: newName ? t("myStudents.firstStepToastDescNamed", { name: newName }) : t("myStudents.firstStepToastDesc"),
            action: { label: t("myStudents.createLessonAction"), onClick: () => navigate("/schedule") },
            duration: 8000,
          });
        }, 600);
      }

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

      // Private tutor notes — upsert (null clears)
      await (supabase as any).from("tutor_student_notes").upsert(
        { tutor_id: user.id, student_id: dialog.studentId, notes: form.tutor_notes.trim() || null },
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
    if (!confirm(t("myStudents.archiveConfirm", { name: `${s.first_name} ${s.last_name}`.trim() || t("common.noName") }))) return;
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
  const [subjectOpen, setSubjectOpen] = useState(false);
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

  // Єдина іконка копіювання (без слів/кнопок) — 44px тач-таргет, як у дизайні.
  const CopyMini = ({ value, label }: { value: string; label: string }) => {
    const [done, setDone] = useState(false);
    return (
      <button aria-label={t("common.copy") || "Копіювати"} title={t("common.copy") || "Копіювати"}
        onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(value);
          toast.success(`${label} ${t("common.copied") || "скопійовано"}`, { description: value });
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
        style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 11, border: "none", cursor: "pointer", background: "transparent", color: done ? "#16a34a" : T.tealD, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {done ? <Check size={19} strokeWidth={2.4} /> : <Copy size={19} strokeWidth={2} />}
      </button>
    );
  };

  return (
    <AppLayout>
      {/* ── Header (desktop only — mobile header is AppLayout's) ───────── */}
      <div className="mb-3 hidden lg:flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 style={{ fontFamily: T.display, fontWeight: 800, fontSize: 24, letterSpacing: "-.02em", color: T.txt }}>{t("myStudents.title")}</h1>
          <p className="mt-0.5 truncate" style={{ fontFamily: T.body, fontSize: 14, color: T.sub }}>{t("myStudents.subtitle")}</p>
        </div>
      </div>

      {/* ── Search (full-width row, appears only when open) ───────────── */}
      {searchOpen && (
        <div className="mb-3">
          <div className="flex items-center gap-2.5" style={{ height: 46, padding: "0 8px 0 14px", borderRadius: 13, background: "#fff", border: `1px solid ${T.border}`, boxShadow: "0 1px 4px rgba(0,0,0,.05)" }}>
            <Search size={20} style={{ color: T.sub, flexShrink: 0 }} />
            <input
              autoFocus
              value={searchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setSearchQuery(e.target.value); setSelectedStudentId(null); }}
              placeholder={t("myStudents.searchPlaceholder")}
              style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontFamily: T.body, fontSize: 15, color: T.txt, minWidth: 0 }}
            />
            <button onClick={() => { setSearchQuery(""); setSearchOpen(false); }} aria-label={t("common.close")}
              style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 999, border: "none", cursor: "pointer", background: T.bg, color: T.sub, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <X size={17} />
            </button>
          </div>
        </div>
      )}

      {/* ── Tabs + magnifier in one row ──────────────────────────────── */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex gap-0.5 rounded-[12px] p-1" style={{ background: T.bg, width: "fit-content" }}>
          {([["active", t("myStudents.tabActive", { count: activeStudents.length })],
             ["archived", t("myStudents.tabArchived", { count: archivedStudents.length })]] as const).map(([key, label]) => (
            <button key={key} onClick={() => { setView(key); setSearchQuery(""); }}
              className="px-4 h-10 rounded-[9px] text-[13px] font-bold transition-all"
              style={view === key
              ? { background: "#fff", color: T.txt, fontFamily: T.display, boxShadow: "0 1px 3px rgba(15,15,26,.1)" }
              : { background: "transparent", color: T.sub, fontFamily: T.display }}>
            {label}
          </button>
        ))}
        </div>
        {!searchOpen && (
          <button onClick={() => setSearchOpen(true)} aria-label={t("myStudents.searchPlaceholder")}
            style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 999, border: "none", cursor: "pointer", background: "#fff", color: T.sub, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 4px rgba(0,0,0,.05)" }}>
            <Search size={21} strokeWidth={2} />
          </button>
        )}
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
              const name = `${s.first_name} ${s.last_name}`.trim() || "—";
              return (
                <PersonCard
                  key={s.id}
                  id={s.id}
                  name={name}
                  avatarUrl={s.avatar_url}
                  status={s.is_pending ? "pending" : st.status}
                  subLine={`${s.subject} · ${formatPrice(s.price, s.currency)}${t("myStudents.perLessonSuffix")}${(s.wallet_lessons ?? 0) > 0 ? ` · 📦 ${t("myStudents.walletLessonsShort", { count: s.wallet_lessons })}` : ""}`}
                  email={s.email}
                  isPending={s.is_pending}
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
              ? new Date((s as any).next_lesson_at).toLocaleDateString(getLocale(), { day: "numeric", month: "short" })
              : "—";
            const statusBg = s.is_pending ? "rgba(148,155,185,.14)" : st.status === "debt" ? "rgba(245,158,11,.12)" : st.status === "ok" ? "rgba(34,197,94,.12)" : st.status === "new" ? "rgba(37,99,235,.1)" : "rgba(148,155,185,.12)";
            const statusFg = s.is_pending ? T.sub : st.status === "debt" ? "#B4740B" : st.status === "ok" ? "#16a34a" : st.status === "new" ? "#2563eb" : T.sub;
            const statusLabel = s.is_pending ? t("myStudents.statusPendingEntry") : st.label;
            const contacts = [
              { label: t("myStudents.contactPhone"), value: s.phone, tel: true },
              { label: "Telegram", value: s.telegram, tel: false },
            ].filter(c => c.value);

            return (
              <div className="flex-1 min-w-0 rounded-[20px] flex flex-col" style={{ background: T.bg, border: `1px solid ${T.border}`, boxShadow: "0 2px 12px rgba(15,15,26,.06)", maxHeight: "calc(100vh - 120px)" }}>
                {/* Corner actions: back (mobile) + edit / archive */}
                <div className="relative flex items-center justify-between flex-shrink-0" style={{ padding: "12px 14px 4px" }}>
                  <button className="lg:hidden flex items-center gap-1 text-[14px] font-bold" style={{ color: T.tealD, fontFamily: T.display, background: "none", border: "none", cursor: "pointer" }}
                    onClick={() => setSelectedStudentId(null)}>
                    <ArrowLeft size={18} /> {t("myStudents.backBtn")}
                  </button>
                  <div className="hidden lg:block" />
                  <div className="flex gap-1.5">
                    <button onClick={() => openEdit(s)} aria-label={t("common.edit")}
                      style={{ width: 44, height: 44, borderRadius: 12, border: "none", cursor: "pointer", background: "#fff", color: T.sub, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 4px rgba(0,0,0,.06)" }}>
                      <Pencil size={20} />
                    </button>
                    <button onClick={() => s.archived_at ? unarchive(s) : archive(s)} aria-label={s.archived_at ? t("people.unarchiveBtn") : t("people.archiveBtn")}
                      style={{ width: 44, height: 44, borderRadius: 12, border: "none", cursor: "pointer", background: "#fff", color: T.sub, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 4px rgba(0,0,0,.06)" }}>
                      {s.archived_at ? <ArchiveRestore size={20} /> : <Archive size={20} />}
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto" style={{ padding: "6px 16px 0", display: "flex", flexDirection: "column", gap: 14 }}>
                  {/* Hero */}
                  <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "4px 2px 0" }}>
                    <PersonAva name={name} avatarUrl={s.avatar_url} status="none" size={64} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontFamily: T.display, fontWeight: 800, fontSize: 22, letterSpacing: "-.01em", color: T.txt }} className="truncate">{name}</div>
                      {s.email && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                          <span style={{ fontFamily: T.body, fontSize: 15, color: T.sub, minWidth: 0 }} className="truncate">{s.email}</span>
                          <CopyMini value={s.email} label="Email" />
                        </div>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: T.display, fontWeight: 700, fontSize: 13, padding: "2px 10px", borderRadius: 999, background: statusBg, color: statusFg }}>{statusLabel}</span>
                        <span style={{ fontFamily: T.body, fontSize: 14, color: T.sub }}>{s.subject} · {formatPrice(s.price, s.currency)}{t("myStudents.perLessonSuffix")}</span>
                      </div>
                    </div>
                  </div>

                  {/* Debt alert */}
                  {s.unpaid_total > 0 && (
                    <div style={{ borderRadius: 16, padding: 14, background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.32)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontFamily: T.display, fontWeight: 800, fontSize: 16, color: "#B4740B" }}>{t("myStudents.debtLabel", { amount: formatPrice(s.unpaid_total, s.currency) })}</div>
                        <div style={{ fontFamily: T.body, fontSize: 14, color: "#9a7a34", marginTop: 2 }}>{t("myStudents.unpaidLessonsCount", { count: s.unpaid_count })}</div>
                      </div>
                      <button onClick={() => setWalletDialog({ open: true, tutorId: user!.id, studentId: s.id, studentName: name, tutorName: t("common.you"), rate: s.price })}
                        style={{ height: 44, padding: "0 16px", borderRadius: 12, border: "1px solid rgba(245,158,11,.4)", background: "rgba(245,158,11,.2)", color: "#B4740B", fontFamily: T.display, fontWeight: 700, fontSize: 14.5, cursor: "pointer", flexShrink: 0 }}>
                        {t("myStudents.remindBtn")}
                      </button>
                    </div>
                  )}

                  {/* Stats */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div style={{ borderRadius: 16, padding: 14, background: "#fff", border: `1px solid ${T.border}` }}>
                      <div style={{ fontFamily: T.display, fontWeight: 800, fontSize: 26, color: T.txt }}>{(s as any).total_lessons ?? 0}</div>
                      <div style={{ fontFamily: T.body, fontSize: 14, color: T.sub }}>{t("myStudents.totalLessonsLabel")}</div>
                    </div>
                    <div style={{ borderRadius: 16, padding: 14, background: "#fff", border: `1px solid ${T.border}` }}>
                      <div style={{ fontFamily: T.display, fontWeight: 800, fontSize: 19, color: (s as any).next_lesson_at ? T.tealD : T.muted }}>{nextLessonLabel}</div>
                      <div style={{ fontFamily: T.body, fontSize: 14, color: T.sub }}>{t("myStudents.nextLessonLabel")}</div>
                    </div>
                  </div>

                  {/* Wallet package */}
                  {(s.wallet_lessons ?? 0) > 0 && (
                    <div style={{ borderRadius: 16, padding: "13px 15px", background: "#f0fdf9", border: "1px solid rgba(43,191,170,.28)", display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 18 }}>📦</span>
                      <div style={{ fontFamily: T.display, fontWeight: 700, fontSize: 14, color: T.tealD }}>{t("myStudents.walletPackageLabel", { count: s.wallet_lessons })}</div>
                    </div>
                  )}

                  {/* Contacts */}
                  {contacts.length > 0 && (
                    <div>
                      <div style={{ fontFamily: T.display, fontWeight: 700, fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", color: T.sub, margin: "2px 2px 9px" }}>{t("myStudents.contactsSectionLabel")}</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                        {contacts.map((c) => (
                          <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 12, borderRadius: 13, padding: "8px 8px 8px 14px", border: `1px solid ${T.border}`, background: "#fff" }}>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontFamily: T.display, fontWeight: 700, fontSize: 12, letterSpacing: ".05em", textTransform: "uppercase", color: T.muted }}>{c.label}</div>
                              <div style={{ fontFamily: T.body, fontSize: 15.5, color: T.txt, marginTop: 1 }} className="truncate">{c.value}</div>
                            </div>
                            {c.tel && (
                              <a href={`tel:${c.value}`} aria-label={t("myStudents.callAria")} style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", color: T.tealD }}>
                                <Phone size={19} strokeWidth={2} />
                              </a>
                            )}
                            <CopyMini value={c.value as string} label={c.label} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Sticky actions */}
                <div style={{ flexShrink: 0, display: "flex", gap: 10, padding: "12px 16px 16px", borderTop: `1px solid ${T.border}`, background: "#fff" }}>
                  {s.phone && (
                    <a href={`tel:${s.phone}`}
                      style={{ flexShrink: 0, height: 50, padding: "0 18px", borderRadius: 14, border: `1px solid ${T.border}`, background: "#fff", color: T.tealD, fontFamily: T.display, fontWeight: 700, fontSize: 15, textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      <Phone size={18} strokeWidth={2} /> {t("people.call")}
                    </a>
                  )}
                  <button onClick={() => navigate(`/chats?with=${s.id}`)}
                    style={{ flex: 1, height: 50, borderRadius: 14, border: "none", background: `linear-gradient(135deg,${T.teal},${T.tealD})`, color: "#0f0f1a", fontFamily: T.display, fontWeight: 700, fontSize: 15, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 8px 20px -8px rgba(43,191,170,.6)" }}>
                    <MessageCircle size={19} strokeWidth={2} /> {t("people.write")}
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}


      {/* Add/Edit Dialog — design-system SF_A «Один потік» */}
      <Dialog
        open={dialog.open}
        onOpenChange={(v) => !v && setDialog({ open: false, mode: "create", studentId: null })}
      >
        <DialogContent className="w-full max-w-[480px] p-0 gap-0 overflow-hidden rounded-t-[26px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[88vh] flex flex-col [&>button.absolute]:hidden">
          {/* Drag handle (mobile) */}
          <div className="flex justify-center pt-2.5 pb-1 sm:hidden flex-shrink-0">
            <div className="w-9 h-1.5 rounded-full" style={{ background: "rgba(15,15,26,.14)" }} />
          </div>
          {(() => {
            const F = {
              border: "#eceef3", bg: "#fbfbfc", chip: "#F5F4F0", teal: "#2BBFAA", tealD: "#25a896",
              txt: "#0f0f1a", sub: "#9398b0", muted: "#b0b4c8", gold: "#9a6a12",
              display: "Inter, system-ui, sans-serif",
              body: "'Plus Jakarta Sans', system-ui, sans-serif",
            };
            const inp = (big?: boolean): React.CSSProperties => ({
              width: "100%", height: big ? 56 : 50, borderRadius: 13, padding: "0 14px",
              fontSize: big ? 18 : 16, fontWeight: big ? 700 : 500,
              fontFamily: big ? F.display : F.body, color: F.txt, background: F.bg,
              border: `1.5px solid ${F.border}`, outline: "none", boxSizing: "border-box",
              transition: "all .15s",
            });
            const focusOn = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
              e.target.style.borderColor = F.teal;
              e.target.style.boxShadow = "0 0 0 3px rgba(43,191,170,.12)";
              e.target.style.background = "#fff";
            };
            const focusOff = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
              e.target.style.borderColor = F.border;
              e.target.style.boxShadow = "none";
              e.target.style.background = F.bg;
            };
            const lbl: React.CSSProperties = {
              fontFamily: F.display, fontWeight: 700, fontSize: 13, color: F.sub,
              marginBottom: 7, display: "block",
            };
            const close = () => setDialog({ open: false, mode: "create", studentId: null });

            // Subjects ↔ the existing single `subject` string (comma-joined, queries untouched)
            const subjList = form.subject.split(",").map((s) => s.trim()).filter(Boolean);
            const setSubjects = (arr: string[]) => setForm((f) => ({ ...f, subject: arr.join(", ") }));
            const addSubject = (s: string) => {
              const v = s.trim();
              if (v && !subjList.some((x) => x.toLowerCase() === v.toLowerCase())) setSubjects([...subjList, v]);
              setSubjectDraft("");
              setSubjectOpen(false);
            };
            const SUBS = ["Англійська","Математика","Українська","Фізика","Хімія","Німецька","Біологія","Інформатика","Історія","Польська"];
            const subMatches = SUBS.filter(
              (s) => !subjList.some((v) => v.toLowerCase() === s.toLowerCase()) &&
                (!subjectDraft || s.toLowerCase().includes(subjectDraft.trim().toLowerCase()))
            ).slice(0, 6);
            const draftIsCustom = !!subjectDraft.trim() &&
              !SUBS.some((s) => s.toLowerCase() === subjectDraft.trim().toLowerCase());

            const fInit = ((form.first_name?.[0] ?? "") + (form.last_name?.[0] ?? "")).toUpperCase();
            const filled = !!(form.first_name || form.last_name);

            return (
              <>
                {/* ── Header ── */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 20px 12px", flexShrink: 0 }}>
                  <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 21, letterSpacing: "-.01em", color: F.txt }}>
                    {dialog.mode === "create" ? t("myStudents.addDialogTitle") : t("myStudents.editDialogTitle")}
                  </div>
                  <button onClick={close} aria-label={t("myStudents.cancelBtn")}
                    style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, border: "none", background: F.chip, color: F.sub, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <X size={18} />
                  </button>
                </div>

                {/* ── Body (scroll) ── */}
                <div style={{ flex: 1, overflowY: "auto", padding: "4px 20px 14px", display: "flex", flexDirection: "column", gap: 18 }}>
                  {/* Avatar + name */}
                  <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button type="button" aria-label={t("myStudents.studentPhotoAria")}
                          style={{ position: "relative", width: 60, height: 60, borderRadius: 20, flexShrink: 0, padding: 0, cursor: "pointer",
                            border: "none",
                            background: filled ? "linear-gradient(135deg,#2BBFAA,#25a896)" : "#fff",
                            color: filled ? "#0f0f1a" : F.muted,
                            boxShadow: filled ? "0 8px 20px -8px rgba(43,191,170,.55)" : `inset 0 0 0 1.5px ${F.border}`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontFamily: F.display, fontWeight: 800, fontSize: 22,
                            transition: "all .3s cubic-bezier(.34,1.4,.64,1)" }}>
                          {filled ? fInit : (
                            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="8" r="4" /><path d="M5 20a7 7 0 0114 0" />
                            </svg>
                          )}
                          <span style={{ position: "absolute", right: -2, bottom: -2, width: 22, height: 22, borderRadius: 999,
                            background: "linear-gradient(135deg,#2BBFAA,#25a896)", boxShadow: "0 0 0 2.5px #fff",
                            display: "flex", alignItems: "center", justifyContent: "center", color: "#0f0f1a" }}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 8.5A1.5 1.5 0 014.5 7h2L8 5h8l1.5 2h2A1.5 1.5 0 0121 8.5v10A1.5 1.5 0 0119.5 20h-15A1.5 1.5 0 013 18.5z" /><circle cx="12" cy="13" r="3.2" />
                            </svg>
                          </span>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent side="bottom" align="start" className="w-64 text-[13.5px] leading-relaxed" style={{ fontFamily: F.body, color: F.txt }}>
                        {t("myStudents.photoFromProfileHint")}
                      </PopoverContent>
                    </Popover>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                      <input aria-label={t("myStudents.fieldFirstName")} style={inp(true)} placeholder={t("myStudents.fieldFirstName")} value={form.first_name}
                        onChange={(e) => setForm({ ...form, first_name: e.target.value })} onFocus={focusOn} onBlur={focusOff} />
                      <input aria-label={t("myStudents.fieldLastName")} style={inp(false)} placeholder={t("myStudents.fieldLastName")} value={form.last_name}
                        onChange={(e) => setForm({ ...form, last_name: e.target.value })} onFocus={focusOn} onBlur={focusOff} />
                    </div>
                  </div>

                  {/* Subjects — chips */}
                  <div>
                    <span style={lbl}>{t("myStudents.subjectsLabel")} <span style={{ color: F.teal }}>*</span></span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                      {subjList.map((s) => (
                        <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 38, padding: "0 8px 0 14px", borderRadius: 999,
                          background: "#f0fdf9", color: F.tealD, boxShadow: "inset 0 0 0 1px rgba(43,191,170,.3)",
                          fontFamily: F.display, fontWeight: 700, fontSize: 14 }}>
                          {s}
                          <button type="button" onClick={() => setSubjects(subjList.filter((x) => x !== s))} aria-label="✕"
                            style={{ width: 20, height: 20, borderRadius: 999, border: "none", cursor: "pointer", background: "rgba(43,191,170,.18)", color: F.tealD, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <X size={12} strokeWidth={2.4} />
                          </button>
                        </span>
                      ))}
                      <button type="button" onClick={() => { setSubjectOpen((v) => !v); setSubjectDraft(""); }}
                        style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 38, padding: subjList.length ? "0 12px" : "0 15px 0 12px", borderRadius: 999, cursor: "pointer",
                          border: `1.5px ${subjectOpen ? "solid" : "dashed"} ${subjectOpen ? F.teal : F.border}`,
                          background: subjectOpen ? "#f0fdf9" : "#fff", color: subjectOpen ? F.tealD : F.sub,
                          fontFamily: F.display, fontWeight: 700, fontSize: 14 }}>
                        <Plus size={15} strokeWidth={2.4} />{subjList.length ? "" : t("myStudents.addSubjectBtn")}
                      </button>
                    </div>
                    {subjectOpen && (
                      <div style={{ marginTop: 10, padding: 12, borderRadius: 14, background: F.bg, border: `1px solid ${F.border}` }}>
                        <input autoFocus aria-label={t("myStudents.subjectDraftPlaceholder")} value={subjectDraft} onChange={(e) => setSubjectDraft(e.target.value)}
                          placeholder={t("myStudents.subjectDraftPlaceholder")}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSubject(subjectDraft); } }}
                          style={{ ...inp(false), background: "#fff", borderColor: F.teal, boxShadow: "0 0 0 3px rgba(43,191,170,.12)" }} />
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 10 }}>
                          {subMatches.map((s) => (
                            <button key={s} type="button" onClick={() => addSubject(s)}
                              style={{ height: 34, padding: "0 13px", borderRadius: 999, cursor: "pointer", border: `1px dashed ${F.border}`, background: "#fff", color: F.sub, fontFamily: F.body, fontWeight: 600, fontSize: 13.5 }}>
                              {s}
                            </button>
                          ))}
                          {draftIsCustom && (
                            <button type="button" onClick={() => addSubject(subjectDraft)}
                              style={{ height: 34, padding: "0 13px", borderRadius: 999, cursor: "pointer", border: "none", background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", fontFamily: F.display, fontWeight: 700, fontSize: 13.5 }}>
                              + «{subjectDraft.trim()}»
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 💛 Price card */}
                  <div style={{ borderRadius: 16, padding: 14, background: "linear-gradient(135deg,#FFF7E6,#FFEFD0)", border: "1px solid rgba(245,181,68,.4)" }}>
                    <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 13, color: F.gold, marginBottom: 8 }}>{t("myStudents.priceCardTitle")}</div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <input aria-label={t("myStudents.priceCardTitle")} inputMode="decimal" placeholder="500" value={form.price}
                          onChange={(e) => setForm({ ...form, price: e.target.value.replace(/[^\d.]/g, "") })}
                          onFocus={focusOn} onBlur={focusOff} style={{ ...inp(true), background: "#fff" }} />
                      </div>
                      <div style={{ position: "relative", flexShrink: 0 }}>
                        <button type="button" onClick={() => setCurOpen((v) => !v)}
                          style={{ ...inp(false), width: "auto", display: "flex", alignItems: "center", gap: 5, padding: "0 12px", cursor: "pointer", fontFamily: F.display, fontWeight: 800, background: "#fff" }}>
                          <span style={{ color: F.tealD }}>{currencySymbol(form.currency)}</span>{form.currency}
                          <ChevronDown size={15} style={{ color: F.muted, marginLeft: 2 }} />
                        </button>
                        {curOpen && (
                          <>
                            <div onClick={() => setCurOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
                            <div style={{ position: "absolute", top: 56, right: 0, zIndex: 61, background: "#fff", borderRadius: 12, border: `1px solid ${F.border}`, boxShadow: "0 8px 24px -8px rgba(15,15,26,.25)", padding: 5, minWidth: 124 }}>
                              {CURRENCY_OPTIONS.map((c) => (
                                <button key={c.code} type="button" onClick={() => { setForm({ ...form, currency: c.code }); setCurOpen(false); }}
                                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", height: 40, padding: "0 11px", borderRadius: 9, border: "none", cursor: "pointer", textAlign: "left",
                                    background: c.code === form.currency ? "#f0fdf9" : "transparent",
                                    color: c.code === form.currency ? F.tealD : F.txt,
                                    fontFamily: F.display, fontWeight: 700, fontSize: 14.5 }}>
                                  <span style={{ width: 20 }}>{c.symbol}</span>{c.code}
                                  {c.code === form.currency && <Check size={14} strokeWidth={2.4} style={{ marginLeft: "auto", color: F.tealD }} />}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Divider */}
                  <div style={{ height: 1, background: F.border }} />

                  {/* Contacts — placeholders only; email-or-phone validated on submit */}
                  <div>
                    <span style={lbl}>{t("myStudents.contactsLabel")}</span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <input aria-label={t("myStudents.fieldPhone")} type="tel" style={inp(false)} placeholder={t("myStudents.fieldPhone")} value={form.phone}
                        onChange={(e) => setForm({ ...form, phone: e.target.value })} onFocus={focusOn} onBlur={focusOff} />
                      <input aria-label="Email" type="email" style={inp(false)} placeholder="Email" value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })} onFocus={focusOn} onBlur={focusOff} />
                      <input aria-label="Telegram" style={inp(false)} placeholder="Telegram @username" value={form.telegram}
                        onChange={(e) => setForm({ ...form, telegram: e.target.value })} onFocus={focusOn} onBlur={focusOff} />
                    </div>
                  </div>

                  {/* 🔒 Private notes */}
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
                      <span style={{ width: 22, height: 22, borderRadius: 7, background: "rgba(245,181,68,.2)", color: F.gold, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>🔒</span>
                      <span style={{ fontFamily: F.display, fontWeight: 700, fontSize: 13, color: F.sub }}>{t("myStudents.notesLabel")}</span>
                    </div>
                    <textarea rows={3} aria-label={t("myStudents.notesPlaceholder")} value={form.tutor_notes} placeholder={t("myStudents.notesPlaceholder")}
                      onChange={(e) => setForm({ ...form, tutor_notes: e.target.value })}
                      onFocus={(e) => { e.target.style.borderColor = "#F5B544"; e.target.style.boxShadow = "0 0 0 3px rgba(245,181,68,.16)"; e.target.style.background = "#fff"; }}
                      onBlur={(e) => { e.target.style.borderColor = "rgba(245,181,68,.35)"; e.target.style.boxShadow = "none"; e.target.style.background = "#FFFCF4"; }}
                      style={{ width: "100%", borderRadius: 13, padding: "12px 14px", fontSize: 15.5, fontFamily: F.body, color: F.txt, boxSizing: "border-box", outline: "none", resize: "none", lineHeight: 1.5, background: "#FFFCF4", border: "1.5px solid rgba(245,181,68,.35)", transition: "all .15s" }} />
                  </div>
                </div>

                {/* ── Footer ── */}
                <div style={{ flexShrink: 0, padding: "14px 20px 20px", borderTop: `1px solid ${F.border}`, background: "#fff", display: "flex", gap: 10 }}>
                  <button type="button" onClick={close}
                    style={{ height: 52, padding: "0 20px", borderRadius: 14, border: `1px solid ${F.border}`, background: "#fff", color: F.sub, fontFamily: F.display, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
                    {t("myStudents.cancelBtn")}
                  </button>
                  <button type="button" onClick={submit} disabled={submitting}
                    style={{ flex: 1, height: 52, borderRadius: 14, border: "none",
                      background: submitting ? F.muted : "linear-gradient(135deg,#2BBFAA,#25a896)",
                      cursor: submitting ? "not-allowed" : "pointer",
                      fontFamily: F.display, fontWeight: 700, fontSize: 16, color: "#0f0f1a",
                      boxShadow: submitting ? "none" : "0 8px 20px -8px rgba(43,191,170,.6)",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                    {submitting && <Loader2 size={18} className="animate-spin" />}
                    {dialog.mode === "create" ? t("myStudents.addBtn") : t("myStudents.saveBtn")}
                  </button>
                </div>
              </>
            );
          })()}
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
