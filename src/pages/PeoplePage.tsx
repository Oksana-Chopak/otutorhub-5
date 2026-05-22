import { AppLayout } from "@/components/AppLayout";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, AppRole } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { InviteLinkDialog } from "@/components/InviteLinkDialog";
import {
  GraduationCap,
  BookOpen,
  Users as UsersIcon,
  Settings,
  Loader2,
  UserPlus,
  Hourglass,
  Archive,
  ArchiveRestore,
  FlameKindling,
  Send,
  MessageCircle,
  Facebook,
  Instagram,
  CreditCard,
  Pencil,
  Copy,
  ChevronDown,
  MessageSquare,
} from "lucide-react";
import { ManagerNotes } from "@/components/ManagerNotes";
import { ContactEditDialog, ContactFields } from "@/components/ContactEditDialog";
import { RatePropagationDialog } from "@/components/RatePropagationDialog";
import { SubjectMultiSelect } from "@/components/SubjectMultiSelect";
import { UserAvatar } from "@/components/UserAvatar";
import { MobileFilters } from "@/components/MobileFilters";
import { computeStudentStatus, studentStatusDotClass } from "@/lib/studentStatus";
import { safeHref } from "@/lib/safeUrl";
import { CURRENCY_OPTIONS, currencySymbol, formatPrice } from "@/lib/currency";
import { SUBJECT_OPTIONS } from "@/lib/subjects";

interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  is_pending: boolean;
  avatar_url: string | null;
  archived_at: string | null;
  created_at: string;
}

interface UserRow {
  id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  phone: string | null;
  email: string | null;
  telegram: string | null;
  messenger_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  // Financial fields from profile_financial_contacts (manager-only)
  bank_card_last4?: string | null;
  bank_name?: string | null;
  is_pending: boolean;
  archived_at: string | null;
  role: AppRole | null;
  rate_per_lesson?: number;
  subjects?: string[];
  last_interaction_at?: string | null;
  // Student-only payment status aggregates
  unpaid_count?: number;
  unpaid_total?: number;
  last_lesson_at?: string | null;
  // Tutor onboarding (manager view)
  created_at?: string;
  has_student?: boolean;
  has_lesson?: boolean;
  has_paid_lesson?: boolean;
}

