import { PageFAB } from "@/components/PageFAB";
import { getLocale } from "@/lib/locale";
import { PeopleSkeleton } from "@/components/PageSkeletons";
import { AppLayout } from "@/components/AppLayout";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { confirmDialog } from "@/hooks/useConfirm";
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
  Menu,
  Mail,
  Phone,
  X,
  Wallet,
  Tag,
  Search,
} from "lucide-react";
import { ManagerNotes } from "@/components/ManagerNotes";
import { PersonEditSheet } from "@/components/PersonEditSheet";
import { WalletDialog } from "@/components/WalletDialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
} from "@/components/ui/sheet";
import { RatePropagationDialog } from "@/components/RatePropagationDialog";
import { SubjectMultiSelect } from "@/components/SubjectMultiSelect";
import { UserAvatar } from "@/components/UserAvatar";
import { MobileFilters } from "@/components/MobileFilters";
import { computeStudentStatus, studentStatusDotClass } from "@/lib/studentStatus";
import { safeHref } from "@/lib/safeUrl";
import { CURRENCY_OPTIONS, currencySymbol, formatPrice } from "@/lib/currency";
import { SUBJECT_OPTIONS } from "@/lib/subjects";
import { PayoutScheduleCard } from "@/components/PayoutScheduleCard";

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
  const [activeRoleTab, setActiveRoleTab] = useState<"tutors" | "students" | "managers">("tutors");
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

  // ✏️ Edit → the ONE canonical person form (PersonEditSheet, SF_A «Один потік»
  // design ТЗ: ✏️ → форма). Every role (student / tutor / manager) edits through
  // the same sheet — no separate contacts-only ContactEditDialog.
  const [personEdit, setPersonEdit] = useState<{ open: boolean; user: UserRow | null }>({
    open: false,
    user: null,
  });
  const openEditFor = (u: UserRow) => setPersonEdit({ open: true, user: u });

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
  const [searchOpen, setSearchOpen] = useState(false);
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"active" | "pending" | "archived" | "all" | "onboarding" | "debt">("all");
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [selectedPerson, setSelectedPerson] = useState<UserRow | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletPair, setWalletPair] = useState<{ student: UserRow; tutorId: string; tutorName: string } | null>(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Open the add-person sheet with a preselected role (defaults to the active
  // tab when called from the FAB; honours a ?add=tutor|student deep-link).
  const openAddSheet = (role: AppRole) => {
    setAddForm({ first_name: "", last_name: "", email: "", phone: "", role, subjects: [] });
    setAddOpen(true);
  };

  const openChatWith = (userId: string) => {
    navigate(`/chats?with=${userId}`);
  };

  const loadData = async () => {
    setLoading(true);
    const isManager = roles.includes("manager");
    
    const [profilesRes, contactsRes, rolesRes, tutorRes, ratesRes, subjectRatesRes, recentLessonsRes] = await Promise.all([
      supabase.from("profiles").select("id, first_name, last_name, is_pending, avatar_url, archived_at, created_at"),
      supabase
        .from("profile_contacts")
        .select("user_id, phone, email, telegram, messenger_url, facebook_url, instagram_url"),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("tutor_details").select("user_id, rate_per_lesson, subjects"),
      // Independent tutor rates filtered at RLS level
      supabase.from("student_rates").select("id, tutor_id, student_id, subject, price_per_lesson, currency"),
      supabase.from("tutor_subject_rates").select("tutor_id, subject, rate_per_lesson"),
      // Last interaction + payment aggregates source: independent of the profile batch,
      // so it belongs in the SAME round-trip (was a second serial await = extra latency
      // on every People open). Only lesson_details (below) truly depends on these ids.
      supabase
        .from("lessons")
        .select("id, tutor_id, student_id, starts_at, status")
        .order("starts_at", { ascending: false })
        .limit(2000),
    ]);

    const { data: recentLessons, error: recentLessonsErr } = recentLessonsRes;
    if (recentLessonsErr) {
      console.error("Failed to load recent lessons", recentLessonsErr);
    }
    const lessonIds = (recentLessons ?? []).map((l: any) => l.id);
    const detailsByLesson = new Map<string, { student_payment_status: string | null; student_price: number | null }>();
    if (lessonIds.length > 0) {
      // Chunk to avoid overly long IN clauses, but fire chunks in parallel.
      const chunkSize = 500;
      const chunks: string[][] = [];
      for (let i = 0; i < lessonIds.length; i += chunkSize) {
        chunks.push(lessonIds.slice(i, i + chunkSize));
      }
      // Read student money through the masked lessons_visible view (GRANT-locked on
      // lesson_details); a manager sees the real values for hub lessons here.
      const chunkResults = await Promise.all(
        chunks.map((chunk) =>
          supabase
            .from("lessons_visible")
            .select("id, student_payment_status, student_price")
            .in("id", chunk)
        )
      );
      chunkResults.forEach(({ data: detailsData }) => {
        (detailsData ?? []).forEach((d: any) => {
          detailsByLesson.set(d.id, {
            student_payment_status: d.student_payment_status,
            student_price: d.student_price,
          });
        });
      });
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

  // Deep-link from the dashboard FAB (manager): ?add=tutor|student opens the
  // add-person sheet preset to that role, then strips the param.
  useEffect(() => {
    const add = searchParams.get("add");
    if (add === "tutor" || add === "student") {
      openAddSheet(add);
      if (add === "tutor") setActiveRoleTab("tutors");
      else setActiveRoleTab("students");
      const n = new URLSearchParams(searchParams);
      n.delete("add");
      setSearchParams(n, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh on window focus, but throttle to avoid hammering Postgres on every alt-tab.
  useEffect(() => {
    let lastRun = Date.now();
    const onFocus = () => {
      const now = Date.now();
      if (now - lastRun < 60_000) return; // at most once per minute
      lastRun = now;
      loadData();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
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
    if (!(await confirmDialog({ description: t("peoplePage.archiveConfirm", { name: fullName(u) }) }))) {
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
    if (u.role === "manager") {
      toast.error(t("people.cannotDeleteManager"));
      return;
    }
    const name = fullName(u);
    const confirmed = await confirmDialog({
      title: t("common.delete"),
      description: t("peoplePage.deleteConfirm", { name }),
      requireText: "DELETE",
      requireTextLabel: t("peoplePage.deleteTypeDELETE"),
      confirmText: t("common.delete"),
      destructive: true,
    });
    if (!confirmed) return;
    // Full delete via Edge function (service role): purges data AND removes the
    // auth login so the email is freed (a plain DB RPC cannot touch auth.users).
    const { data, error } = await supabase.functions.invoke("manager-delete-user", {
      body: { targetId: u.id },
    });
    const errMsg = error?.message || (data as { error?: string } | null)?.error;
    if (errMsg) {
      console.error("Failed to delete user", errMsg);
      toast.error(t("people.deleteFailed", { message: errMsg }));
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
      } else if (statusFilter === "debt") {
        // Лише учні з неоплаченими проведеними уроками
        if (isArchived || u.is_pending) return false;
        if (u.role !== "student") return false;
        if ((u.unpaid_count ?? 0) <= 0) return false;
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
            d ? new Date(d).toLocaleDateString(getLocale(), { day: "2-digit", month: "short" }) : "—";
          return { steps, doneCount, fmt };
        })()
      : null;
    const isExpanded = !!expandedCards[u.id];
    const canChat = !!currentUser && u.id !== currentUser.id && !u.is_pending && !u.archived_at;
    const toggleExpanded = () => setSelectedPerson(u);
    return (
    <div
      key={u.id}
      className={`overflow-hidden rounded-[16px] border-[0.5px] bg-white p-3 sm:p-3.5 transition-all cursor-pointer ${
        u.archived_at
          ? "border-border opacity-70"
          : u.is_pending
            ? "border-warning/40 bg-warning/5"
            : "border-border"
      }`}
      onClick={() => setSelectedPerson(u)}
    >
      <div className="flex items-start justify-between gap-2 lg:items-center">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setSelectedPerson(u); }}
          className="flex min-w-0 flex-1 items-center gap-3 text-left lg:gap-4"
          aria-label={t("people.expandCard")}
        >
          <div className="relative shrink-0">
            {u.is_pending ? (
              <div className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-warning/20 text-warning">
                <Hourglass className="h-5 w-5" />
              </div>
            ) : (
              <UserAvatar
                url={u.avatar_url}
                firstName={u.first_name}
                lastName={u.last_name}
                className={`h-[52px] w-[52px] ${
                  accent === "primary" ? "ring-2 ring-primary/30" : ""
                }`}
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="max-w-full overflow-visible text-[18px] font-bold text-foreground">
                {fullName(u)}
              </p>
              {u.is_pending && (
                <Badge variant="outline" className="border-warning/40 text-warning text-[14px] px-1.5 py-0">
                  {t("people.pendingBadge")}
                </Badge>
              )}
              {u.archived_at && (
                <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground text-[14px] px-1.5 py-0">
                  {t("people.archivedBadge")}
                </Badge>
              )}
              {studentSt && studentSt.status === "debt" && (
                <Badge
                  variant="outline"
                  className={`text-[14px] px-1.5 py-0 ${
                    studentSt.status === "debt"
                      ? "border-warning/40 text-warning"
                      : "border-destructive/40 text-destructive"
                  }`}
                >
                  {studentSt.label}
                </Badge>
              )}
            </div>
            {/* Collapsed: show subject·rate for tutors, subject for students, email only for pending */}
            {!isExpanded && (
              <p className="mt-0.5 text-[15px]" style={{ color: "var(--sub, #6b7088)" }}>
                {u.is_pending
                  ? (u.email || u.phone || "")
                  : u.role === "tutor" && u.subjects && u.subjects.length > 0
                    ? (() => {
                        const s = u.subjects[0];
                        const r = tutorSubjectRates[u.id]?.[s];
                        return s + (r && r > 0 ? " · " + r + " ₴" : "");
                      })()
                  : u.role === "student" && u.subjects && u.subjects.length > 0
                    ? u.subjects[0]
                  : (u.email || u.phone || "")
                }
              </p>
            )}
            {isExpanded && (
              <>
                {(u.email || u.phone || u.telegram) && (
                  <div className="mt-1 flex flex-col gap-0.5">
                    {[
                      { v: u.email, label: "email" },
                      { v: u.phone, label: "phone" },
                      { v: u.telegram, label: "telegram" },
                    ].filter((c) => !!c.v).map((c) => (
                      <span key={c.label} className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate text-[15px]" style={{ color: "var(--sub,#6b7088)" }}>{c.v}</span>
                        <button
                          type="button"
                          aria-label={t("people.copyAriaLabel")}
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] transition-colors hover:bg-[#f0fdf9]"
                          style={{ color: "#25a896" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(String(c.v));
                            toast.success(t("people.copied"), { description: String(c.v) });
                          }}
                        >
                          <Copy className="h-[19px] w-[19px]" strokeWidth={2} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {u.role === "tutor" && u.subjects && u.subjects.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {u.subjects.map((s) => {
                      const r = tutorSubjectRates[u.id]?.[s];
                      return (
                        <p key={s} className="break-words text-[15px] text-muted-foreground">
                          <span className="text-foreground">{s}</span>
                          {r !== undefined && r > 0 ? ` — ${r} ₴${t("myStudents.perLesson")}` : ""}
                        </p>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {canChat && (
            <button
              type="button"
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full transition-transform active:scale-95"
              style={{ background: "linear-gradient(135deg,#2BBFAA,#25a896)", boxShadow: "0 8px 20px -8px rgba(43,191,170,.6)", color: "#0f0f1a" }}
              onClick={(e) => { e.stopPropagation(); openChatWith(u.id); }}
              aria-label={t("people.writeBtn")}
            >
              <MessageCircle className="h-[21px] w-[21px]" />
            </button>
          )}
          {isExpanded && isManager && (
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                openEditFor(u);
              }}
              aria-label={t("people.editContactsBtn")}
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
                  className="h-11 w-11 text-muted-foreground hover:text-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    unarchivePerson(u);
                  }}
                  aria-label={t("people.unarchiveBtn")}
                >
                  <ArchiveRestore className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    archivePerson(u);
                  }}
                  aria-label={t("people.archiveBtn")}
                >
                  <Archive className="h-3.5 w-3.5" />
                </Button>
              )}
              {u.role !== "manager" && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    purgePerson(u);
                  }}
                  aria-label={t("people.deleteBtn")}
                >
                  <FlameKindling className="h-3.5 w-3.5" />
                </Button>
              )}
            </>
          )}
          <button
            type="button"
            onClick={toggleExpanded}
            className="ml-0.5 inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={isExpanded ? t("people.collapse") : t("people.expand")}
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

    </div>
    );
  };

  return (
    <AppLayout>
      {/* Header — desktop only; mobile title+bell come from AppLayout */}
      <div className="mb-4 hidden lg:flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold text-foreground">{t("people.title")}</h1>
      </div>

      {/* Search + filters (filters collapse on mobile) */}
      {!loading && (
        <div className="mb-4 flex min-w-0 items-center gap-2 lg:mb-5">
          {searchOpen ? (
            <div className="flex items-center gap-2.5 flex-1 min-w-0" style={{ height: 46, padding: "0 8px 0 14px", borderRadius: 13, background: "#fff", border: "0.5px solid var(--border, #f0f1f5)", boxShadow: "0 1px 4px rgba(0,0,0,.05)" }}>
              <Search size={20} style={{ color: "var(--sub,#6b7088)", flexShrink: 0 }} />
              <input
                autoFocus
                placeholder={t("people.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontFamily: "'Plus Jakarta Sans', system-ui", fontSize: 15, color: "#0f0f1a", minWidth: 0 }}
              />
              <button onClick={() => { setSearchQuery(""); setSearchOpen(false); }} aria-label={t("common.close")}
                style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 999, border: "none", cursor: "pointer", background: "#F5F4F0", color: "var(--sub,#6b7088)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <X size={17} />
              </button>
            </div>
          ) : (
            <button onClick={() => setSearchOpen(true)} aria-label={t("people.searchPlaceholder")}
              style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 999, border: "none", cursor: "pointer", background: "#fff", color: "var(--sub,#6b7088)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 4px rgba(0,0,0,.05)" }}>
              <Search size={21} strokeWidth={2} />
            </button>
          )}
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
                <SelectTrigger className="h-11">
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
                <SelectTrigger className="h-11">
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

      {/* ── ROLE TABS ── */}
      {!loading && (
        <div
          className="mb-1 flex gap-0 border-b"
          style={{ borderColor: "var(--border, #eceef3)" }}
        >
          {(["tutors", "students", "managers"] as const).map((tab) => {
            const counts = { tutors: tutors.length, students: students.length, managers: managers.length };
            const labels = { tutors: t("roles.tutor"), students: t("roles.student"), managers: t("roles.manager") };
            return (
              <button
                key={tab}
                onClick={() => setActiveRoleTab(tab)}
                className="flex-1 pb-2.5 pt-2 text-[14px] transition-colors"
                style={{
                  fontFamily: "Inter, system-ui, sans-serif",
                  fontSize: 14,
                  color: activeRoleTab === tab ? "#1f8e7e" : "var(--sub,#6b7088)",
                  borderBottom: activeRoleTab === tab ? "2px solid #2BBFAA" : "2px solid transparent",
                  fontWeight: activeRoleTab === tab ? 700 : 600,
                }}
              >
                {labels[tab]} {counts[tab] > 0 && counts[tab]}
              </button>
            );
          })}
        </div>
      )}

      {/* ── STATUS PILLS ── */}
      {!loading && (
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
          {[
            { value: "all", label: t("people.statusAll") },
            { value: "active", label: "✅ " + t("people.statusActive") },
            { value: "debt", label: "⚠️ " + t("people.statusDebt") },
            { value: "pending", label: "⏳ " + t("people.statusPending") },
            { value: "archived", label: "📦 " + t("people.statusArchived") },
          ].map((pill) => (
            <button
              key={pill.value}
              onClick={() => setStatusFilter(pill.value as typeof statusFilter)}
              className="shrink-0 rounded-full px-3.5 transition-all"
              style={{
                height: 34,
                fontFamily: "Inter, system-ui, sans-serif",
                fontWeight: 700,
                fontSize: 14,
                background: statusFilter === pill.value ? "#E1F5EE" : "#fff",
                border: `1.5px solid ${statusFilter === pill.value ? "#2BBFAA" : "#eceef3"}`,
                color: statusFilter === pill.value ? "#0F6E56" : "var(--sub,#6b7088)",
              }}
            >
              {pill.label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <PeopleSkeleton />
      ) : (
        <>
          {visiblePeopleCount === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("people.nothingFound")}</p>
          )}

          {/* TAB-BASED RENDERING */}
          {activeRoleTab === "tutors" && (
            <div className="space-y-2.5">
              {[...tutors, ...(statusFilter === "all" ? noRole : [])].length === 0 ? (
                <p className="py-8 text-center text-sm" style={{ color: "var(--sub)" }}>{t("people.nothingFound")}</p>
              ) : (
                [...tutors, ...(statusFilter === "all" ? noRole : [])].map((u) => renderUserCard(u, "primary"))
              )}
            </div>
          )}
          {activeRoleTab === "students" && (
            <div className="space-y-2.5">
              {students.length === 0 ? (
                <p className="py-8 text-center text-sm" style={{ color: "var(--sub)" }}>{t("people.nothingFound")}</p>
              ) : (
                students.map((u) => renderUserCard(u))
              )}
            </div>
          )}
          {activeRoleTab === "managers" && (
            <div className="space-y-2.5">
              {managers.length === 0 ? (
                <p className="py-8 text-center text-sm" style={{ color: "var(--sub)" }}>{t("people.nothingFound")}</p>
              ) : (
                managers.map((u) => renderUserCard(u, "primary"))
              )}
            </div>
          )}
        </>
      )}

      {/* Tutor rate dialog */}
      <Dialog open={tutorDialog.open} onOpenChange={(o) => setTutorDialog((s) => ({ ...s, open: o }))}>
        <DialogContent className="w-full max-w-md p-0 gap-0 rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[92vh] flex flex-col [&>button.absolute]:hidden">
          <div className="flex justify-center pt-2.5 pb-1 sm:hidden flex-shrink-0">
            <div className="h-1 w-9 rounded-full bg-border" />
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "12px 20px 10px", flexShrink: 0 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 20, letterSpacing: "-.01em", color: "#0f0f1a" }}>{t("people.dialogTutorRateTitle")}</div>
              <div style={{ fontSize: 14, color: "var(--sub,#6b7088)", marginTop: 2, lineHeight: 1.4 }}>{t("people.dialogTutorRateDesc")}</div>
            </div>
            <button type="button" onClick={() => setTutorDialog((s) => ({ ...s, open: false }))} aria-label={t("common.close")}
              style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, border: "none", background: "#F5F4F0", color: "var(--sub,#6b7088)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <X size={18} />
            </button>
          </div>
          <div className="space-y-4 overflow-y-auto flex-1 min-h-0" style={{ padding: "4px 20px 14px" }}>
            <div>
              <Label>{t("people.fieldSubjects")}</Label>
              <p className="text-[14px] text-muted-foreground mb-2">{t("people.clickToSelect")}</p>
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
                <p className="text-[14px] text-muted-foreground">
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
                      <span className="text-[14px] text-muted-foreground">₴</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tutorDialog.userId && <PayoutScheduleCard tutorId={tutorDialog.userId} />}
          </div>
          <div style={{ flexShrink: 0, padding: "12px 20px 18px", borderTop: "0.5px solid var(--border, #f0f1f5)", background: "#fff", display: "flex", gap: 10 }}>
            <button type="button" onClick={() => setTutorDialog((s) => ({ ...s, open: false }))}
              style={{ height: 50, padding: "0 18px", borderRadius: 14, border: "1px solid #eceef3", background: "#fff", color: "var(--sub,#6b7088)", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15, cursor: "pointer", flexShrink: 0 }}>
              {t("people.cancelBtn")}
            </button>
            <button type="button" onClick={saveTutorRate}
              style={{ flex: 1, height: 50, borderRadius: 14, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15.5, boxShadow: "0 8px 20px -8px rgba(43,191,170,.6)" }}>
              {t("people.saveBtn")}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Student price dialog */}
      <Dialog open={studentDialog.open} onOpenChange={(o) => setStudentDialog((s) => ({ ...s, open: o }))}>
        <DialogContent className="w-full max-w-md p-0 gap-0 rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[92vh] flex flex-col [&>button.absolute]:hidden">
          <div className="flex justify-center pt-2.5 pb-1 sm:hidden flex-shrink-0">
            <div className="h-1 w-9 rounded-full bg-border" />
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "12px 20px 10px", flexShrink: 0 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 20, letterSpacing: "-.01em", color: "#0f0f1a" }}>{t("people.dialogStudentPriceTitle")}</div>
              <div style={{ fontSize: 14, color: "var(--sub,#6b7088)", marginTop: 2, lineHeight: 1.4 }}>{t("people.dialogStudentPriceDesc")}</div>
            </div>
            <button type="button" onClick={() => setStudentDialog((s) => ({ ...s, open: false }))} aria-label={t("common.close")}
              style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, border: "none", background: "#F5F4F0", color: "var(--sub,#6b7088)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <X size={18} />
            </button>
          </div>
          <div className="space-y-3 overflow-y-auto flex-1 min-h-0" style={{ padding: "4px 20px 14px" }}>
            <div className="text-sm text-muted-foreground space-y-1">
              <p>{t("people.labelStudent")} <span className="font-medium text-foreground">{studentDialog.studentName}</span></p>
              <p>{t("people.labelTutor")} <span className="font-medium text-foreground">{studentDialog.tutorName}</span></p>
              <p>{t("people.labelSubject")} <span className="font-medium text-foreground">{studentDialog.subject}</span></p>
              {(() => {
                const tutorRate = tutorSubjectRates[studentDialog.tutorId]?.[studentDialog.subject];
                if (tutorRate !== undefined && tutorRate > 0) {
                  return (
                    <p className="text-[14px]">
                      {t("people.tutorRateForSubject")} <span className="font-medium text-foreground">{tutorRate} ₴</span>
                    </p>
                  );
                }
                return null;
              })()}
            </div>
            <div style={{ borderRadius: 16, padding: 14, background: "linear-gradient(135deg,#FFF7E6,#FFEFD0)", border: "1px solid rgba(245,181,68,.4)" }}>
              <div style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 14, color: "#9a6a12", marginBottom: 8 }}>
                {t("people.pricePerLesson", { currency: currencySymbol(studentDialog.currency) })}
              </div>
              <div className="grid grid-cols-[1fr_8rem] gap-2">
                <Input
                  id="price"
                  type="number"
                  min="0"
                  step="any"
                  value={studentDialog.price}
                  onChange={(e) => setStudentDialog((s) => ({ ...s, price: e.target.value }))}
                  placeholder={t("people.pricePlaceholder")}
                  className="h-[52px] bg-white text-[18px] font-bold rounded-[13px]"
                  style={{ fontFamily: "Inter, system-ui, sans-serif" }}
                />
                <Select
                  value={studentDialog.currency}
                  onValueChange={(v) => setStudentDialog((s) => ({ ...s, currency: v }))}
                >
                  <SelectTrigger className="h-[52px] bg-white rounded-[13px] font-bold">
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
          <div style={{ flexShrink: 0, padding: "12px 20px 18px", borderTop: "0.5px solid var(--border, #f0f1f5)", background: "#fff", display: "flex", gap: 10 }}>
            <button type="button" onClick={() => setStudentDialog((s) => ({ ...s, open: false }))}
              style={{ height: 50, padding: "0 18px", borderRadius: 14, border: "1px solid #eceef3", background: "#fff", color: "var(--sub,#6b7088)", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15, cursor: "pointer", flexShrink: 0 }}>
              {t("people.cancelBtn")}
            </button>
            <button type="button" onClick={saveStudentPrice}
              style={{ flex: 1, height: 50, borderRadius: 14, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15.5, boxShadow: "0 8px 20px -8px rgba(43,191,170,.6)" }}>
              {t("people.saveBtn")}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add tutor to student dialog */}
      <Dialog
        open={addTutorToStudent.open}
        onOpenChange={(o) => setAddTutorToStudent((s) => ({ ...s, open: o }))}
      >
        <DialogContent className="w-full max-w-md p-0 gap-0 rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[92vh] flex flex-col [&>button.absolute]:hidden">
          <div className="flex justify-center pt-2.5 pb-1 sm:hidden flex-shrink-0">
            <div className="h-1 w-9 rounded-full bg-border" />
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "12px 20px 10px", flexShrink: 0 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 20, letterSpacing: "-.01em", color: "#0f0f1a" }}>{t("people.dialogAddTutorTitle")}</div>
              <div style={{ fontSize: 14, color: "var(--sub,#6b7088)", marginTop: 2, lineHeight: 1.4 }}>{t("people.dialogAddTutorDesc", { name: addTutorToStudent.studentName })}</div>
            </div>
            <button type="button" onClick={() => setAddTutorToStudent((s) => ({ ...s, open: false }))} aria-label={t("common.close")}
              style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, border: "none", background: "#F5F4F0", color: "var(--sub,#6b7088)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <X size={18} />
            </button>
          </div>
          <div className="space-y-3 overflow-y-auto flex-1 min-h-0" style={{ padding: "4px 20px 14px" }}>
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
                  <p className="text-[14px] text-muted-foreground italic">
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
                        <p className="text-[14px] text-muted-foreground">
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
          <div style={{ flexShrink: 0, padding: "12px 20px 18px", borderTop: "0.5px solid var(--border, #f0f1f5)", background: "#fff", display: "flex", gap: 10 }}>
            <button type="button" onClick={() => setAddTutorToStudent((s) => ({ ...s, open: false }))}
              style={{ height: 50, padding: "0 18px", borderRadius: 14, border: "1px solid #eceef3", background: "#fff", color: "var(--sub,#6b7088)", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15, cursor: "pointer", flexShrink: 0 }}>
              {t("people.cancelBtn")}
            </button>
            <button type="button" onClick={saveAddTutorToStudent}
              style={{ flex: 1, height: 50, borderRadius: 14, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15.5, boxShadow: "0 8px 20px -8px rgba(43,191,170,.6)" }}>
              {t("people.addBtn")}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {personEdit.user && (
        <PersonEditSheet
          open={personEdit.open}
          onOpenChange={(o) => setPersonEdit((s) => ({ ...s, open: o }))}
          role={personEdit.user.role}
          person={{
            id: personEdit.user.id,
            first_name: personEdit.user.first_name,
            last_name: personEdit.user.last_name,
            phone: personEdit.user.phone,
            email: personEdit.user.email,
            telegram: personEdit.user.telegram,
            messenger_url: personEdit.user.messenger_url,
            facebook_url: personEdit.user.facebook_url,
            instagram_url: personEdit.user.instagram_url,
            bank_name: personEdit.user.bank_name,
            bank_card_last4: personEdit.user.bank_card_last4,
            subjects: personEdit.user.subjects ?? [],
          }}
          pairs={studentRates.filter((r) => r.student_id === personEdit.user!.id)}
          tutorNameOf={(id) => {
            const tu = users.find((x) => x.id === id);
            return tu ? fullName(tu) : t("shared.tutor");
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

      {/* ── PERSON BOTTOM SHEET ─────────────────────────────────────── */}
      {isManager && (
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogContent className="w-full max-w-md p-0 gap-0 rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[92vh] flex flex-col [&>button.absolute]:hidden">
              <div className="flex justify-center pt-2.5 pb-1 sm:hidden flex-shrink-0">
                <div className="h-1 w-9 rounded-full bg-border" />
              </div>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "12px 20px 10px", flexShrink: 0 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 20, letterSpacing: "-.01em", color: "#0f0f1a" }}>{t("people.dialogAddTitle")}</div>
                  <div style={{ fontSize: 14, color: "var(--sub,#6b7088)", marginTop: 2, lineHeight: 1.4 }}>{t("people.dialogAddDesc")}</div>
                </div>
                <button type="button" onClick={() => setAddOpen(false)} aria-label={t("common.close")}
                  style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, border: "none", background: "#F5F4F0", color: "var(--sub,#6b7088)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <X size={18} />
                </button>
              </div>
              <div className="space-y-3 overflow-y-auto flex-1 min-h-0" style={{ padding: "4px 20px 14px" }}>
                {/* Role is the primary choice — lead with a segmented toggle, not a
                    buried Select, so adding a tutor vs a student is obvious up front. */}
                <div>
                  <Label>{t("people.fieldRole")}</Label>
                  <div role="tablist" className="mt-1.5 grid grid-cols-3 gap-1 rounded-[12px] bg-[#F5F4F0] p-1">
                    {(["tutor", "student", "manager"] as AppRole[]).map((r) => {
                      const active = addForm.role === r;
                      return (
                        <button
                          key={r}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          onClick={() => setAddForm((f) => ({ ...f, role: r }))}
                          className="h-10 rounded-[9px] text-[14px] font-semibold transition-colors"
                          style={{
                            background: active ? "#fff" : "transparent",
                            color: active ? "#1f8e7e" : "#6b7088",
                            boxShadow: active ? "0 1px 4px rgba(15,15,26,.08)" : "none",
                          }}
                        >
                          {t(`roles.${r}`)}
                        </button>
                      );
                    })}
                  </div>
                </div>
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
                <p className="text-[14px] text-muted-foreground">
                  {t("people.ghostHint")}
                </p>
                {addForm.role === "tutor" && (
                  <div>
                    <Label>{t("people.fieldSubjects")}</Label>
                    <p className="text-[14px] text-muted-foreground mb-2">{t("people.oneOrMore")}</p>
                    <SubjectMultiSelect
                      value={addForm.subjects}
                      onChange={(next) => setAddForm((f) => ({ ...f, subjects: next }))}
                    />
                  </div>
                )}
              </div>
              <div style={{ flexShrink: 0, padding: "12px 20px 18px", borderTop: "0.5px solid var(--border, #f0f1f5)", background: "#fff", display: "flex", gap: 10 }}>
                <button type="button" onClick={() => setAddOpen(false)} disabled={adding}
                  style={{ height: 50, padding: "0 18px", borderRadius: 14, border: "1px solid #eceef3", background: "#fff", color: "var(--sub,#6b7088)", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15, cursor: "pointer", flexShrink: 0 }}>
                  {t("people.cancelBtn")}
                </button>
                <button type="button" onClick={addPerson} disabled={adding}
                  style={{ flex: 1, height: 50, borderRadius: 14, border: "none", cursor: adding ? "default" : "pointer", opacity: adding ? 0.7 : 1, background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15.5, boxShadow: "0 8px 20px -8px rgba(43,191,170,.6)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  {adding && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("people.addBtn")}
                </button>
              </div>
            </DialogContent>
          </Dialog>
          )}
      <Sheet open={!!selectedPerson} onOpenChange={(open) => !open && setSelectedPerson(null)}>
        <SheetContent
          side="bottom"
          className="rounded-t-[20px] px-0 pb-6 pt-0 max-h-[90vh] overflow-y-auto [&>button.absolute]:hidden"
        >
          {selectedPerson && (() => {
            const u = selectedPerson;
            const tutorProgress = isManager && u.role === "tutor" && !u.archived_at
              ? (() => {
                  const steps = [
                    { ok: !!u.has_student, label: t("people.progressStudents") },
                    { ok: !!u.has_lesson, label: t("people.progressLessons") },
                    { ok: !!u.has_paid_lesson, label: t("people.progressPayments") },
                  ];
                  return { doneCount: steps.filter(s => s.ok).length, steps };
                })()
              : null;
            const tutorNameOf = (id: string) => {
              const tu = allTutors.find((x) => x.id === id);
              return tu ? fullName(tu) : "?";
            };
            const studentPairs = u.role === "student"
              ? studentRates.filter((r) => r.student_id === u.id)
              : [];
            const openRateFor = (r: (typeof studentRates)[number]) => {
              setStudentDialog({
                open: true,
                studentId: u.id,
                studentName: fullName(u),
                tutorId: r.tutor_id,
                tutorName: tutorNameOf(r.tutor_id),
                subject: r.subject,
                price: String(r.price_per_lesson ?? ""),
                currency: r.currency || "UAH",
                existingId: r.id,
              });
              setSelectedPerson(null);
            };
            const openAssignTutor = () => {
              setAddTutorToStudent({
                open: true,
                studentId: u.id,
                studentName: fullName(u),
                tutorId: "",
                subject: "",
                price: "",
                currency: "UAH",
              });
              setSelectedPerson(null);
            };
            return (
              <>
                {/* Drag handle */}
                <div className="mx-auto mt-2.5 mb-0 h-1 w-9 rounded-full bg-border" />

                {/* Header: avatar + name + icons */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                  <div className="relative shrink-0">
                    {u.is_pending ? (
                      <div className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-warning/20 text-warning">
                        <Hourglass className="h-5 w-5" />
                      </div>
                    ) : (
                      <UserAvatar
                        url={u.avatar_url}
                        firstName={u.first_name}
                        lastName={u.last_name}
                        className="h-[52px] w-[52px]"
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[22px] font-extrabold leading-tight text-foreground truncate">
                      {fullName(u)}
                    </p>
                    <p className="text-[14px] mt-0.5" style={{ color: "var(--sub,#6b7088)" }}>
                      {u.role === "tutor" ? t("roles.tutor")
                        : u.role === "manager" ? t("roles.manager")
                        : t("roles.student")}
                      {u.archived_at && " · " + t("people.archivedBadge")}
                    </p>
                  </div>
                  {/* Action icons */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isManager && !u.archived_at && u.id !== currentUser?.id && (
                      <button
                        type="button"
                        className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted transition-colors"
                        style={{ color: "var(--sub,#6b7088)" }}
                        onClick={() => archivePerson(u)}
                        aria-label={t("people.archiveBtn")}
                      >
                        <Archive className="h-4 w-4" />
                      </button>
                    )}
                    {isManager && u.id !== currentUser?.id && u.role !== "manager" && (
                      <button
                        type="button"
                        className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-red-50 transition-colors"
                        style={{ color: "#E24B4A" }}
                        onClick={() => purgePerson(u)}
                        aria-label={t("people.deleteBtn")}
                      >
                        <FlameKindling className="h-4 w-4" />
                      </button>
                    )}
                    {isManager && (
                      <button
                        type="button"
                        className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted transition-colors"
                        style={{ color: "var(--sub,#6b7088)" }}
                        onClick={() => openEditFor(u)}
                        aria-label={t("people.editContactsBtn")}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted transition-colors"
                      style={{ color: "var(--sub,#6b7088)" }}
                      onClick={() => setSelectedPerson(null)}
                      aria-label={t("common.close")}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Contact rows */}
                {u.phone && (
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                    <Phone className="h-4 w-4 shrink-0" style={{ color: "var(--sub,#6b7088)" }} />
                    <span className="flex-1 text-[15px] text-foreground">{u.phone}</span>
                    <button
                      type="button"
                      aria-label={t("people.copyAriaLabel")}
                      className="flex h-11 w-11 items-center justify-center rounded-[11px] hover:bg-[#f0fdf9] transition-colors"
                      style={{ color: "#25a896" }}
                      onClick={() => { navigator.clipboard.writeText(u.phone!); toast.success(t("people.copied"), { description: u.phone! }); }}
                    >
                      <Copy className="h-[19px] w-[19px]" strokeWidth={2} />
                    </button>
                  </div>
                )}
                {u.email && (
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                    <Mail className="h-4 w-4 shrink-0" style={{ color: "var(--sub,#6b7088)" }} />
                    <span className="flex-1 text-[15px] text-foreground truncate">{u.email}</span>
                    <button
                      type="button"
                      aria-label={t("people.copyAriaLabel")}
                      className="flex h-11 w-11 items-center justify-center rounded-[11px] hover:bg-[#f0fdf9] transition-colors"
                      style={{ color: "#25a896" }}
                      onClick={() => { navigator.clipboard.writeText(u.email!); toast.success(t("people.copied"), { description: u.email! }); }}
                    >
                      <Copy className="h-[19px] w-[19px]" strokeWidth={2} />
                    </button>
                  </div>
                )}

                {/* Rate row — tutor subjects */}
                {u.role === "tutor" && u.subjects && u.subjects.length > 0 && (
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                    <Tag className="h-4 w-4 shrink-0" style={{ color: "var(--sub,#6b7088)" }} />
                    <div className="flex-1 min-w-0">
                      {u.subjects.map((s) => {
                        const r = tutorSubjectRates[u.id]?.[s];
                        return (
                          <p key={s} className="text-[14px] text-foreground">
                            {s}{r && r > 0 ? ` · ${r} ₴` : ""}
                          </p>
                        );
                      })}
                      <p className="text-sm mt-0.5" style={{ color: "var(--sub,#6b7088)" }}>
                        {t("people.subjectRateHint")}
                      </p>
                    </div>
                    {isManager && (
                      <button
                        type="button"
                        className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted transition-colors"
                        style={{ color: "var(--sub,#6b7088)" }}
                        onClick={() => {
                          setTutorDialog({
                            open: true,
                            userId: u.id,
                            subjects: u.subjects ?? [],
                            rates: Object.fromEntries(
                              (u.subjects ?? []).map((s) => [s, String(tutorSubjectRates[u.id]?.[s] ?? "")]),
                            ),
                          });
                          setSelectedPerson(null);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}

                {/* Rate rows — student pairs (subject · tutor · price) */}
                {u.role === "student" && studentPairs.length > 0 && (
                  <div className="flex items-start gap-3 px-4 py-3 border-b border-border">
                    <Tag className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--sub,#6b7088)" }} />
                    <div className="flex-1 min-w-0">
                      {studentPairs.map((r) => (
                        <div key={r.id} className="flex items-center gap-2">
                          <p className="flex-1 min-w-0 truncate text-[14px] text-foreground">
                            {r.subject} · {tutorNameOf(r.tutor_id)} · {r.price_per_lesson} {currencySymbol(r.currency)}
                          </p>
                          {isManager && (
                            <>
                              {/* Per-tutor wallet — a student can have several tutors,
                                  each with their OWN wallet; the shared tile below just
                                  picks the first, so multi-tutor students top up here. */}
                              <button
                                type="button"
                                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-muted transition-colors"
                                style={{ color: "var(--sub,#6b7088)" }}
                                onClick={() => {
                                  setWalletPair({ student: u, tutorId: r.tutor_id, tutorName: tutorNameOf(r.tutor_id) });
                                  setWalletOpen(true);
                                  setSelectedPerson(null);
                                }}
                                aria-label={t("people.actionWallet")}
                              >
                                <Wallet className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-muted transition-colors"
                                style={{ color: "var(--sub,#6b7088)" }}
                                onClick={() => openRateFor(r)}
                                aria-label={t("people.actionRate")}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      ))}
                      <p className="text-sm mt-0.5" style={{ color: "var(--sub,#6b7088)" }}>
                        {t("people.subjectRateHint")}
                      </p>
                    </div>
                  </div>
                )}

                {/* Onboarding progress — tutor only */}
                {tutorProgress && (
                  <div className="px-4 py-3 border-b border-border">
                    <div className="flex justify-between text-[14px] mb-1.5" style={{ color: "var(--sub,#6b7088)" }}>
                      <span>{t("people.progressTitle", { done: tutorProgress.doneCount })}</span>
                      <span style={{ color: "#1D9E75", fontWeight: 500 }}>{tutorProgress.doneCount}/{tutorProgress.steps.length}</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full" style={{ background: "var(--border,#eceef3)" }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${(tutorProgress.doneCount / tutorProgress.steps.length) * 100}%`, background: "#1D9E75" }}
                      />
                    </div>
                  </div>
                )}

                {/* Manager notes */}
                {isManager && currentUser && (u.role === "tutor" || u.role === "student") && (
                  <div className="px-4 py-3 border-b border-border">
                    <ManagerNotes subjectUserId={u.id} currentUserId={currentUser.id} compact />
                  </div>
                )}

                {/* Payout schedule — manager sets when to pay THIS tutor (Ср / Пт / ...) */}
                {isManager && u.role === "tutor" && !u.is_pending && (
                  <div className="px-4 py-3 border-b border-border">
                    <PayoutScheduleCard tutorId={u.id} />
                  </div>
                )}

                {/* Student actions. Without a tutor, the only sensible next step is
                    "assign a tutor" — so show ONE dominant CTA instead of a 3-tile
                    grid where Wallet/Ставка look equal but secretly reroute on tap.
                    Once a tutor exists, show the full Репетитор / Гаманець / Ставка grid. */}
                {isManager && u.role === "student" && !u.archived_at && !u.is_pending && (
                  studentPairs.length === 0 ? (
                    <div className="px-4 pt-3">
                      <button
                        type="button"
                        className="flex h-12 w-full items-center justify-center gap-2 rounded-[14px] text-[15px] font-bold text-white transition-opacity active:opacity-90"
                        style={{ background: "linear-gradient(135deg,#2BBFAA,#25a896)", boxShadow: "0 8px 20px -8px rgba(43,191,170,.6)" }}
                        onClick={openAssignTutor}
                      >
                        <GraduationCap className="h-5 w-5" />
                        {t("people.assignTutorCta")}
                      </button>
                    </div>
                  ) : (
                  <div className="grid grid-cols-3 gap-2 px-4 pt-3">
                    <button
                      type="button"
                      className="flex flex-col items-center gap-1.5 rounded-[14px] py-3 text-center transition-colors"
                      style={{ background: "#E1F5EE", border: "0.5px solid #5DCAA5" }}
                      onClick={openAssignTutor}
                    >
                      <GraduationCap className="h-5 w-5" style={{ color: "#0F6E56" }} />
                      <span className="text-[14px] font-medium" style={{ color: "#0F6E56" }}>{t("roles.tutor")}</span>
                    </button>
                    <button
                      type="button"
                      className="flex flex-col items-center gap-1.5 rounded-[14px] py-3 text-center transition-colors hover:bg-muted"
                      style={{ background: "var(--bg,#F5F4F0)", border: "0.5px solid var(--border,#eceef3)" }}
                      onClick={() => {
                        const pair = studentPairs[0];
                        setWalletPair({ student: u, tutorId: pair.tutor_id, tutorName: tutorNameOf(pair.tutor_id) });
                        setWalletOpen(true);
                        setSelectedPerson(null);
                      }}
                    >
                      <Wallet className="h-5 w-5" style={{ color: "var(--sub,#6b7088)" }} />
                      <span className="text-[14px] font-medium" style={{ color: "var(--sub,#6b7088)" }}>{t("people.actionWallet")}</span>
                    </button>
                    <button
                      type="button"
                      className="flex flex-col items-center gap-1.5 rounded-[14px] py-3 text-center transition-colors hover:bg-muted"
                      style={{ background: "var(--bg,#F5F4F0)", border: "0.5px solid var(--border,#eceef3)" }}
                      onClick={() => openRateFor(studentPairs[0])}
                    >
                      <Tag className="h-5 w-5" style={{ color: "var(--sub,#6b7088)" }} />
                      <span className="text-[14px] font-medium" style={{ color: "var(--sub,#6b7088)" }}>{t("people.actionRate")}</span>
                    </button>
                  </div>
                  )
                )}

                {/* Pending: Нагадати button */}
                {u.is_pending && isManager && (
                  <div className="px-4 pt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className="h-11 rounded-[12px] text-[14px] font-semibold text-white"
                      style={{ background: "var(--teal,#2BBFAA)" }}
                      onClick={() => { setInvite({ open: true, name: fullName(u), email: u.email, phone: u.phone, role: (u.role === "tutor" ? "tutor" : "student"), /* send-student-invite mails a role=student signup link — never wire it to a tutor ghost */ studentId: u.role === "student" ? u.id : null, emailSent: false }); setSelectedPerson(null); }}
                    >
                      {t("people.remindBtn")}
                    </button>
                    <button
                      type="button"
                      className="h-11 rounded-[12px] text-[14px] font-semibold"
                      style={{ background: "var(--bg,#F5F4F0)", color: "#E24B4A", border: "0.5px solid #F09595" }}
                      onClick={() => { purgePerson(u); setSelectedPerson(null); }}
                    >
                      {t("people.deleteBtn")}
                    </button>
                  </div>
                )}
              </>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* WalletDialog for student actions */}
      {walletPair && (
        <WalletDialog
          open={walletOpen}
          onOpenChange={(open) => { setWalletOpen(open); if (!open) setWalletPair(null); }}
          tutorId={walletPair.tutorId}
          studentId={walletPair.student.id}
          tutorName={walletPair.tutorName}
          studentName={fullName(walletPair.student)}
          canTopUp={isManager}
        />
      )}

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
      {/* FAB — opens add person dialog, preset to the active tab's role and labelled
          for it (Додати репетитора / учня / менеджера) so the most common hub job —
          populating tutors — is a one-tap, unambiguous action. */}
      {isManager && (
        <PageFAB
          onClick={() => openAddSheet(activeRoleTab === "tutors" ? "tutor" : activeRoleTab === "managers" ? "manager" : "student")}
          label={activeRoleTab === "tutors" ? t("people.addTutor") : activeRoleTab === "managers" ? t("people.addManager") : t("people.addStudent")}
        />
      )}
    </AppLayout>
  );
}