export default function PeoplePage() {
  const { t } = useTranslation();
  const { user: currentUser, roles } = useAuth();
  const isManager = roles.includes("manager");
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [studentRates, setStudentRates] = useState<
    Array<{ id: string; tutor_id: string; student_id: string; subject: string; price_per_lesson: number; currency: string }>
  >([]);
  // tutor_id -> { subject -> rate }
  const [tutorSubjectRates, setTutorSubjectRates] = useState<Record<string, Record<string, number>>>({});

  // Tutor rate dialog: per-subject rates
  const [tutorDialog, setTutorDialog] = useState<{
    open: boolean;
    userId: string;
    subjects: string[];
    rates: Record<string, string>; // subject -> rate string
  }>({
    open: false,
    userId: "",
    subjects: [],
    rates: {},
  });

  // Student price dialog: now requires subject
  const [studentDialog, setStudentDialog] = useState<{
    open: boolean;
    studentId: string;
    studentName: string;
    tutorId: string;
    tutorName: string;
    subject: string;
    price: string;
    currency: string;
    existingId: string | null;
  }>({ open: false, studentId: "", studentName: "", tutorId: "", tutorName: "", subject: "", price: "", currency: "UAH", existingId: null });

  // Add tutor to student dialog (manager picks tutor + subject + price)
  const [addTutorToStudent, setAddTutorToStudent] = useState<{
    open: boolean;
    studentId: string;
    studentName: string;
    tutorId: string;
    subject: string;
    price: string;
    currency: string;
  }>({ open: false, studentId: "", studentName: "", tutorId: "", subject: "", price: "", currency: "UAH" });

  // Add person dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    role: "student" as AppRole,
    subjects: [] as string[],
  });
  const [adding, setAdding] = useState(false);
  const [invite, setInvite] = useState<{
    open: boolean;
    name: string;
    email: string | null;
    phone: string | null;
    role: "student" | "tutor";
    studentId: string | null;
    emailSent: boolean;
  }>({ open: false, name: "", email: null, phone: null, role: "student", studentId: null, emailSent: false });

  // Contact edit dialog
  const [contactDialog, setContactDialog] = useState<{ open: boolean; user: UserRow | null }>({
    open: false,
    user: null,
  });

  const [propagate, setPropagate] = useState<{
    open: boolean;
    tutorId: string;
    studentId: string;
    subject: string;
    newPrice: number;
    oldPrice: number;
  } | null>(null);

  // Search & filters
  const [searchQuery, setSearchQuery] = useState("");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"active" | "pending" | "archived" | "all" | "onboarding">("all");
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();

  const openChatWith = (userId: string) => {
    navigate(`/chats?with=${userId}`);
  };

  const loadData = async () => {
    setLoading(true);
    const isManager = roles.includes("manager");
    
    const [profilesRes, contactsRes, rolesRes, tutorRes, ratesRes, subjectRatesRes] = await Promise.all([
      supabase.from("profiles").select("id, first_name, last_name, is_pending, avatar_url, archived_at, created_at"),
      supabase
        .from("profile_contacts")
        .select("user_id, phone, email, telegram, messenger_url, facebook_url, instagram_url"),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("tutor_details").select("user_id, rate_per_lesson, subjects"),
      supabase.from("student_rates").select("id, tutor_id, student_id, subject, price_per_lesson, currency"),
      supabase.from("tutor_subject_rates").select("tutor_id, subject, rate_per_lesson"),
    ]);

    // Last interaction: most-recent lesson per participant
    // Also compute student payment-status aggregates (unpaid completed + last lesson date)
    const { data: recentLessons, error: recentLessonsErr } = await supabase
      .from("lessons")
      .select("id, tutor_id, student_id, starts_at, status")
      .order("starts_at", { ascending: false })
      .limit(2000);
    if (recentLessonsErr) {
      console.error("Failed to load recent lessons", recentLessonsErr);
    }
    const lessonIds = (recentLessons ?? []).map((l: any) => l.id);
    const detailsByLesson = new Map<string, { student_payment_status: string | null; student_price: number | null }>();
    if (lessonIds.length > 0) {
      // Chunk to avoid overly long IN clauses
      const chunkSize = 500;
      for (let i = 0; i < lessonIds.length; i += chunkSize) {
        const chunk = lessonIds.slice(i, i + chunkSize);
        const { data: detailsData } = await supabase
          .from("lesson_details")
          .select("lesson_id, student_payment_status, student_price")
          .in("lesson_id", chunk);
        (detailsData ?? []).forEach((d: any) => {
          detailsByLesson.set(d.lesson_id, {
            student_payment_status: d.student_payment_status,
            student_price: d.student_price,
          });
        });
      }
    }

    const lastInteractionMap = new Map<string, string>();
    const studentStatsMap = new Map<
      string,
      { unpaid_count: number; unpaid_total: number; last_lesson_at: string | null }
    >();
    const tutorHasLesson = new Set<string>();
    const tutorHasPaid = new Set<string>();
    (recentLessons ?? []).forEach((l: any) => {
      for (const uid of [l.tutor_id, l.student_id]) {
        if (uid) {
          const cur = lastInteractionMap.get(uid);
          if (!cur || l.starts_at > cur) lastInteractionMap.set(uid, l.starts_at);
        }
      }
      if (l.tutor_id) tutorHasLesson.add(l.tutor_id);
      const det = detailsByLesson.get(l.id);
      const payStatus = det?.student_payment_status ?? null;
      const price = det?.student_price ?? null;
      if (l.tutor_id && payStatus === "paid") tutorHasPaid.add(l.tutor_id);

      const sid = l.student_id;
      if (!sid) return;
      const s = studentStatsMap.get(sid) ?? {
        unpaid_count: 0,
        unpaid_total: 0,
        last_lesson_at: null as string | null,
      };
      if (l.status === "completed" && payStatus === "unpaid") {
        s.unpaid_count += 1;
        s.unpaid_total += Number(price ?? 0);
      }
      if (
        (l.status === "completed" || l.status === "scheduled") &&
        (!s.last_lesson_at || l.starts_at > s.last_lesson_at)
      ) {
        s.last_lesson_at = l.starts_at;
      }
      studentStatsMap.set(sid, s);
    });

    const tutorHasStudent = new Set<string>(((ratesRes.data ?? []) as any[]).map((r) => r.tutor_id));

    let financialData: Array<{ user_id: string; bank_card_last4: string | null; bank_name: string | null }> = [];
    if (isManager) {
      const { data: financialRes } = await supabase
        .from("profile_financial_contacts")
        .select("user_id, bank_card_last4, bank_name");
      financialData = (financialRes ?? []) as any;
    }

    const profiles = (profilesRes.data ?? []) as Profile[];
    const contacts = (contactsRes.data ?? []) as Array<{
      user_id: string;
      phone: string | null;
      email: string | null;
      telegram: string | null;
      messenger_url: string | null;
      facebook_url: string | null;
      instagram_url: string | null;
    }>;
    const contactMap = new Map(contacts.map((c) => [c.user_id, c]));
    
    // Build financial contacts map (only for managers)
    const financialMap = new Map<string, { bank_card_last4: string | null; bank_name: string | null }>();
    financialData.forEach((f) => {
      financialMap.set(f.user_id, { bank_card_last4: f.bank_card_last4, bank_name: f.bank_name });
    });
    
    const rolesArr = (rolesRes.data ?? []) as { user_id: string; role: AppRole }[];
    const tutorMap: Record<string, { rate: number; subjects: string[] }> = {};
    (tutorRes.data ?? []).forEach((t: any) => {
      tutorMap[t.user_id] = { rate: Number(t.rate_per_lesson), subjects: t.subjects ?? [] };
    });
    setStudentRates((ratesRes.data ?? []) as any);

    // Build per-tutor per-subject rates
    const subjectRatesMap: Record<string, Record<string, number>> = {};
    ((subjectRatesRes.data ?? []) as any[]).forEach((sr) => {
      if (!subjectRatesMap[sr.tutor_id]) subjectRatesMap[sr.tutor_id] = {};
      subjectRatesMap[sr.tutor_id][sr.subject] = Number(sr.rate_per_lesson);
    });
    setTutorSubjectRates(subjectRatesMap);

    const merged: UserRow[] = profiles.map((p) => {
      const r = rolesArr.find((x) => x.user_id === p.id);
      const td = tutorMap[p.id];
      const c = contactMap.get(p.id);
      const f = financialMap.get(p.id);
      return {
        id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        avatar_url: p.avatar_url ?? null,
        phone: c?.phone ?? null,
        email: c?.email ?? null,
        telegram: c?.telegram ?? null,
        messenger_url: c?.messenger_url ?? null,
        facebook_url: c?.facebook_url ?? null,
        instagram_url: c?.instagram_url ?? null,
        bank_card_last4: f?.bank_card_last4 ?? null,
        bank_name: f?.bank_name ?? null,
        is_pending: p.is_pending,
        archived_at: p.archived_at ?? null,
        role: r?.role ?? null,
        rate_per_lesson: td?.rate,
        subjects: td?.subjects,
        last_interaction_at: lastInteractionMap.get(p.id) ?? null,
        unpaid_count: studentStatsMap.get(p.id)?.unpaid_count ?? 0,
        unpaid_total: studentStatsMap.get(p.id)?.unpaid_total ?? 0,
        last_lesson_at: studentStatsMap.get(p.id)?.last_lesson_at ?? null,
        created_at: p.created_at,
        has_student: tutorHasStudent.has(p.id),
        has_lesson: tutorHasLesson.has(p.id),
        has_paid_lesson: tutorHasPaid.has(p.id),
      };
    });
    setUsers(merged);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  // Real-time: re-fetch when ghost is merged or new profile/role appears
  useEffect(() => {
    const channel = supabase
      .channel(`people-page-realtime-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "user_roles" }, () => loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "profile_contacts" }, () => loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "student_rates" }, () => loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "tutor_details" }, () => loadData())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const changeRole = async (userId: string, newRole: AppRole) => {
    if (userId === currentUser?.id && newRole !== "manager") {
      toast.error(t("people.cannotRemoveOwnManager"));
      return;
    }
    // Atomic role swap: upsert on user_id (one role per person guaranteed by DB unique constraint)
    const { error: upsertErr } = await supabase
      .from("user_roles")
      .upsert({ user_id: userId, role: newRole }, { onConflict: "user_id" });
    if (upsertErr) {
      console.error("Failed to update role", upsertErr);
      toast.error(t("people.roleUpdateFailed"));
      return;
    }

    if (newRole === "tutor") {
      await supabase.from("tutor_details").upsert({ user_id: userId }, { onConflict: "user_id" });
    } else if (newRole === "student") {
      await supabase.from("student_details").upsert({ user_id: userId }, { onConflict: "user_id" });
    }

    toast.success(t("people.roleUpdated"));
    loadData();
  };

  const saveTutorRate = async () => {
    const subjects = tutorDialog.subjects;
    if (subjects.length === 0) {
      toast.error(t("people.selectAtLeastOneSubject"));
      return;
    }
    // Validate all rates
    const parsed: Array<{ subject: string; rate: number }> = [];
    for (const s of subjects) {
      const raw = (tutorDialog.rates[s] ?? "").trim();
      if (raw === "") {
        toast.error(t("people.enterRateForSubject", { subject: s }));
        return;
      }
      const v = parseFloat(raw);
      if (isNaN(v) || v < 0) {
        toast.error(t("people.invalidRateForSubject", { subject: s }));
        return;
      }
      parsed.push({ subject: s, rate: v });
    }

    // 1. Save subjects list on tutor_details (keep legacy rate_per_lesson = first as fallback)
    const { error: tdErr } = await supabase
      .from("tutor_details")
      .upsert(
        { user_id: tutorDialog.userId, rate_per_lesson: parsed[0].rate, subjects },
        { onConflict: "user_id" }
      );
    if (tdErr) {
      console.error("Failed to save tutor details", tdErr);
      toast.error(t("people.saveFailed"));
      return;
    }

    // 2. Upsert per-subject rates
    const rows = parsed.map((p) => ({
      tutor_id: tutorDialog.userId,
      subject: p.subject,
      rate_per_lesson: p.rate,
    }));
    const { error: srErr } = await supabase
      .from("tutor_subject_rates")
      .upsert(rows, { onConflict: "tutor_id,subject" });
    if (srErr) {
      console.error("Failed to save subject rates", srErr);
      toast.error(t("people.subjectRatesSaveFailed"));
      return;
    }

    // 3. Cleanup: remove rates for subjects no longer assigned
    const { error: delErr } = await supabase
      .from("tutor_subject_rates")
      .delete()
      .eq("tutor_id", tutorDialog.userId)
      .not("subject", "in", `(${subjects.map((s) => `"${s.replace(/"/g, '""')}"`).join(",")})`);
    if (delErr) {
      // Not critical
      console.warn("Failed to cleanup obsolete subject rates", delErr);
    }

    toast.success(t("people.saved"));
    setTutorDialog({ open: false, userId: "", subjects: [], rates: {} });
    loadData();
  };

  const saveStudentPrice = async () => {
    const price = parseFloat(studentDialog.price);
    if (isNaN(price) || price < 0) {
      toast.error(t("people.invalidPrice"));
      return;
    }
    if (!studentDialog.subject) {
      toast.error(t("people.selectSubject"));
      return;
    }
    let oldPrice = 0;
    const isUpdate = !!studentDialog.existingId;
    if (isUpdate) {
      const existing = studentRates.find((r) => r.id === studentDialog.existingId);
      oldPrice = Number(existing?.price_per_lesson ?? 0);
      const { error } = await supabase
        .from("student_rates")
        .update({ price_per_lesson: price, currency: studentDialog.currency || "UAH" })
        .eq("id", studentDialog.existingId);
      if (error) {
        console.error("Failed to update student rate", error);
        toast.error(t("people.saveFailed"));
        return;
      }
    } else {
      const { error } = await supabase.from("student_rates").insert({
        tutor_id: studentDialog.tutorId,
        student_id: studentDialog.studentId,
        subject: studentDialog.subject,
        price_per_lesson: price,
        currency: studentDialog.currency || "UAH",
      });
      if (error) {
        console.error("Failed to insert student rate", error);
        toast.error(t("people.saveFailed"));
        return;
      }
    }
    toast.success(t("people.priceSaved"));
    const propPayload =
      isUpdate && oldPrice !== price
        ? {
            open: true,
            tutorId: studentDialog.tutorId,
            studentId: studentDialog.studentId,
            subject: studentDialog.subject,
            newPrice: price,
            oldPrice,
          }
        : null;
    setStudentDialog({ open: false, studentId: "", studentName: "", tutorId: "", tutorName: "", subject: "", price: "", currency: "UAH", existingId: null });
    if (propPayload) setPropagate(propPayload);
    await ensureTutorSubject(studentDialog.tutorId, studentDialog.subject);
    loadData();
  };

  const ensureTutorSubject = async (tutorId: string, subject: string) => {
    const normalized = subject.trim();
    if (!tutorId || !normalized) return;
    const tutor = users.find((u) => u.id === tutorId && u.role === "tutor");
    const current = tutor?.subjects ?? [];
    if (current.includes(normalized)) return;
    const { error } = await supabase
      .from("tutor_details")
      .upsert({ user_id: tutorId, subjects: [...current, normalized] }, { onConflict: "user_id" });
    if (error) console.warn("Failed to sync tutor subject", error);
  };

  const saveAddTutorToStudent = async () => {
    if (!addTutorToStudent.tutorId) {
      toast.error(t("people.selectTutor"));
      return;
    }
    if (!addTutorToStudent.subject) {
      toast.error(t("people.selectSubject"));
      return;
    }
    const price = Number.parseFloat(addTutorToStudent.price.replace(",", "."));
    if (!Number.isFinite(price) || price < 0) {
      toast.error(t("people.enterValidPrice"));
      return;
    }
    const { error } = await supabase.from("student_rates").upsert(
      {
        tutor_id: addTutorToStudent.tutorId,
        student_id: addTutorToStudent.studentId,
        subject: addTutorToStudent.subject,
        price_per_lesson: price,
        currency: addTutorToStudent.currency || "UAH",
      },
      { onConflict: "tutor_id,student_id,subject" },
    );
    if (error) {
      console.error("Failed to add tutor to student", error);
      toast.error(t("people.addTutorFailed"));
      return;
    }
    await ensureTutorSubject(addTutorToStudent.tutorId, addTutorToStudent.subject);
    toast.success(t("people.tutorAddedToStudent"));
    setAddTutorToStudent({ open: false, studentId: "", studentName: "", tutorId: "", subject: "", price: "", currency: "UAH" });
    loadData();
  };

  const addPerson = async () => {
    const fn = addForm.first_name.trim();
    const ln = addForm.last_name.trim();
    const email = addForm.email.trim().toLowerCase();
    const phone = addForm.phone.trim();
    if (!fn && !ln) {
      toast.error(t("people.nameRequired"));
      return;
    }
    if (!email && !phone) {
      toast.error(t("people.emailOrPhoneRequired"));
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error(t("people.invalidEmail"));
      return;
    }

    setAdding(true);
    // 1. Створюємо ghost-профіль
    const newId = crypto.randomUUID();
    const { error: profErr } = await supabase
      .from("profiles")
      .insert({ id: newId, first_name: fn, last_name: ln, is_pending: true });
    if (profErr) {
      console.error("Failed to create ghost profile", profErr);
      toast.error(profErr.message || t("people.createProfileFailed"));
      setAdding(false);
      return;
    }

    // 2. Контакти
    const { error: contErr } = await supabase
      .from("profile_contacts")
      .insert({ user_id: newId, email: email || null, phone: phone || null });
    if (contErr) {
      console.error("Failed to insert contacts", contErr);
      // rollback ghost
      await supabase.from("profiles").delete().eq("id", newId);
      const msg = String(contErr.message || "");
      if (msg.includes("profile_contacts_email_lower")) {
        toast.error(t("people.emailAlreadyRegistered"));
      } else {
        toast.error(t("people.saveContactsFailed"));
      }
      setAdding(false);
      return;
    }

    // 3. Роль
    const { error: roleErr } = await supabase
      .from("user_roles")
      .insert({ user_id: newId, role: addForm.role });
    if (roleErr) {
      console.error("Failed to assign role", roleErr);
      await supabase.from("profile_contacts").delete().eq("user_id", newId);
      await supabase.from("profiles").delete().eq("id", newId);
      toast.error(t("people.assignRoleFailed"));
      setAdding(false);
      return;
    }

    // 4. Деталі за роллю
    if (addForm.role === "tutor") {
      await supabase
        .from("tutor_details")
        .upsert({ user_id: newId, subjects: addForm.subjects }, { onConflict: "user_id" });
    } else if (addForm.role === "student") {
      await supabase.from("student_details").upsert({ user_id: newId }, { onConflict: "user_id" });
    }

    setAdding(false);
    toast.success(t("people.personAdded"));
    setAddOpen(false);

    // Auto-send email invite to students with email
    let emailSent = false;
    if (addForm.role === "student" && email) {
      const { data: inviteResp, error: inviteErr } = await supabase.functions.invoke(
        "send-student-invite",
        { body: { studentId: newId } }
      );
      if (!inviteErr && (inviteResp as any)?.success) {
        emailSent = true;
        toast.success(t("people.inviteSent"));
      } else if (inviteErr) {
        console.warn("Auto-invite failed", inviteErr);
      }
    }

    // Show invite dialog so the manager can copy/resend the registration link
    setInvite({
      open: true,
      name: `${fn} ${ln}`.trim(),
      email: email || null,
      phone: phone || null,
      role: addForm.role === "tutor" ? "tutor" : "student",
      studentId: addForm.role === "student" ? newId : null,
      emailSent,
    });
    setAddForm({ first_name: "", last_name: "", email: "", phone: "", role: "student", subjects: [] });
    loadData();
  };

  const archivePerson = async (u: UserRow) => {
    if (u.id === currentUser?.id) {
      toast.error(t("people.cannotArchiveOwn"));
      return;
    }
    if (!confirm(t("peoplePage.archiveConfirm", { name: fullName(u) }))) {
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", u.id);
    if (error) {
      console.error("Failed to archive profile", error);
      toast.error(t("people.archiveFailed"));
      return;
    }
    toast.success(t("people.archived"));
    loadData();
  };

  const unarchivePerson = async (u: UserRow) => {
    const { error } = await supabase
      .from("profiles")
      .update({ archived_at: null })
      .eq("id", u.id);
    if (error) {
      console.error("Failed to unarchive profile", error);
      toast.error(t("people.unarchiveFailed"));
      return;
    }
    toast.success(t("people.unarchived"));
    loadData();
  };

  const purgePerson = async (u: UserRow) => {
    if (u.id === currentUser?.id) {
      toast.error(t("people.cannotDeleteOwn"));
      return;
    }
    const name = fullName(u);
    const first = window.confirm(
      t("peoplePage.deleteConfirm", { name })
    );
    if (!first) return;
    const typed = window.prompt(
      t("peoplePage.deleteTypeDELETE")
    );
    if (typed !== "DELETE") {
      toast.info(t("people.deleteCancelled"));
      return;
    }
    const { error } = await supabase.rpc("manager_purge_user", { _user_id: u.id });
    if (error) {
      console.error("Failed to purge user", error);
      toast.error(t("people.deleteFailed", { message: error.message }));
      return;
    }
    toast.success(t("people.deleteSuccess", { name }));
    loadData();
  };

  const fullName = (u: UserRow) => `${u.first_name} ${u.last_name}`.trim() || t("common.noName");

  // Build subject options from all tutors
  const allSubjects = useMemo(() => {
    const set = new Set<string>();
    SUBJECT_OPTIONS.forEach((s) => set.add(s));
    users.forEach((u) => (u.subjects ?? []).forEach((s) => set.add(s)));
    studentRates.forEach((r) => r.subject && set.add(r.subject));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "uk"));
  }, [users, studentRates]);

  // Apply filters once for all sections
  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return users.filter((u) => {
      const isArchived = !!u.archived_at;
      if (statusFilter === "archived") {
        if (!isArchived) return false;
      } else if (statusFilter === "onboarding") {
        if (isArchived) return false;
        if (u.role !== "tutor") return false;
        const done = !!(u.has_student && u.has_lesson && u.has_paid_lesson);
        if (done) return false;
      } else {
        if (isArchived) return false;
        if (statusFilter === "active" && u.is_pending) return false;
        if (statusFilter === "pending" && !u.is_pending) return false;
      }
      if (subjectFilter !== "all") {
        const subjects = u.subjects ?? [];
        if (u.role === "tutor") {
          if (!subjects.includes(subjectFilter)) return false;
        } else if (u.role === "student") {
          // Show student if any of their tutor rates includes that subject
          const has = studentRates.some(
            (r) => r.student_id === u.id && r.subject === subjectFilter
          );
          if (!has) return false;
        } else {
          return false; // managers/no-role hidden when filtering by subject
        }
      }
      if (!q) return true;
      const hay = [
        fullName(u),
        u.email ?? "",
        u.phone ?? "",
        u.telegram ?? "",
        ...(u.subjects ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [users, searchQuery, subjectFilter, statusFilter, studentRates]);

  const sortByRegistration = (a: UserRow, b: UserRow) => {
    const aT = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bT = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (aT !== bT) return bT - aT;
    return fullName(a).localeCompare(fullName(b), "uk");
  };
  const tutors = filteredUsers.filter((u) => u.role === "tutor").sort(sortByRegistration);
  const students = filteredUsers.filter((u) => u.role === "student").sort(sortByRegistration);
  const managers = filteredUsers.filter((u) => u.role === "manager");
  const noRole = filteredUsers.filter((u) => !u.role);
  // Unfiltered tutors list for student-card pricing rows
  const allTutors = useMemo(() => users.filter((u) => u.role === "tutor"), [users]);
  const visiblePeopleCount = noRole.length + managers.length + tutors.length + students.length;

  const renderUserCard = (u: UserRow, accent?: "primary" | "secondary") => {
    const studentSt =
      u.role === "student" && !u.archived_at && !u.is_pending
        ? computeStudentStatus({
            unpaid_count: u.unpaid_count ?? 0,
            unpaid_total: u.unpaid_total ?? 0,
            last_lesson_at: u.last_lesson_at ?? null,
          })
        : null;
    const tutorProgress = isManager && u.role === "tutor" && !u.archived_at
      ? (() => {
          const steps = [
            { ok: !!u.has_student, label: t("people.progressStudents") },
            { ok: !!u.has_lesson, label: t("people.progressLessons") },
            { ok: !!u.has_paid_lesson, label: t("people.progressPayments") },
          ];
          const doneCount = steps.filter((s) => s.ok).length;
          const fmt = (d?: string | null) =>
            d ? new Date(d).toLocaleDateString("uk-UA", { day: "2-digit", month: "short" }) : "—";
          return { steps, doneCount, fmt };
        })()
      : null;
    const isExpanded = !!expandedCards[u.id];
    const canChat = !!currentUser && u.id !== currentUser.id && !u.is_pending && !u.archived_at;
    const toggleExpanded = () =>
      setExpandedCards((prev) => ({ ...prev, [u.id]: !prev[u.id] }));
    return (
    <div
      key={u.id}
      className={`rounded-lg border bg-card p-3 sm:p-4 ${
        u.archived_at
          ? "border-border opacity-70"
          : u.is_pending
            ? "border-warning/40 bg-warning/5"
            : "border-border"
      }`}
    >
      <div className={`flex items-start justify-between gap-2 lg:items-center ${isExpanded ? "mb-3" : ""}`}>
        <button
          type="button"
          onClick={toggleExpanded}
          className="flex min-w-0 flex-1 items-center gap-3 text-left lg:gap-4"
          aria-expanded={isExpanded}
          aria-label={isExpanded ? t("people.collapseCard") : t("people.expandCard")}
        >
          <div className="relative shrink-0">
            {u.is_pending ? (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-warning/20 text-warning">
                <Hourglass className="h-4 w-4" />
              </div>
            ) : (
              <UserAvatar
                url={u.avatar_url}
                firstName={u.first_name}
                lastName={u.last_name}
                className={`h-10 w-10 lg:h-12 lg:w-12 ${
                  accent === "primary" ? "ring-2 ring-primary/30" : ""
                }`}
              />
            )}
            {studentSt && (
              <span
                title={studentSt.label}
                className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card ${studentStatusDotClass[studentSt.status]}`}
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="max-w-full overflow-visible text-sm font-medium text-foreground lg:text-base lg:whitespace-normal lg:text-clip">
                {fullName(u)}
              </p>
              {u.is_pending && (
                <Badge variant="outline" className="border-warning/40 text-warning text-[10px] px-1.5 py-0">
                  {t("people.pendingBadge")}
                </Badge>
              )}
              {u.archived_at && (
                <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground text-[10px] px-1.5 py-0">
                  {t("people.archivedBadge")}
                </Badge>
              )}
              {studentSt && (studentSt.status === "debt" || studentSt.status === "inactive") && (
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 ${
                    studentSt.status === "debt"
                      ? "border-warning/40 text-warning"
                      : "border-destructive/40 text-destructive"
                  }`}
                >
                  {studentSt.label}
                </Badge>
              )}
            </div>
            {(u.email || u.phone) && (
              <p className="break-words text-xs text-muted-foreground lg:text-sm">
                {[u.email, u.phone].filter(Boolean).join(" · ")}
              </p>
            )}
            {isExpanded && u.role === "tutor" && u.subjects && u.subjects.length > 0 && (
              <div className="mt-1 space-y-0.5">
                {u.subjects.map((s) => {
                  const r = tutorSubjectRates[u.id]?.[s];
                  return (
                    <p key={s} className="break-words text-xs text-muted-foreground">
                      <span className="text-foreground">{s}</span>
                      {r !== undefined && r > 0 ? ` — ${r} ₴${t("myStudents.perLesson")}` : ""}
                    </p>
                  );
                })}
              </div>
            )}
          </div>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {canChat && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-primary"
              onClick={(e) => {
                e.stopPropagation();
                openChatWith(u.id);
              }}
              title={t("people.writeBtn")}
              aria-label={t("people.writeBtn")}
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
          )}
          {isExpanded && isManager && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                setContactDialog({ open: true, user: u });
              }}
              title={t("people.editContactsBtn")}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {isExpanded && isManager && u.id !== currentUser?.id && (
            <>
              {u.archived_at ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    unarchivePerson(u);
                  }}
                  title={t("people.unarchiveBtn")}
                >
                  <ArchiveRestore className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    archivePerson(u);
                  }}
                  title={t("people.archiveBtn")}
                >
                  <Archive className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  purgePerson(u);
                }}
                title={t("people.deleteBtn")}
              >
                <FlameKindling className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          <button
            type="button"
            onClick={toggleExpanded}
            className="ml-0.5 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={isExpanded ? t("people.collapse") : t("people.expand")}
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {isExpanded && (<div>

      {(u.telegram || u.messenger_url || u.facebook_url || u.instagram_url || u.bank_card_last4) && (
        <div className="flex flex-wrap items-center gap-2 mb-3 text-muted-foreground">
          {u.telegram && (
            <a
              href={`https://t.me/${u.telegram.replace(/^@/, "")}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs hover:text-primary transition-colors"
              title={`Telegram: @${u.telegram.replace(/^@/, "")}`}
            >
              <Send className="h-3 w-3" />
              <span className="truncate max-w-[80px]">@{u.telegram.replace(/^@/, "")}</span>
            </a>
          )}
          {u.messenger_url && (
            <a
              href={safeHref(u.messenger_url)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs hover:text-primary transition-colors"
              title="Messenger"
            >
              <MessageCircle className="h-3 w-3" />
            </a>
          )}
          {u.facebook_url && (
            <a
              href={safeHref(u.facebook_url)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs hover:text-primary transition-colors"
              title="Facebook"
            >
              <Facebook className="h-3 w-3" />
            </a>
          )}
          {u.instagram_url && (
            <a
              href={safeHref(u.instagram_url)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs hover:text-primary transition-colors"
              title="Instagram"
            >
              <Instagram className="h-3 w-3" />
            </a>
          )}
          {u.bank_card_last4 && (
            <span
              className="inline-flex items-center gap-1 text-xs"
              title={u.bank_name ? `${u.bank_name} •••• ${u.bank_card_last4}` : `${t("people.card")} •••• ${u.bank_card_last4}`}
            >
              <CreditCard className="h-3 w-3" />
              <span className="font-mono">
                {u.bank_name ? `${u.bank_name} ` : ""}•••• {u.bank_card_last4}
              </span>
            </span>
          )}
        </div>
      )}
      <div className="mb-2 flex min-w-0 items-center gap-2 lg:max-w-md">
        <Label className="text-xs text-muted-foreground shrink-0">{t("people.roleLabel")}</Label>
        <Select value={u.role ?? ""} onValueChange={(v) => changeRole(u.id, v as AppRole)}>
          <SelectTrigger className="h-8 min-w-0 text-xs">
            <SelectValue placeholder={t("people.noRoleOption")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manager">{t("roles.manager")}</SelectItem>
            <SelectItem value="tutor">{t("roles.tutor")}</SelectItem>
            <SelectItem value="student">{t("roles.student")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {tutorProgress && (
        <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("people.progressTitle", { done: tutorProgress.doneCount })}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {t("people.progressRegistered")}: {tutorProgress.fmt(u.created_at)}
              {u.last_interaction_at && ` · ${t("people.progressActive")}: ${tutorProgress.fmt(u.last_interaction_at)}`}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {tutorProgress.steps.map((s) => (
              <div
                key={s.label}
                className={`flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs ${
                  s.ok ? "bg-success/10 text-success" : "bg-background text-muted-foreground"
                }`}
              >
                <span className="shrink-0 text-[11px]">{s.ok ? "✓" : "○"}</span>
                <span className="truncate">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {u.role === "tutor" && (
        <Button
          variant="outline"
          size="sm"
          className="w-full mt-2"
          onClick={() => {
            const subjects = u.subjects ?? [];
            const rates: Record<string, string> = {};
            subjects.forEach((s) => {
              const r = tutorSubjectRates[u.id]?.[s];
              rates[s] = r !== undefined ? String(r) : "";
            });
            setTutorDialog({
              open: true,
              userId: u.id,
              subjects,
              rates,
            });
          }}
        >
          <Settings className="h-3.5 w-3.5 mr-2" />
          {t("people.tutorRateBtn")}
        </Button>
      )}

      {u.role === "student" && (() => {
        // Only show tutors that actually work with this student (have at least one rate set)
        const linkedTutorIds = new Set(
          studentRates.filter((r) => r.student_id === u.id).map((r) => r.tutor_id)
        );
        const linkedTutors = allTutors.filter((t) => linkedTutorIds.has(t.id));
        const openAddTutor = () =>
          setAddTutorToStudent({
            open: true,
            studentId: u.id,
            studentName: fullName(u),
            tutorId: "",
            subject: "",
            price: "",
            currency: "UAH",
          });
        const hasAnyTutor = allTutors.length > 0;
        return (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                {linkedTutors.length === 0
                  ? t("people.noTutorAssigned")
                  : t("people.priceByPair")}
              </p>
              {isManager && hasAnyTutor && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-full px-2 text-xs sm:w-auto"
                  onClick={openAddTutor}
                >
                  <UserPlus className="h-3.5 w-3.5 mr-1" />
                  {t("people.addTutorBtn")}
                </Button>
              )}
            </div>
            {linkedTutors.length === 0 ? (
              !hasAnyTutor && (
                <p className="text-xs text-muted-foreground italic">
                  {t("people.addFirstTutor")}
                </p>
              )
            ) : (
              <div className="space-y-2">
              {linkedTutors.map((tutor) => {
                  const tSubjects = Array.from(
                    new Set([
                      ...(tutor.subjects ?? []),
                      ...studentRates
                        .filter((r) => r.tutor_id === tutor.id && r.student_id === u.id)
                        .map((r) => r.subject),
                    ].filter(Boolean)),
                  );
                  if (tSubjects.length === 0) return null;
                  return (
                    <div key={tutor.id} className="space-y-1">
                      <p className="text-xs font-medium text-foreground lg:text-sm">{fullName(tutor)}</p>
                      {tSubjects.map((subj) => {
                        const rate = studentRates.find(
                          (r) => r.tutor_id === tutor.id && r.student_id === u.id && r.subject === subj
                        );
                        return (
                          <div key={subj} className="flex min-w-0 items-center justify-between gap-2 pl-2 text-xs">
                            <span className="min-w-0 flex-1 break-words text-muted-foreground">{subj}</span>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="font-medium text-foreground">
                                {rate ? formatPrice(rate.price_per_lesson, rate.currency) : <span className="text-muted-foreground italic">{t("people.notSet")}</span>}
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                onClick={() =>
                                  setStudentDialog({
                                    open: true,
                                    studentId: u.id,
                                    studentName: fullName(u),
                                    tutorId: tutor.id,
                                    tutorName: fullName(tutor),
                                    subject: subj,
                                    price: rate ? String(rate.price_per_lesson) : "",
                                    currency: rate?.currency ?? "UAH",
                                    existingId: rate?.id ?? null,
                                  })
                                }
                              >
                                {t("people.changeBtn")}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

          {isManager && currentUser && <ManagerNotes subjectUserId={u.id} currentUserId={currentUser.id} compact />}
      </div>)}
    </div>
    );
  };

  return (
    <AppLayout>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="hidden font-display text-2xl font-bold text-foreground lg:block">{t("people.title")}</h1>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground sm:text-sm">
            {t("people.subtitle")}
          </p>
        </div>
        {isManager && (
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="shrink-0">
                <UserPlus className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">{t("people.addPerson")}</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-[90vh] flex flex-col">
              <DialogHeader>
                <DialogTitle>{t("people.dialogAddTitle")}</DialogTitle>
                <DialogDescription>
                  {t("people.dialogAddDesc")}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2 overflow-y-auto flex-1 -mx-1 px-1 min-h-0">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="fn">{t("people.fieldFirstName")}</Label>
                    <Input
                      id="fn"
                      value={addForm.first_name}
                      onChange={(e) => setAddForm((f) => ({ ...f, first_name: e.target.value }))}
                      maxLength={50}
                    />
                  </div>
                  <div>
                    <Label htmlFor="ln">{t("people.fieldLastName")}</Label>
                    <Input
                      id="ln"
                      value={addForm.last_name}
                      onChange={(e) => setAddForm((f) => ({ ...f, last_name: e.target.value }))}
                      maxLength={50}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="em">{t("common.email")}</Label>
                  <Input
                    id="em"
                    type="email"
                    value={addForm.email}
                    onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="napriklad@mail.com"
                    maxLength={255}
                  />
                </div>
                <div>
                  <Label htmlFor="ph">{t("common.phone")}</Label>
                  <Input
                    id="ph"
                    type="tel"
                    value={addForm.phone}
                    onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="+380..."
                    maxLength={32}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("people.ghostHint")}
                </p>
                <div>
                  <Label>{t("people.fieldRole")}</Label>
                  <Select
                    value={addForm.role}
                    onValueChange={(v) => setAddForm((f) => ({ ...f, role: v as AppRole }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="student">{t("roles.student")}</SelectItem>
                      <SelectItem value="tutor">{t("roles.tutor")}</SelectItem>
                      <SelectItem value="manager">{t("roles.manager")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {addForm.role === "tutor" && (
                  <div>
                    <Label>{t("people.fieldSubjects")}</Label>
                    <p className="text-xs text-muted-foreground mb-2">{t("people.oneOrMore")}</p>
                    <SubjectMultiSelect
                      value={addForm.subjects}
                      onChange={(next) => setAddForm((f) => ({ ...f, subjects: next }))}
                    />
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddOpen(false)} disabled={adding}>
                  {t("people.cancelBtn")}
                </Button>
                <Button onClick={addPerson} disabled={adding}>
                  {adding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {t("people.addBtn")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Search + filters (filters collapse on mobile) */}
      {!loading && (
        <div className="mb-4 flex min-w-0 items-center gap-2 lg:mb-5">
          <Input
            placeholder={t("people.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 min-w-0 flex-1"
          />
          <MobileFilters
            compact
            align="right"
            className="shrink-0"
            activeCount={
              (subjectFilter !== "all" ? 1 : 0) + (statusFilter !== "all" ? 1 : 0)
            }
          >
            <div className="w-full lg:w-48">
              <Select value={subjectFilter} onValueChange={setSubjectFilter}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={t("people.allSubjects")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("people.allSubjects")}</SelectItem>
                  {allSubjects.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-full lg:w-44">
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={t("common.status")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t("people.statusActive")}</SelectItem>
                  <SelectItem value="pending">{t("people.statusPending")}</SelectItem>
                  <SelectItem value="onboarding">{t("people.statusOnboarding")}</SelectItem>
                  <SelectItem value="archived">{t("people.statusArchived")}</SelectItem>
                  <SelectItem value="all">{t("people.statusAll")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </MobileFilters>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {visiblePeopleCount === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("people.nothingFound")}</p>
          )}

          {noRole.length > 0 && (
            <section className="mb-8">
              <h2 className="font-display text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                <UsersIcon className="h-5 w-5 text-warning" />
                {t("people.sectionNoRole", { count: noRole.length })}
              </h2>
              <div className="grid gap-3 lg:grid-cols-2 lg:gap-4 xl:grid-cols-3">
                {noRole.map((u) => renderUserCard(u))}
              </div>
            </section>
          )}

          {managers.length > 0 && (
          <section className="mb-8">
            <h2 className="font-display text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <UsersIcon className="h-5 w-5 text-primary" />
              {t("people.sectionManagers", { count: managers.length })}
            </h2>
            <div className="grid gap-3 lg:grid-cols-2 lg:gap-4 xl:grid-cols-3">
              {managers.map((u) => renderUserCard(u, "primary"))}
            </div>
          </section>
          )}

          {tutors.length > 0 && (
          <section className="mb-8">
            <h2 className="font-display text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-primary" />
              {t("people.sectionTutors", { count: tutors.length })}
            </h2>
            <div className="grid gap-3 lg:grid-cols-2 lg:gap-4 xl:grid-cols-3">
              {tutors.map((u) => renderUserCard(u, "primary"))}
            </div>
          </section>
          )}

          {students.length > 0 && (
          <section className="mb-8">
            <h2 className="font-display text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary" />
              {t("people.sectionStudents", { count: students.length })}
            </h2>
            <div className="grid gap-3 lg:grid-cols-2 lg:gap-4 xl:grid-cols-3">
              {students.map((u) => renderUserCard(u))}
            </div>
          </section>
          )}
        </>
      )}

      {/* Tutor rate dialog */}
      <Dialog open={tutorDialog.open} onOpenChange={(o) => setTutorDialog((s) => ({ ...s, open: o }))}>
        <DialogContent className="max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t("people.dialogTutorRateTitle")}</DialogTitle>
            <DialogDescription>
              {t("people.dialogTutorRateDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2 overflow-y-auto flex-1 -mx-1 px-1 min-h-0">
            <div>
              <Label>{t("people.fieldSubjects")}</Label>
              <p className="text-xs text-muted-foreground mb-2">{t("people.clickToSelect")}</p>
              <SubjectMultiSelect
                value={tutorDialog.subjects}
                onChange={(next) =>
                  setTutorDialog((s) => {
                    // Preserve existing rate inputs for kept subjects, init empty for new ones
                    const nextRates: Record<string, string> = {};
                    next.forEach((subj) => {
                      nextRates[subj] = s.rates[subj] ?? "";
                    });
                    return { ...s, subjects: next, rates: nextRates };
                  })
                }
              />
            </div>

            {tutorDialog.subjects.length > 0 && (
              <div className="space-y-2">
                <Label>{t("people.ratePerSubject")}</Label>
                <p className="text-xs text-muted-foreground">
                  {t("people.ratePerSubjectDesc")}
                </p>
                <div className="space-y-2">
                  {tutorDialog.subjects.map((subj) => (
                    <div key={subj} className="flex items-center gap-2">
                      <span className="text-sm text-foreground flex-1 truncate">{subj}</span>
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        className="w-28"
                        value={tutorDialog.rates[subj] ?? ""}
                        onChange={(e) =>
                          setTutorDialog((s) => ({
                            ...s,
                            rates: { ...s.rates, [subj]: e.target.value },
                          }))
                        }
                        placeholder={t("people.ratePlaceholder")}
                      />
                      <span className="text-xs text-muted-foreground">₴</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTutorDialog((s) => ({ ...s, open: false }))}>
              {t("people.cancelBtn")}
            </Button>
            <Button onClick={saveTutorRate}>{t("people.saveBtn")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Student price dialog */}
      <Dialog open={studentDialog.open} onOpenChange={(o) => setStudentDialog((s) => ({ ...s, open: o }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("people.dialogStudentPriceTitle")}</DialogTitle>
            <DialogDescription>
              {t("people.dialogStudentPriceDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="text-sm text-muted-foreground space-y-1">
              <p>{t("people.labelStudent")} <span className="font-medium text-foreground">{studentDialog.studentName}</span></p>
              <p>{t("people.labelTutor")} <span className="font-medium text-foreground">{studentDialog.tutorName}</span></p>
              <p>{t("people.labelSubject")} <span className="font-medium text-foreground">{studentDialog.subject}</span></p>
              {(() => {
                const tutorRate = tutorSubjectRates[studentDialog.tutorId]?.[studentDialog.subject];
                if (tutorRate !== undefined && tutorRate > 0) {
                  return (
                    <p className="text-xs">
                      {t("people.tutorRateForSubject")} <span className="font-medium text-foreground">{tutorRate} ₴</span>
                    </p>
                  );
                }
                return null;
              })()}
            </div>
            <div>
              <Label htmlFor="price">{t("people.pricePerLesson", { currency: currencySymbol(studentDialog.currency) })}</Label>
              <div className="grid grid-cols-[1fr_8rem] gap-2">
                <Input
                  id="price"
                  type="number"
                  min="0"
                  step="any"
                  value={studentDialog.price}
                  onChange={(e) => setStudentDialog((s) => ({ ...s, price: e.target.value }))}
                  placeholder={t("people.pricePlaceholder")}
                />
                <Select
                  value={studentDialog.currency}
                  onValueChange={(v) => setStudentDialog((s) => ({ ...s, currency: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCY_OPTIONS.map((c) => (
                      <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStudentDialog((s) => ({ ...s, open: false }))}>
              {t("people.cancelBtn")}
            </Button>
            <Button onClick={saveStudentPrice}>{t("people.saveBtn")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add tutor to student dialog */}
      <Dialog
        open={addTutorToStudent.open}
        onOpenChange={(o) => setAddTutorToStudent((s) => ({ ...s, open: o }))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("people.dialogAddTutorTitle")}</DialogTitle>
            <DialogDescription>
              {t("people.dialogAddTutorDesc", { name: addTutorToStudent.studentName })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>{t("roles.tutor")}</Label>
              <Select
                value={addTutorToStudent.tutorId}
                onValueChange={(v) =>
                  setAddTutorToStudent((s) => ({ ...s, tutorId: v, subject: "" }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("people.selectTutorPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {allTutors
                    .map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {fullName(t)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            {addTutorToStudent.tutorId && (() => {
              const tutor = allTutors.find((t) => t.id === addTutorToStudent.tutorId);
              const tutorSubjects = tutor?.subjects ?? [];
              const tSubjects = tutorSubjects.length > 0 ? tutorSubjects : allSubjects;
              const takenSubjects = new Set(
                studentRates
                  .filter(
                    (r) =>
                      r.tutor_id === addTutorToStudent.tutorId &&
                      r.student_id === addTutorToStudent.studentId,
                  )
                  .map((r) => r.subject),
              );
              const availableSubjects = tSubjects.filter((s) => !takenSubjects.has(s));
              if (availableSubjects.length === 0) {
                return (
                  <p className="text-xs text-muted-foreground italic">
                    {t("people.allSubjectsAdded")}
                  </p>
                );
              }
              return (
                <>
                  <div>
                    <Label>{t("people.labelSubject").replace(":", "")}</Label>
                    <Select
                      value={addTutorToStudent.subject}
                      onValueChange={(v) => {
                        const tutorRate = tutorSubjectRates[addTutorToStudent.tutorId]?.[v];
                        setAddTutorToStudent((s) => ({
                          ...s,
                          subject: v,
                          price: s.price || (tutorRate ? String(tutorRate) : ""),
                        }));
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("people.selectSubjectPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {availableSubjects.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {addTutorToStudent.subject && (() => {
                    const tutorRate =
                      tutorSubjectRates[addTutorToStudent.tutorId]?.[addTutorToStudent.subject];
                    if (tutorRate !== undefined && tutorRate > 0) {
                      return (
                        <p className="text-xs text-muted-foreground">
                          {t("people.tutorRateForSubject")}{" "}
                          <span className="font-medium text-foreground">{tutorRate} ₴</span>
                        </p>
                      );
                    }
                    return null;
                  })()}
                  <div>
                    <Label htmlFor="add-tutor-price">{t("people.priceForStudent", { currency: currencySymbol(addTutorToStudent.currency) })}</Label>
                    <div className="grid grid-cols-[1fr_8rem] gap-2">
                      <Input
                        id="add-tutor-price"
                        type="number"
                        min="0"
                        step="any"
                        value={addTutorToStudent.price}
                        onChange={(e) =>
                          setAddTutorToStudent((s) => ({ ...s, price: e.target.value }))
                        }
                        placeholder={t("people.pricePlaceholder")}
                      />
                      <Select
                        value={addTutorToStudent.currency}
                        onValueChange={(v) => setAddTutorToStudent((s) => ({ ...s, currency: v }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CURRENCY_OPTIONS.map((c) => (
                            <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddTutorToStudent((s) => ({ ...s, open: false }))}
            >
              {t("people.cancelBtn")}
            </Button>
            <Button onClick={saveAddTutorToStudent}>{t("people.addBtn")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {contactDialog.user && (
        <ContactEditDialog
          open={contactDialog.open}
          onOpenChange={(o) => setContactDialog((s) => ({ ...s, open: o }))}
          userId={contactDialog.user.id}
          userName={fullName(contactDialog.user)}
          initial={{
            email: contactDialog.user.email,
            phone: contactDialog.user.phone,
            telegram: contactDialog.user.telegram,
            messenger_url: contactDialog.user.messenger_url,
            facebook_url: contactDialog.user.facebook_url,
            instagram_url: contactDialog.user.instagram_url,
            bank_card_last4: contactDialog.user.bank_card_last4,
            bank_name: contactDialog.user.bank_name,
          }}
          onSaved={loadData}
        />
      )}

      <InviteLinkDialog
        open={invite.open}
        onOpenChange={(v) => setInvite((prev) => ({ ...prev, open: v }))}
        personName={invite.name}
        email={invite.email}
        phone={invite.phone}
        role={invite.role}
        studentId={invite.studentId}
        emailSent={invite.emailSent}
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
          onDone={loadData}
        />
      )}
    </AppLayout>
  );
}
