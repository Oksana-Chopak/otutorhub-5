import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { StatCard } from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import { FindTutorDialog } from "@/components/FindTutorDialog";
import { TelegramLinkCard } from "@/components/TelegramLinkCard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { IndependentTutorStats } from "@/components/IndependentTutorStats";
import { TutorWelcomeBanner } from "@/components/TutorWelcomeBanner";
import { MonthlySummaryCard } from "@/components/MonthlySummaryCard";
import { ReferralWidget } from "@/components/ReferralWidget";
import { PendingPaymentsCard } from "@/components/PendingPaymentsCard";
import { QuickPaymentFab } from "@/components/QuickPaymentFab";
import { ReferralNudgeBanner } from "@/components/ReferralNudgeBanner";
import { StudentWalletCard } from "@/components/StudentWalletCard";
import { WalletDialog } from "@/components/WalletDialog";
import { QuickAddStudentDialog } from "@/components/QuickAddStudentDialog";
import { LessonDetailsDialog } from "@/components/LessonDetailsDialog";
import { TrialCountdownBanner } from "@/components/TrialCountdownBanner";
import { Wallet } from "lucide-react";
import { QuickLessonDialog } from "@/components/QuickLessonDialog";
import { useTutorGamification } from "@/hooks/useTutorGamification";
import { useBadgeUnlockToasts } from "@/hooks/useBadgeUnlockToasts";
import { LessonCard } from "@/components/LessonCard";
import { TutorNotesCard } from "@/components/TutorNotesCard";
import { NeedsMarkingCard } from "@/components/NeedsMarkingCard";
import { AutoCompletePromptDialog } from "@/components/AutoCompletePromptDialog";
import { AutoCompleteLessonsCard } from "@/components/AutoCompleteLessonsCard";
import { QuickActionsCard } from "@/components/QuickActionsCard";
import { lessonSourceTint } from "@/components/SourceBadge";
import { formatPrice } from "@/lib/currency";
import {
  CalendarDays,
  Users,
  TrendingUp,
  Loader2,
  Video,
  AlertTriangle,
  UserX,
  Tag,
  CalendarPlus,
  StickyNote,
  Plus,
  HandHeart,
  Clock,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type LessonStatus = "pending" | "scheduled" | "completed" | "cancelled";
type PaymentStatus = "paid" | "unpaid";

interface LessonRow {
  id: string;
  tutor_id: string;
  student_id: string;
  subject: string;
  starts_at: string;
  duration_minutes: number;
  status: LessonStatus;
  student_price: number;
  tutor_payout: number;
  student_payment_status: PaymentStatus;
  tutor_payout_status: PaymentStatus;
  meeting_url: string | null;
  homework: string | null;
  summary: string | null;
  student_notes: string | null;
  source: "hub" | "independent";
}

interface ProfileRow {
  id: string;
  first_name: string;
  last_name: string;
}

const dayAffirmations = [
  "Ð¯ ÑÐ¿Ð¾ÐºÑÐ¹Ð½Ð¾ ÐºÐµÑÑÑ ÑÐ²Ð¾ÑÐ¼ Ð´Ð½ÐµÐ¼ Ñ Ð±Ð°ÑÑ Ð³Ð¾Ð»Ð¾Ð²Ð½Ðµ.",
  "Ð¯ ÑÑÐ²Ð¾ÑÑÑ ÑÑÐ½ÑÑÑÑ Ð´Ð»Ñ ÑÐµÐ±Ðµ, ÑÑÐ½ÑÐ² Ñ ÐºÐ¾Ð¼Ð°Ð½Ð´Ð¸.",
  "ÐÑÐ¹ ÑÐ¾Ð·ÐºÐ»Ð°Ð´ Ð´Ð¾Ð¿Ð¾Ð¼Ð°Ð³Ð°Ñ Ð¼ÐµÐ½Ñ Ð¿ÑÐ°ÑÑÐ²Ð°ÑÐ¸ Ð±ÐµÐ· ÑÐ°Ð¾ÑÑ.",
  "Ð¯ Ð²ÑÑÐ¸Ð³Ð°Ñ Ð´Ð¾ÑÑÐ°ÑÐ½ÑÐ¾, ÐºÐ¾Ð»Ð¸ ÑÑÑÐ°ÑÑÑ Ð¿Ð¾ Ð¾Ð´Ð½Ð¾Ð¼Ñ ÐºÑÐ¾ÐºÑ.",
  "Ð¯ Ð¼Ð°Ñ Ð¿ÑÐ°Ð²Ð¾ Ð½Ð° ÑÐ¿Ð¾ÐºÑÐ¹Ð½Ð¸Ð¹ ÑÐµÐ¼Ð¿ Ñ ÑÐºÑÑÐ½Ð¸Ð¹ ÑÐµÐ·ÑÐ»ÑÑÐ°Ñ.",
  "ÐÐ¾Ñ ÑÑÐ¾ÐºÐ¸ Ð¿ÑÐ¸Ð½Ð¾ÑÑÑÑ ÐºÐ¾ÑÐ¸ÑÑÑ Ñ Ð²ÑÐ´ÑÑÑÐ½Ð¸Ð¹ Ð¿ÑÐ¾Ð³ÑÐµÑ.",
  "Ð¯ ÑÑÐ¸Ð¼Ð°Ñ ÑÐ¾ÐºÑÑ Ð½Ð° Ð»ÑÐ´ÑÑ, Ð° Ð½Ðµ Ð½Ð° ÑÑÑÐ¸Ð½Ñ.",
  "Ð¯ Ð¼Ð¾Ð¶Ñ Ð´ÐµÐ»ÐµÐ³ÑÐ²Ð°ÑÐ¸ ÑÐ¸ÑÑÐµÐ¼Ñ ÑÐµ, ÑÐ¾ Ð½Ðµ Ð¿Ð¾ÑÑÐµÐ±ÑÑ Ð¼Ð¾ÑÑ ÑÐ²Ð°Ð³Ð¸.",
  "Ð¯ Ð±Ð°ÑÑ ÑÑÐ½Ð°Ð½ÑÐ¸ ÑÑÑÐºÐ¾ Ñ Ð¿ÑÐ¸Ð¹Ð¼Ð°Ñ Ð²Ð¿ÐµÐ²Ð½ÐµÐ½Ñ ÑÑÑÐµÐ½Ð½Ñ.",
  "Ð¯ Ð±ÑÐ´ÑÑ Ð½Ð°Ð²ÑÐ°Ð½Ð½Ñ, Ñ ÑÐºÐ¾Ð¼Ñ Ð²ÑÑÐ¼ Ð·ÑÐ¾Ð·ÑÐ¼ÑÐ»Ð¾, ÑÐ¾ Ð´Ð°Ð»Ñ.",
  "ÐÑÐ¹ Ð´Ð¾ÑÐ²ÑÐ´ ÑÑÐ½Ð½Ð¸Ð¹, Ñ Ð²ÑÐ½ ÑÐ¾Ð´Ð½Ñ Ð´Ð¾Ð¿Ð¾Ð¼Ð°Ð³Ð°Ñ ÑÐ½ÑÐ¸Ð¼.",
  "Ð¯ Ð½Ðµ Ð¼ÑÑÑ ÑÐ¾Ð±Ð¸ÑÐ¸ Ð²ÑÐµ Ð¾Ð´ÑÐ°Ð·Ñ, ÑÐ¾Ð± ÑÑÑÐ°ÑÐ¸ÑÑ Ð²Ð¿ÐµÑÐµÐ´.",
  "Ð¯ Ð¿Ð¾Ð¼ÑÑÐ°Ñ Ð¼Ð°Ð»ÐµÐ½ÑÐºÑ Ð¿ÐµÑÐµÐ¼Ð¾Ð³Ð¸ Ñ Ð´Ð¾Ð·Ð²Ð¾Ð»ÑÑ ÑÐ¼ Ð¿ÑÐ´ÑÑÐ¸Ð¼ÑÐ²Ð°ÑÐ¸ Ð¼ÐµÐ½Ðµ.",
  "Ð¯ Ð¿ÑÐ°ÑÑÑ Ð¿ÑÐ¾ÑÐµÑÑÐ¹Ð½Ð¾, Ð½Ð°Ð²ÑÑÑ ÐºÐ¾Ð»Ð¸ Ð´ÐµÐ½Ñ Ð½Ð°ÑÐ¸ÑÐµÐ½Ð¸Ð¹.",
  "ÐÑÐ¹ ÑÐ°Ñ Ð¼Ð°Ñ ÑÑÐ½Ð½ÑÑÑÑ, Ñ Ñ ÑÑÐ°Ð²Ð»ÑÑÑ Ð´Ð¾ Ð½ÑÐ¾Ð³Ð¾ Ð· Ð¿Ð¾Ð²Ð°Ð³Ð¾Ñ.",
  "Ð¯ Ð¼Ð¾Ð¶Ñ ÑÐºÐ°Ð·Ð°ÑÐ¸ âÐ´Ð¾ÑÑÐ°ÑÐ½ÑÐ¾â Ñ Ð·Ð°Ð²ÐµÑÑÐ¸ÑÐ¸ Ð´ÐµÐ½Ñ Ð±ÐµÐ· Ð¿ÑÐ¾Ð²Ð¸Ð½Ð¸.",
  "Ð¯ Ð²ÐµÐ´Ñ ÑÑÐ½ÑÐ² Ð´Ð¾ ÑÐµÐ·ÑÐ»ÑÑÐ°ÑÑ ÑÐµÑÐµÐ· ÑÑÐ°Ð±ÑÐ»ÑÐ½ÑÑÑÑ Ñ ÑÑÑÐ±Ð¾ÑÑ.",
  "ÐÐµÐ½Ñ Ð´Ð¾ÑÑÑÐ¿Ð½Ñ Ð¿ÑÐ¾ÑÑÑ ÑÑÑÐµÐ½Ð½Ñ Ð´Ð»Ñ ÑÐºÐ»Ð°Ð´Ð½Ð¸Ñ Ð¿ÑÐ¾ÑÐµÑÑÐ².",
  "Ð¯ Ð¾Ð±Ð¸ÑÐ°Ñ ÑÑÐ½Ñ Ð¿ÑÐ°Ð²Ð¸Ð»Ð° Ð·Ð°Ð¼ÑÑÑÑ Ð¿Ð¾ÑÑÑÐ¹Ð½Ð¾Ð³Ð¾ Ð½Ð°Ð¿ÑÑÐ¶ÐµÐ½Ð½Ñ.",
  "ÐÐ¾Ð¶ÐµÐ½ Ð²Ð¿Ð¾ÑÑÐ´ÐºÐ¾Ð²Ð°Ð½Ð¸Ð¹ ÑÑÐ¾Ðº ÑÐ¾Ð±Ð¸ÑÑ ÑÐ¸ÑÑÐµÐ¼Ñ ÑÐ¸Ð»ÑÐ½ÑÑÐ¾Ñ.",
  "Ð¯ Ð²Ð¿ÐµÐ²Ð½ÐµÐ½Ð¾ Ð±Ð°ÑÑ, ÑÐ¾ Ð¿Ð¾ÑÑÐµÐ±ÑÑ Ð¼Ð¾ÑÑ ÑÐ²Ð°Ð³Ð¸ ÑÑÐ¾Ð³Ð¾Ð´Ð½Ñ.",
  "ÐÐ¾Ñ ÑÐ¾Ð±Ð¾ÑÐ° ÑÑÐ°Ñ Ð»ÐµÐ³ÑÐ¾Ñ, ÐºÐ¾Ð»Ð¸ Ð´Ð°Ð½Ñ Ð·ÑÐ±ÑÐ°Ð½Ñ Ð² Ð¾Ð´Ð½Ð¾Ð¼Ñ Ð¼ÑÑÑÑ.",
  "Ð¯ Ð·Ð°ÑÐ»ÑÐ³Ð¾Ð²ÑÑ Ð½Ð° ÑÐ½ÑÑÑÑÐ¼ÐµÐ½ÑÐ¸, ÑÐºÑ Ð±ÐµÑÐµÐ¶ÑÑÑ Ð¼Ð¾Ñ ÐµÐ½ÐµÑÐ³ÑÑ.",
  "Ð¯ Ð¼Ð¾Ð¶Ñ Ð¿ÑÐ´ÑÑÐ¸Ð¼ÑÐ²Ð°ÑÐ¸ Ð²Ð¸ÑÐ¾ÐºÐ¸Ð¹ ÑÑÐ°Ð½Ð´Ð°ÑÑ Ð±ÐµÐ· Ð¿ÐµÑÐµÐ²Ð°Ð½ÑÐ°Ð¶ÐµÐ½Ð½Ñ.",
  "Ð¯ ÑÑÐ²Ð¾ÑÑÑ Ð¿ÑÐ¾ÑÑÑÑ, Ð´Ðµ Ð½Ð°Ð²ÑÐ°Ð½Ð½Ñ Ð¹ Ð¾ÑÐ³Ð°Ð½ÑÐ·Ð°ÑÑÑ Ð¿ÑÐ°ÑÑÑÑÑ ÑÐ°Ð·Ð¾Ð¼.",
  "Ð¯ Ð´Ð¾Ð·Ð²Ð¾Ð»ÑÑ ÑÐ¾Ð±Ñ Ð¿ÑÐ°ÑÑÐ²Ð°ÑÐ¸ ÑÐ¾Ð·ÑÐ¼Ð½ÑÑÐµ, Ð½Ðµ Ð±ÑÐ»ÑÑÐµ.",
  "ÐÑÐ¹ Ð´ÐµÐ½Ñ Ð¼Ð¾Ð¶Ðµ Ð±ÑÑÐ¸ Ð¿ÑÐ¾Ð´ÑÐºÑÐ¸Ð²Ð½Ð¸Ð¼ Ñ ÑÐ¿Ð¾ÐºÑÐ¹Ð½Ð¸Ð¼ Ð¾Ð´Ð½Ð¾ÑÐ°ÑÐ½Ð¾.",
  "Ð¯ Ð¿ÑÐ¸Ð¹Ð¼Ð°Ñ ÑÑÑÐµÐ½Ð½Ñ Ð½Ð° Ð¾ÑÐ½Ð¾Ð²Ñ ÑÐ°ÐºÑÑÐ², Ð° Ð½Ðµ ÑÑÐ¸Ð²Ð¾Ð³Ð¸.",
  "Ð¯ ÑÑÐ½ÑÑ ÑÐ²ÑÐ¹ Ð²ÐºÐ»Ð°Ð´ Ñ Ð±Ð°ÑÑ Ð¹Ð¾Ð³Ð¾ ÑÐµÐ·ÑÐ»ÑÑÐ°Ñ.",
  "ÐÐ¾Ñ ÑÑÐ½Ñ Ð¾ÑÑÐ¸Ð¼ÑÑÑÑ ÑÑÑÑÐºÑÑÑÑ, Ð¿ÑÐ´ÑÑÐ¸Ð¼ÐºÑ Ñ Ð·ÑÐ¾Ð·ÑÐ¼ÑÐ»Ð¸Ð¹ ÑÐ»ÑÑ.",
  "Ð¯ Ð¼Ð¾Ð¶Ñ ÑÐ²Ð¸Ð´ÐºÐ¾ Ð¿Ð¾Ð²ÐµÑÐ½ÑÑÐ¸ ÐºÐ¾Ð½ÑÑÐ¾Ð»Ñ, ÐºÐ¾Ð»Ð¸ Ð´ÐµÐ½Ñ Ð·Ð¼ÑÐ½ÑÑÑÑÑÑ.",
  "Ð¯ Ð¿ÑÐ´ÑÑÐ¸Ð¼ÑÑ Ð¿Ð¾ÑÑÐ´Ð¾Ðº Ð¼Ð°Ð»ÐµÐ½ÑÐºÐ¸Ð¼Ð¸ Ð´ÑÑÐ¼Ð¸ ÑÐ¾Ð´Ð½Ñ.",
  "Ð¯ Ð½Ðµ Ð²ÑÑÐ°ÑÐ°Ñ Ð²Ð°Ð¶Ð»Ð¸Ð²Ðµ â ÑÐ¸ÑÑÐµÐ¼Ð° Ð´Ð¾Ð¿Ð¾Ð¼Ð°Ð³Ð°Ñ Ð¼ÐµÐ½Ñ Ð¿Ð°Ð¼âÑÑÐ°ÑÐ¸.",
  "Ð¯ Ð¼Ð°Ñ Ð´Ð¾ÑÑÐ°ÑÐ½ÑÐ¾ ÑÐµÑÑÑÑÑ Ð´Ð»Ñ Ð³Ð¾Ð»Ð¾Ð²Ð½Ð¸Ñ ÑÐ¾Ð·Ð¼Ð¾Ð² Ñ ÑÑÑÐµÐ½Ñ.",
  "Ð¯ Ð²Ð¼ÑÑ Ð±Ð°ÑÐ¸ÑÐ¸ Ð¿ÑÑÐ¾ÑÐ¸ÑÐµÑÐ¸ ÑÐµÑÐµÐ´ Ð±Ð°Ð³Ð°ÑÑÐ¾Ñ Ð·Ð°Ð´Ð°Ñ.",
  "ÐÐ¾Ñ Ð¾ÑÐ³Ð°Ð½ÑÐ·Ð¾Ð²Ð°Ð½ÑÑÑÑ Ð¿ÑÐ´ÑÐ¸Ð»ÑÑ Ð´Ð¾Ð²ÑÑÑ ÑÑÐ½ÑÐ² Ñ Ð±Ð°ÑÑÐºÑÐ².",
  "Ð¯ Ð¼Ð¾Ð¶Ñ Ð¿ÑÐ°ÑÑÐ²Ð°ÑÐ¸ Ð¿ÑÐ¾Ð·Ð¾ÑÐ¾, ÑÐµÑÐ½Ð¾ Ñ Ð±ÐµÐ· Ð·Ð°Ð¹Ð²Ð¸Ñ Ð¿Ð¾ÑÑÐ½ÐµÐ½Ñ.",
  "Ð¯ Ð´Ð°Ñ ÑÐ¾Ð±Ñ Ð¿ÑÐ°Ð²Ð¾ Ð½Ð° Ð¿Ð°ÑÐ·Ñ, ÐºÐ¾Ð»Ð¸ Ð²Ð¾Ð½Ð° Ð¿Ð¾ÑÑÑÐ±Ð½Ð°.",
  "Ð¯ Ð·ÑÐ¾ÑÑÐ°Ñ ÑÐº ÑÐ°ÑÑÐ²ÐµÑÑ ÑÐµÑÐµÐ· ÑÑÐ°Ð»ÑÑÑÑ, Ð° Ð½Ðµ Ð¿Ð¾ÑÐ¿ÑÑ.",
  "ÐÐ¾Ð¶ÐµÐ½ ÑÑÐ¾Ðº â ÑÐµ Ð²ÐºÐ»Ð°Ð´ Ñ Ð¼Ð°Ð¹Ð±ÑÑÐ½ÑÐ¹ ÑÐµÐ·ÑÐ»ÑÑÐ°Ñ.",
  "Ð¯ ÑÑÐ¸Ð¼Ð°Ñ ÑÑÐ½Ð°Ð½ÑÐ¾Ð²Ñ Ð¿ÑÐ¾ÑÐµÑÐ¸ ÑÐ¸ÑÑÐ¸Ð¼Ð¸ Ñ Ð·ÑÐ¾Ð·ÑÐ¼ÑÐ»Ð¸Ð¼Ð¸.",
  "Ð¯ Ð»ÐµÐ³ÐºÐ¾ Ð¿Ð¾Ð²ÐµÑÑÐ°ÑÑÑ Ð´Ð¾ Ð¿Ð»Ð°Ð½Ñ Ð¿ÑÑÐ»Ñ Ð±ÑÐ´Ñ-ÑÐºÐ¾Ð³Ð¾ Ð·Ð±Ð¾Ñ.",
  "Ð¯ ÑÑÐ²Ð¾ÑÑÑ ÑÐ¸ÑÑÐµÐ¼Ñ, ÑÐºÐ° Ð¿ÑÐ°ÑÑÑ Ð½Ðµ ÑÑÐ»ÑÐºÐ¸ ÑÑÐ¾Ð³Ð¾Ð´Ð½Ñ, Ð° Ð¹ Ð·Ð°Ð²ÑÑÐ°.",
  "Ð¯ Ð¼Ð¾Ð¶Ñ Ð±ÑÑÐ¸ ÑÐ²Ð°Ð¶Ð½Ð¾Ñ/ÑÐ²Ð°Ð¶Ð½Ð¸Ð¼ Ð´Ð¾ Ð´ÐµÑÐ°Ð»ÐµÐ¹ Ð±ÐµÐ· Ð²Ð¸ÑÐ½Ð°Ð¶ÐµÐ½Ð½Ñ.",
  "Ð¯ Ð¾Ð±Ð¸ÑÐ°Ñ ÑÐ¿Ð¾ÐºÑÐ¹Ð½Ñ Ð²Ð¿ÐµÐ²Ð½ÐµÐ½ÑÑÑÑ Ð·Ð°Ð¼ÑÑÑÑ ÑÐ°Ð¾ÑÐ¸ÑÐ½Ð¾Ñ Ð·Ð°Ð¹Ð½ÑÑÐ¾ÑÑÑ.",
  "ÐÐ¾Ñ ÐºÐ¾Ð¼Ð°Ð½Ð´Ð° Ð¹ ÑÑÐ½Ñ Ð²Ð¸Ð³ÑÐ°ÑÑÑ Ð²ÑÐ´ ÑÑÐ½Ð¾Ð³Ð¾ Ð¿ÑÐ¾ÑÐµÑÑ.",
  "Ð¯ Ð·Ð½Ð°Ñ, ÑÐ¾ Ð½Ð°ÑÑÑÐ¿Ð½Ð¸Ð¹ Ð¿ÑÐ°Ð²Ð¸Ð»ÑÐ½Ð¸Ð¹ ÐºÑÐ¾Ðº ÑÐ¶Ðµ Ð´Ð¾ÑÑÐ°ÑÐ½ÑÐ¹.",
  "Ð¯ Ð½Ðµ Ð·Ð¾Ð±Ð¾Ð²âÑÐ·Ð°Ð½Ð°/Ð·Ð¾Ð±Ð¾Ð²âÑÐ·Ð°Ð½Ð¸Ð¹ Ð½Ð¾ÑÐ¸ÑÐ¸ Ð²ÐµÑÑ ÑÐ°Ð¾Ñ Ñ Ð³Ð¾Ð»Ð¾Ð²Ñ.",
  "Ð¯ Ð±ÑÐ´ÑÑ Ð½Ð°Ð²ÑÐ°Ð»ÑÐ½Ð¸Ð¹ Ð¿ÑÐ¾ÑÑÑÑ, Ð´Ðµ Ð²ÑÐ´Ð¿Ð¾Ð²ÑÐ´Ð°Ð»ÑÐ½ÑÑÑÑ ÑÐ¾Ð·Ð¿Ð¾Ð´ÑÐ»ÐµÐ½Ð° ÑÐµÑÐ½Ð¾.",
  "Ð¯ Ð¼Ð¾Ð¶Ñ Ð·Ð¼ÑÐ½ÑÐ²Ð°ÑÐ¸ Ð¿Ð»Ð°Ð½ Ñ Ð²ÑÐµ Ð¾Ð´Ð½Ð¾ ÑÑÑÐ°ÑÐ¸ÑÑ Ð´Ð¾ ÑÑÐ»Ñ.",
  "Ð¯ Ð±Ð°ÑÑ Ð¿ÑÐ¾Ð³ÑÐµÑ Ð½Ð°Ð²ÑÑÑ Ñ ÑÐ¸Ñ ÑÐµÑÐ°Ñ, ÑÐºÑ ÑÐµ Ð½Ðµ ÑÐ´ÐµÐ°Ð»ÑÐ½Ñ.",
  "Ð¯ Ð¼Ð°Ñ Ð¿ÑÐ°Ð²Ð¾ Ð½Ð° ÑÐ½ÑÐµÑÑÐµÐ¹Ñ, ÑÐºÐ¸Ð¹ Ð´Ð¾Ð¿Ð¾Ð¼Ð°Ð³Ð°Ñ, Ð° Ð½Ðµ Ð·Ð°Ð²Ð°Ð¶Ð°Ñ.",
  "Ð¯ Ð²ÐµÐ´Ñ ÑÐ¿ÑÐ°Ð²Ð¸ ÑÐ°Ðº, ÑÐ¾Ð± Ð·Ð°Ð²ÑÑÐ° Ð±ÑÐ»Ð¾ Ð»ÐµÐ³ÑÐµ, Ð½ÑÐ¶ ÑÑÐ¾Ð³Ð¾Ð´Ð½Ñ.",
  "Ð¯ Ð¿Ð¾Ð¼ÑÑÐ°Ñ ÑÐ¸Ð·Ð¸ÐºÐ¸ Ð²ÑÐ°ÑÐ½Ð¾ Ñ Ð´ÑÑ Ð±ÐµÐ· Ð¿Ð°Ð½ÑÐºÐ¸.",
  "ÐÑÐ¹ Ð¿ÑÐ¾ÑÐµÑÑÐ¾Ð½Ð°Ð»ÑÐ·Ð¼ Ð¿ÑÐ¾ÑÐ²Ð»ÑÑÑÑÑÑ Ñ ÑÑÐ½Ð¾ÑÑÑ, ÑÑÑÐ±Ð¾ÑÑ Ð¹ Ð¼ÐµÐ¶Ð°Ñ.",
  "Ð¯ Ð¼Ð¾Ð¶Ñ Ð¿ÑÐ¾ÑÐ¸ÑÐ¸ Ð¾Ð¿Ð»Ð°ÑÑ ÑÐ¿Ð¾ÐºÑÐ¹Ð½Ð¾, Ð±Ð¾ Ð¼Ð¾Ñ Ð¿ÑÐ°ÑÑ Ð¼Ð°Ñ ÑÑÐ½Ð½ÑÑÑÑ.",
  "Ð¯ Ð½Ðµ Ð²ÑÐ´ÐºÐ»Ð°Ð´Ð°Ñ Ð²Ð°Ð¶Ð»Ð¸Ð²Ðµ, ÐºÐ¾Ð»Ð¸ Ð±Ð°ÑÑ Ð¹Ð¾Ð³Ð¾ ÑÑÑÐºÐ¾.",
  "Ð¯ ÑÑÐ²Ð¾ÑÑÑ ÑÐ¸ÑÐ¼, Ñ ÑÐºÐ¾Ð¼Ñ ÑÑÐ½ÑÐ¼ Ð»ÐµÐ³ÑÐµ ÑÑÐ¸Ð¼Ð°ÑÐ¸ÑÑ ÐºÑÑÑÑ.",
  "Ð¯ Ð¼Ð¾Ð¶Ñ Ð±ÑÑÐ¸ Ð¿Ð¾ÑÐ»ÑÐ´Ð¾Ð²Ð½Ð¾Ñ/Ð¿Ð¾ÑÐ»ÑÐ´Ð¾Ð²Ð½Ð¸Ð¼ Ð±ÐµÐ· Ð¶Ð¾ÑÑÑÐºÐ¾ÑÑÑ Ð´Ð¾ ÑÐµÐ±Ðµ.",
  "ÐÑÐ¹ Ð´ÐµÐ½Ñ ÑÐºÐ»Ð°Ð´Ð°ÑÑÑÑÑ Ð· ÐºÐµÑÐ¾Ð²Ð°Ð½Ð¸Ñ ÑÐ°ÑÑÐ¸Ð½, Ð° Ð½Ðµ Ð· Ð±ÐµÐ·Ð»Ð°Ð´Ñ.",
  "Ð¯ Ð²ÑÐ´Ð¿ÑÑÐºÐ°Ñ Ð·Ð°Ð¹Ð²Ñ ÑÑÑÐ½Ñ ÑÑÑÐ¸Ð½Ñ Ñ Ð¿Ð¾Ð²ÐµÑÑÐ°Ñ ÑÐ²Ð°Ð³Ñ ÑÐºÐ¾ÑÑÑ.",
  "Ð¯ Ð³ÑÐ´Ð½Ð¾ Ð·Ð°Ð²ÐµÑÑÑÑ Ð·Ð°Ð´Ð°ÑÑ Ð¹ Ð½Ðµ ÑÑÐ³Ð½Ñ ÑÑ Ð¿Ð¾Ð´ÑÐ¼ÐºÐ¸ Ð²ÐµÑÑ Ð´ÐµÐ½Ñ.",
  "Ð¯ Ð±Ð°ÑÑ, Ð´Ðµ Ð¿Ð¾ÑÑÑÐ±Ð½Ð° Ð´ÑÑ, Ð° Ð´Ðµ Ð´Ð¾ÑÑÐ°ÑÐ½ÑÐ¾ ÑÐ¿Ð¾ÑÑÐµÑÑÐ³Ð°ÑÐ¸.",
  "Ð¯ ÑÑÐ²Ð¾ÑÑÑ Ð´Ð¾Ð²ÑÑÑ ÑÐµÑÐµÐ· Ð¿ÐµÑÐµÐ´Ð±Ð°ÑÑÐ²Ð°Ð½ÑÑÑÑ Ñ ÑÐµÑÐ½Ñ Ð¿ÑÐ°Ð²Ð¸Ð»Ð°.",
  "ÐÑÐ¹ ÐºÐ°Ð»ÐµÐ½Ð´Ð°Ñ â ÑÐµ Ð¿ÑÐ´ÑÑÐ¸Ð¼ÐºÐ°, Ð° Ð½Ðµ ÑÐ¸ÑÐº.",
  "Ð¯ Ð´Ð¾Ð·Ð²Ð¾Ð»ÑÑ ÑÐ¾Ð±Ñ ÑÐ¾Ð±Ð¸ÑÐ¸ ÑÐºÐ»Ð°Ð´Ð½Ñ ÑÐµÑÑ Ð¿ÑÐ¾ÑÑÐ¸Ð¼Ð¸ ÐºÑÐ¾ÐºÐ°Ð¼Ð¸.",
  "Ð¯ Ð¼Ð¾Ð¶Ñ Ð±ÑÑÐ¸ ÐµÑÐµÐºÑÐ¸Ð²Ð½Ð¾Ñ/ÐµÑÐµÐºÑÐ¸Ð²Ð½Ð¸Ð¼ Ð±ÐµÐ· Ð¿Ð¾ÑÐ¿ÑÑÑ.",
  "Ð¯ Ð·Ð±ÐµÑÑÐ³Ð°Ñ ÑÐ¾ÐºÑÑ Ð½Ð° ÑÐµÐ·ÑÐ»ÑÑÐ°ÑÑ ÑÑÐ½Ñ, Ð½Ðµ Ð³ÑÐ±Ð»ÑÑÐ¸ ÑÐµÐ±Ðµ.",
  "Ð¯ ÐºÐµÑÑÑ Ð¿ÑÐ¾ÑÐµÑÐ°Ð¼Ð¸, Ð° Ð½Ðµ Ð¿ÑÐ¾ÑÐµÑÐ¸ ÐºÐµÑÑÑÑÑ Ð¼Ð½Ð¾Ñ.",
  "Ð¯ ÑÐ¾Ð´Ð½Ñ Ð¿Ð¾ÐºÑÐ°ÑÑÑ ÑÐ¸ÑÑÐµÐ¼Ñ Ð¼Ð°Ð»ÐµÐ½ÑÐºÐ¸Ð¼Ð¸ ÑÐ¾ÑÐ½Ð¸Ð¼Ð¸ ÑÑÑÐµÐ½Ð½ÑÐ¼Ð¸.",
  "ÐÐ¾Ñ Ð½Ð¾ÑÐ°ÑÐºÐ¸, Ð¾Ð¿Ð»Ð°ÑÐ¸ Ð¹ ÑÑÐ¾ÐºÐ¸ Ð¼Ð°ÑÑÑ ÑÐ²Ð¾Ñ Ð¼ÑÑÑÐµ.",
  "Ð¯ Ð¼Ð¾Ð¶Ñ Ð´Ð¾Ð²ÑÑÑÑÐ¸ Ð¿Ð¾ÑÑÐ´ÐºÑ, ÑÐºÐ¸Ð¹ ÑÑÐ²Ð¾ÑÑÑ.",
  "Ð¯ Ð· Ð¿Ð¾Ð²Ð°Ð³Ð¾Ñ ÑÑÐ°Ð²Ð»ÑÑÑ Ð´Ð¾ ÑÐ²Ð¾Ð³Ð¾ ÑÐ°ÑÑ Ñ ÑÐ°ÑÑ ÑÐ½ÑÐ¸Ñ.",
  "Ð¯ Ð½Ðµ Ð¿Ð»ÑÑÐ°Ñ Ð·Ð°Ð²Ð°Ð½ÑÐ°Ð¶ÐµÐ½ÑÑÑÑ ÑÐ· ÑÑÐ½Ð½ÑÑÑÑ ÑÐ²Ð¾ÑÑ ÑÐ¾Ð±Ð¾ÑÐ¸.",
  "Ð¯ Ð¾Ð±Ð¸ÑÐ°Ñ ÑÐ¾Ð±Ð¾ÑÐ¸Ð¹ Ð´ÐµÐ½Ñ, Ð¿ÑÑÐ»Ñ ÑÐºÐ¾Ð³Ð¾ Ð·Ð°Ð»Ð¸ÑÐ°ÑÑÑÑÑ ÐµÐ½ÐµÑÐ³ÑÑ.",
  "Ð¯ Ð¿ÑÐ´ÑÑÐ¸Ð¼ÑÑ ÑÑÐ½ÑÐ² Ð½Ðµ ÑÑÐ»ÑÐºÐ¸ Ð·Ð½Ð°Ð½Ð½ÑÐ¼Ð¸, Ð° Ð¹ ÑÑÑÑÐºÑÑÑÐ¾Ñ.",
  "Ð¯ Ð±Ð°ÑÑ ÑÐ¸ÑÑÑ ÐºÐ°ÑÑÐ¸Ð½Ñ Ñ Ð½Ðµ Ð³ÑÐ±Ð»Ñ Ð²Ð°Ð¶Ð»Ð¸Ð²Ñ Ð´ÐµÑÐ°Ð»Ñ.",
  "Ð¯ Ð¼Ð¾Ð¶Ñ Ð·Ð°Ð²ÐµÑÑÐ¸ÑÐ¸ Ð´ÐµÐ½Ñ ÑÐ· Ð²ÑÐ´ÑÑÑÑÑÐ¼ Ð¾Ð¿Ð¾ÑÐ¸.",
  "Ð¯ ÑÑÐ²Ð¾ÑÑÑ Ð¿ÑÐ¾ÑÐµÑÐ¸, ÑÐºÑ Ð·Ð¼ÐµÐ½ÑÑÑÑÑ ÐºÑÐ»ÑÐºÑÑÑÑ Ð·Ð°Ð¹Ð²Ð¸Ñ Ð¿Ð¾Ð²ÑÐ´Ð¾Ð¼Ð»ÐµÐ½Ñ.",
  "Ð¯ Ð¿ÑÐ°ÑÑÑ Ð²Ð¿ÐµÐ²Ð½ÐµÐ½Ð¾, Ð±Ð¾ Ð¼Ð°Ñ Ð¿ÑÐ¾Ð·Ð¾ÑÑ ÐºÐ°ÑÑÐ¸Ð½Ñ ÑÐ¿ÑÐ°Ð².",
  "Ð¯ Ð½Ðµ Ð¼ÑÑÑ Ð¿Ð°Ð¼âÑÑÐ°ÑÐ¸ Ð²ÑÐµ â Ð´Ð¾ÑÑÐ°ÑÐ½ÑÐ¾ Ð¼Ð°ÑÐ¸ Ð½Ð°Ð´ÑÐ¹Ð½Ñ ÑÐ¸ÑÑÐµÐ¼Ñ.",
  "Ð¯ Ð¿ÑÐ¸Ð¹Ð¼Ð°Ñ ÑÐµÐ±Ðµ Ð² ÑÐµÐ°Ð»ÑÐ½Ð¾Ð¼Ñ ÑÐµÐ¼Ð¿Ñ ÑÐµÐ°Ð»ÑÐ½Ð¾Ð³Ð¾ Ð´Ð½Ñ.",
  "Ð¯ Ð·Ð´Ð°ÑÐ½Ð°/Ð·Ð´Ð°ÑÐ½Ð¸Ð¹ ÑÑÐ¸Ð¼Ð°ÑÐ¸ Ð¼ÐµÐ¶Ñ Ð¹ Ð·Ð°Ð»Ð¸ÑÐ°ÑÐ¸ÑÑ ÑÑÑÐ±Ð¾ÑÐ»Ð¸Ð²Ð¾Ñ/ÑÑÑÐ±Ð¾ÑÐ»Ð¸Ð²Ð¸Ð¼.",
  "ÐÐ¾Ñ ÑÑÑÐµÐ½Ð½Ñ ÑÑÐ¾Ð³Ð¾Ð´Ð½Ñ ÑÐ¾Ð±Ð»ÑÑÑ Ð·Ð°Ð²ÑÑÐ°ÑÐ½ÑÐ¹ Ð´ÐµÐ½Ñ Ð»ÐµÐ³ÑÐ¸Ð¼.",
  "Ð¯ Ð´Ð°Ñ ÑÑÐ½ÑÐ¼ ÑÐºÑÑÑÑ, Ð° ÑÐ¾Ð±Ñ â Ð¿Ð¾ÑÑÐ´Ð¾Ðº Ñ ÑÐ¿Ð¾ÐºÑÐ¹.",
  "Ð¯ Ð¼Ð¾Ð¶Ñ ÑÐ¾Ð·Ð²Ð¸Ð²Ð°ÑÐ¸ ÑÐ¿ÑÐ°Ð²Ñ Ð±ÐµÐ· Ð¿Ð¾ÑÑÑÐ¹Ð½Ð¾Ð³Ð¾ Ð²Ð½ÑÑÑÑÑÐ½ÑÐ¾Ð³Ð¾ ÑÑÐ¼Ñ.",
  "Ð¯ Ð±Ð°ÑÑ, ÑÐ¾ Ð²Ð¶Ðµ Ð¿ÑÐ°ÑÑÑ, Ñ Ð¿ÑÐ´ÑÐ¸Ð»ÑÑ ÑÐµ.",
  "Ð¯ Ð¾Ð±Ð¸ÑÐ°Ñ ÑÑÐ½ÑÑÑÑ, Ð¿Ð¾ÑÐ»ÑÐ´Ð¾Ð²Ð½ÑÑÑÑ Ñ Ð»ÑÐ´ÑÐ½ÑÑÑÑ.",
  "ÐÑÐ¹ Ð´ÐµÐ½Ñ Ð¼Ð°Ñ Ð½Ð°Ð¿ÑÑÐ¼, Ð½Ð°Ð²ÑÑÑ ÑÐºÑÐ¾ Ð² Ð½ÑÐ¾Ð¼Ñ Ð±Ð°Ð³Ð°ÑÐ¾ Ð·Ð¼ÑÐ½.",
  "Ð¯ ÑÐ¿ÑÐ°Ð²Ð»ÑÑÑÑ â ÐºÑÐ¾Ðº Ð·Ð° ÐºÑÐ¾ÐºÐ¾Ð¼, ÑÑÐ¾Ðº Ð·Ð° ÑÑÐ¾ÐºÐ¾Ð¼.",
];

type ProfitPeriod = "all" | "month" | "week";

export default function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, roles } = useAuth();
  const { isIndependent, settings, loading: wsLoading } = useWorkspaceSettings();
  const isManager = roles.includes("manager");
  const isTutor = roles.includes("tutor");
  const isStudent = roles.includes("student");
  const isIndependentTutor = isTutor && !isManager && isIndependent;

  // Student-only users belong on /student-dashboard. Redirect them out of
  // the tutor/manager dashboard immediately to avoid mixed UI.
  useEffect(() => {
    if (isStudent && !isManager && !isTutor) {
      navigate("/student-dashboard", { replace: true });
    }
  }, [isStudent, isManager, isTutor, navigate]);

  // Note: previously we auto-redirected new tutors to /onboarding here.
  // Removed per UX feedback â instead we show an inline "Add first student"
  // CTA on the empty dashboard so the tutor isn't bounced to another page.

  const [loading, setLoading] = useState(true);
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [tutorCount, setTutorCount] = useState(0);
  const [studentCount, setStudentCount] = useState(0);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [tutorReferralRequestCount, setTutorReferralRequestCount] = useState(0);
  const [supportRequestCount, setSupportRequestCount] = useState(0);
  const [studentsWithoutTutor, setStudentsWithoutTutor] = useState(0);
  const [studentTutorCount, setStudentTutorCount] = useState(0);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const [walletPair, setWalletPair] = useState<{ tutor_id: string; student_id: string; tutor_name: string; student_name: string } | null>(null);
  const [openLessonId, setOpenLessonId] = useState<string | null>(null);
  const [profitPeriod, setProfitPeriod] = useState<ProfitPeriod>("all");
  const [myStudentCount, setMyStudentCount] = useState<number | null>(null);
  const [addStudentOpen, setAddStudentOpen] = useState(false);
  const [quickLessonOpen, setQuickLessonOpen] = useState(false);

  const [defaultMeetingUrls, setDefaultMeetingUrls] = useState<Record<string, string>>({});
  const [pairCurrency, setPairCurrency] = useState<Record<string, string>>({});

  // Gamification: badge unlock toasts + referral nudge counters
  const { badges, loading: gamificationLoading } = useTutorGamification();
  useBadgeUnlockToasts(badges, gamificationLoading);
  const [referralInvitedCount, setReferralInvitedCount] = useState(0);
  useEffect(() => {
    if (!user || !isIndependentTutor) return;
    supabase
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_id", user.id)
      .then(({ count }) => setReferralInvitedCount(count ?? 0));
  }, [user?.id, isIndependentTutor]);

  // Announce the monthly recap card on the 1st-7th of each month.
  // Without this, tutors often never notice the "Ð¢Ð²ÑÐ¹ <Ð¼ÑÑÑÑÑ>" share-card.
  useEffect(() => {
    if (!user || !isIndependentTutor) return;
    const today = new Date();
    if (today.getDate() > 7) return;
    const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const seenKey = `monthly_recap_announced_${monthKey}`;
    if (localStorage.getItem(seenKey) === "1") return;
    const months = [
      "ÑÑÑÐµÐ½Ñ", "Ð»ÑÑÐ¸Ð¹", "Ð±ÐµÑÐµÐ·ÐµÐ½Ñ", "ÐºÐ²ÑÑÐµÐ½Ñ", "ÑÑÐ°Ð²ÐµÐ½Ñ", "ÑÐµÑÐ²ÐµÐ½Ñ",
      "Ð»Ð¸Ð¿ÐµÐ½Ñ", "ÑÐµÑÐ¿ÐµÐ½Ñ", "Ð²ÐµÑÐµÑÐµÐ½Ñ", "Ð¶Ð¾Ð²ÑÐµÐ½Ñ", "Ð»Ð¸ÑÑÐ¾Ð¿Ð°Ð´", "Ð³ÑÑÐ´ÐµÐ½Ñ",
    ];
    const prevMonthIdx = today.getMonth() === 0 ? 11 : today.getMonth() - 1;
    import("sonner").then(({ toast }) => {
      toast(`ð Ð¢Ð²ÑÐ¹ ${months[prevMonthIdx]} Ð³Ð¾ÑÐ¾Ð²Ð¸Ð¹!`, {
        description: "ÐÐ¾Ð´Ð¸Ð²Ð¸ÑÑ Ð¿ÑÐ´ÑÑÐ¼Ð¾Ðº Ð¼ÑÑÑÑÑ ÑÐ° Ð¿Ð¾Ð´ÑÐ»Ð¸ÑÑ Ð· Ð´ÑÑÐ·ÑÐ¼Ð¸.",
        duration: 8000,
        action: {
          label: "ÐÐ¾Ð´Ð¸Ð²Ð¸ÑÐ¸ÑÑ",
          onClick: () => {
            const el = document.getElementById("monthly-summary-anchor");
            el?.scrollIntoView({ behavior: "smooth", block: "center" });
          },
        },
      });
    });
    localStorage.setItem(seenKey, "1");
  }, [user?.id, isIndependentTutor]);



  const loadData = async () => {
    if (!user) return;

    const [
      { data: lessonsData, error: lessonsError },
      { data: profilesData },
      { data: rolesData },
      { data: requestRows },
      { data: ratesData },
      { data: defaultsData },
      { data: ratesCurrencyData },
    ] = await Promise.all([
      supabase
        .from("lessons_visible")
        .select(
          "id, tutor_id, student_id, subject, starts_at, duration_minutes, status, student_price, tutor_payout, student_payment_status, tutor_payout_status, meeting_url, homework, summary, student_notes, source"
        )
        .order("starts_at", { ascending: true }),
      supabase.from("profiles").select("id, first_name, last_name"),
      supabase.from("user_roles").select("user_id, role"),
      isManager
        ? supabase.from("availability_requests").select("id").eq("status", "open")
        : Promise.resolve({ data: [] as any[] }),
      isManager
        ? supabase.from("student_rates").select("student_id")
        : Promise.resolve({ data: [] as any[] }),
      supabase
        .from("tutor_student_defaults")
        .select("tutor_id, student_id, default_meeting_url"),
      supabase
        .from("student_rates")
        .select("tutor_id, student_id, currency"),
    ]);

    if (lessonsError) {
      toast.error("ÐÐµ Ð²Ð´Ð°Ð»Ð¾ÑÑ Ð·Ð°Ð²Ð°Ð½ÑÐ°Ð¶Ð¸ÑÐ¸ Ð´Ð°Ð½Ñ. ÐÐµÑÐµÐ²ÑÑÑÐµ Ð·'ÑÐ´Ð½Ð°Ð½Ð½Ñ.");
      setLoading(false);
      return;
    }

    const currencyMap: Record<string, string> = {};
    ((ratesCurrencyData ?? []) as Array<{ tutor_id: string; student_id: string; currency: string | null }>).forEach((r) => {
      currencyMap[`${r.tutor_id}:${r.student_id}`] = r.currency ?? "UAH";
    });
    setPairCurrency(currencyMap);

    console.log('[DashboardPage] lessons count:', (lessonsData ?? []).length, 'unique ids:', new Set((lessonsData ?? []).map((l: any) => l.id)).size);

    const profileMap: Record<string, string> = {};
    (profilesData as ProfileRow[] | null ?? []).forEach((profile) => {
      profileMap[profile.id] = `${profile.first_name} ${profile.last_name}`.trim() || "ÐÐµÐ· ÑÐ¼ÐµÐ½Ñ";
    });

    const defaultsMap: Record<string, string> = {};
    ((defaultsData ?? []) as Array<{
      tutor_id: string;
      student_id: string;
      default_meeting_url: string | null;
    }>).forEach((d) => {
      if (d.default_meeting_url && d.default_meeting_url.trim()) {
        defaultsMap[`${d.tutor_id}:${d.student_id}`] = d.default_meeting_url.trim();
      }
    });
    setDefaultMeetingUrls(defaultsMap);

    const roleRows = (rolesData ?? []) as Array<{ user_id: string; role: string }>;
    const tutorIds = roleRows.filter((r) => r.role === "tutor").map((r) => r.user_id);
    const studentIds = roleRows.filter((r) => r.role === "student").map((r) => r.user_id);
    setTutorCount(tutorIds.length);
    setStudentCount(studentIds.length);
    setPendingRequestCount((requestRows ?? []).length);

    if (isManager) {
      const [{ count: trCount }, { count: srCount }] = await Promise.all([
        supabase
          .from("tutor_referral_requests")
          .select("id", { count: "exact", head: true })
          .in("status", ["open", "in_progress"]),
        supabase
          .from("subscription_requests")
          .select("id", { count: "exact", head: true })
          .in("status", ["new", "in_progress"]),
      ]);
      setTutorReferralRequestCount(trCount ?? 0);
      setSupportRequestCount(srCount ?? 0);
    }

    if (isManager) {
      const linkedStudentIds = new Set<string>();
      ((ratesData ?? []) as Array<{ student_id: string }>).forEach((r) =>
        linkedStudentIds.add(r.student_id)
      );
      setStudentsWithoutTutor(studentIds.filter((id) => !linkedStudentIds.has(id)).length);
    }

    if (isStudent && !isManager && !isTutor) {
      const lessonRows = ((lessonsData ?? []) as LessonRow[]).filter((l) => l.student_id === user.id);
      const fromLessons = new Set(lessonRows.map((l) => l.tutor_id));
      const { data: myRates } = await supabase
        .from("student_rates")
        .select("tutor_id")
        .eq("student_id", user.id);
      (myRates ?? []).forEach((r: any) => fromLessons.add(r.tutor_id));
      setStudentTutorCount(fromLessons.size);
    }

    setProfiles(profileMap);
    const uniqueLessons = Array.from(
      new Map(((lessonsData ?? []) as LessonRow[]).map((l) => [l.id, l])).values()
    );
    setLessons(uniqueLessons);

    if (isIndependentTutor) {
      const { count } = await supabase
        .from("student_rates")
        .select("student_id", { count: "exact", head: true })
        .eq("tutor_id", user.id)
        .eq("source", "independent");
      setMyStudentCount(count ?? 0);
    }

    setLoading(false);
  };

  const updateStatus = async (lessonId: string, newStatus: LessonStatus) => {
    const { error } = await supabase.from("lessons").update({ status: newStatus }).eq("id", lessonId);
    if (error) {
      toast.error("ÐÐµ Ð²Ð´Ð°Ð»Ð¾ÑÑ Ð·Ð¼ÑÐ½Ð¸ÑÐ¸ ÑÑÐ°ÑÑÑ ÑÑÐ¾ÐºÑ. Ð¡Ð¿ÑÐ¾Ð±ÑÐ¹ÑÐµ ÑÐµ ÑÐ°Ð·.");
      return;
    }
    setLessons((prev) => prev.map((l) => (l.id === lessonId ? { ...l, status: newStatus } : l)));
  };

  const updatePayment = async (
    lessonId: string,
    field: "student_payment_status" | "tutor_payout_status",
    value: PaymentStatus,
  ) => {
    const paidAtField = field === "student_payment_status" ? "student_paid_at" : "tutor_paid_at";
    const { error } = await supabase
      .from("lesson_details")
      .upsert(
        {
          lesson_id: lessonId,
          [field]: value,
          [paidAtField]: value === "paid" ? new Date().toISOString() : null,
        } as any,
        { onConflict: "lesson_id" },
      );
    if (error) {
      toast.error("ÐÐµ Ð²Ð´Ð°Ð»Ð¾ÑÑ Ð¾Ð½Ð¾Ð²Ð¸ÑÐ¸ Ð¾Ð¿Ð»Ð°ÑÑ. Ð¡Ð¿ÑÐ¾Ð±ÑÐ¹ÑÐµ ÑÐµ ÑÐ°Ð·.");
      return;
    }
    setLessons((prev) => prev.map((l) => (l.id === lessonId ? { ...l, [field]: value } : l)));
  };

  useEffect(() => {
    setLoading(true);
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const todayKey = new Date().toISOString().slice(0, 10);
  const nowMs = Date.now();

  const todayLessons = useMemo(
    () => lessons.filter((lesson) => lesson.starts_at.slice(0, 10) === todayKey),
    [lessons, todayKey]
  );

  const upcomingAll = useMemo(
    () =>
      lessons
        .filter((lesson) => new Date(lesson.starts_at).getTime() >= nowMs - 60 * 60 * 1000)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [lessons, nowMs]
  );
  const todayPlusTomorrowLessons = useMemo(() => {
    const tmr = new Date();
    tmr.setDate(tmr.getDate() + 1);
    const tmrKey = tmr.toISOString().slice(0, 10);
    return upcomingAll.filter((l) => {
      const k = l.starts_at.slice(0, 10);
      return k === todayKey || k === tmrKey;
    });
  }, [upcomingAll, todayKey]);
  const upcomingLessons = showAllUpcoming ? upcomingAll : todayPlusTomorrowLessons;

  const needsMarkLessons = useMemo(
    () => lessons.filter((l) => l.status === 'scheduled' && new Date(l.starts_at) < new Date()),
    [lessons, nowMs]
  );

  // ===== Profit (with period) =====
  const periodStart = useMemo(() => {
    const d = new Date();
    if (profitPeriod === "month") {
      return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    }
    if (profitPeriod === "week") {
      const day = (d.getDay() + 6) % 7;
      const ws = new Date(d);
      ws.setDate(d.getDate() - day);
      ws.setHours(0, 0, 0, 0);
      return ws.getTime();
    }
    return 0;
  }, [profitPeriod]);

  const billableLessons = useMemo(
    () =>
      lessons.filter((l) => {
        if (l.status === "cancelled" || l.status === "pending") return false;
        if (new Date(l.starts_at).getTime() < periodStart) return false;
        if (l.status === "completed") return true;
        const isPast = new Date(l.starts_at).getTime() < nowMs;
        const hasPayment =
          l.student_payment_status === "paid" || l.tutor_payout_status === "paid";
        return isPast || hasPayment;
      }),
    [lessons, periodStart, nowMs]
  );

  const totalIncome = billableLessons
    .filter((l) => l.student_payment_status === "paid")
    .reduce((s, l) => s + Number(l.student_price), 0);
  const totalExpense = billableLessons
    .filter((l) => l.tutor_payout_status === "paid")
    .reduce((s, l) => s + Number(l.tutor_payout), 0);
  const profit = totalIncome - totalExpense;

  const pendingPayments = useMemo(
    () =>
      lessons.filter((l) => {
        if (l.status === "cancelled" || l.status === "pending") return false;
        const isPast = new Date(l.starts_at).getTime() < nowMs;
        const counts = l.status === "completed" || isPast;
        return (
          counts &&
          (l.student_payment_status === "unpaid" || l.tutor_payout_status === "unpaid")
        );
      }),
    [lessons, nowMs]
  );

  const lessonsWithoutPrice = useMemo(
    () =>
      lessons.filter(
        (l) =>
          (l.status === "scheduled" || l.status === "completed") &&
          (Number(l.student_price) === 0 || Number(l.tutor_payout) === 0)
      ).length,
    [lessons]
  );

  const effectiveMeetingUrl = (l: LessonRow): string | null => {
    if (l.meeting_url && l.meeting_url.trim()) return l.meeting_url.trim();
    const fallback = defaultMeetingUrls[`${l.tutor_id}:${l.student_id}`];
    return fallback || null;
  };

  const lessonsWithoutMeeting = useMemo(
    () =>
      lessons.filter(
        (l) =>
          l.status === "scheduled" &&
          new Date(l.starts_at).getTime() >= nowMs &&
          !effectiveMeetingUrl(l)
      ).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lessons, nowMs, defaultMeetingUrls]
  );

  const pendingLessonRequests = useMemo(
    () => lessons.filter((l) => l.status === "pending").length,
    [lessons]
  );

  // Used to gate the referral nudge banner â show only after the tutor has
  // completed enough lessons to actually understand the product's value.
  const myCompletedLessonsCount = useMemo(
    () =>
      user
        ? lessons.filter((l) => l.tutor_id === user.id && l.status === "completed").length
        : 0,
    [lessons, user?.id]
  );

  const profitPeriodLabel: Record<ProfitPeriod, string> = {
    all: "Ð·Ð° Ð²ÐµÑÑ ÑÐ°Ñ",
    month: "Ð·Ð° ÑÐµÐ¹ Ð¼ÑÑÑÑÑ",
    week: "Ð·Ð° ÑÐµÐ¹ ÑÐ¸Ð¶Ð´ÐµÐ½Ñ",
  };

  const statusLabel: Record<LessonStatus, string> = {
    pending: "ÐÐ°Ð¿Ð¸Ñ",
    scheduled: "ÐÐ°Ð¿Ð»Ð°Ð½Ð¾Ð²Ð°Ð½Ð¾",
    completed: "ÐÑÐ¾Ð²ÐµÐ´ÐµÐ½Ð¾",
    cancelled: "Ð¡ÐºÐ°ÑÐ¾Ð²Ð°Ð½Ð¾",
  };

  const firstName = useMemo(() => {
    const fromProfile = user?.id ? profiles[user.id]?.split(" ")[0] : "";
    return fromProfile || user?.email?.split("@")[0] || "";
  }, [profiles, user?.email, user?.id]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "ÐÐ¾Ð±ÑÐ¾Ð³Ð¾ ÑÐ°Ð½ÐºÑ";
    if (hour < 18) return "ÐÐ¾Ð±ÑÐ¾Ð³Ð¾ Ð´Ð½Ñ";
    return "ÐÐ¾Ð±ÑÐ¾Ð³Ð¾ Ð²ÐµÑÐ¾ÑÐ°";
  }, []);

  const timeEmoji = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "âï¸";
    if (h < 18) return "ð";
    if (h < 22) return "ð";
    return "ð";
  }, []);

  const phraseOfDay = useMemo(() => {
    const start = new Date(new Date().getFullYear(), 0, 0).getTime();
    const day = Math.floor((Date.now() - start) / 86_400_000);
    return dayAffirmations[day % dayAffirmations.length];
  }, []);

  // Smart tasks list (manager-only)
  const smartTasks = useMemo(() => {
    if (!isManager) return [] as Array<{
      key: string;
      icon: any;
      tone: "warning" | "destructive" | "primary";
      title: string;
      description: string;
      to: string;
      cta: string;
    }>;
    const tasks = [];
    // 1. Pending payments â top priority for everyone, but smartTasks is manager-only here
    if (pendingPayments.length > 0) {
      tasks.push({
        key: "pending-payments",
        icon: TrendingUp,
        tone: "warning" as const,
        title: `ÐÑÑÐºÑÑÑÑ Ð¾Ð¿Ð»Ð°ÑÐ¸: ${pendingPayments.length}`,
        description: "ÐÐ°Ð²ÐµÑÑÐµÐ½Ñ ÑÑÐ¾ÐºÐ¸ Ð±ÐµÐ· Ð¿Ð¾Ð²Ð½Ð¾Ñ Ð¾Ð¿Ð»Ð°ÑÐ¸ Ð°Ð±Ð¾ Ð²Ð¸Ð¿Ð»Ð°ÑÐ¸.",
        to: "/finances",
        cta: "ÐÐµÑÐµÐ¹ÑÐ¸ Ð´Ð¾ ÑÑÐ½Ð°Ð½ÑÑÐ²",
      });
    }
    // 2. Tutor referral requests (students looking for a tutor)
    if (tutorReferralRequestCount > 0) {
      tasks.push({
        key: "tutor-referral-requests",
        icon: HandHeart,
        tone: "destructive" as const,
        title: `${tutorReferralRequestCount} Ð·Ð°Ð¿Ð¸Ñ${
          tutorReferralRequestCount === 1 ? "" : tutorReferralRequestCount < 5 ? "Ð¸" : "ÑÐ²"
        } Ð½Ð° ÑÐµÐ¿ÐµÑÐ¸ÑÐ¾ÑÐ°`,
        description: "Ð£ÑÐ½Ñ Ð·Ð°Ð»Ð¸ÑÐ¸Ð»Ð¸ Ð·Ð°ÑÐ²ÐºÑ â Ð¿ÑÐ´Ð±ÐµÑÑÑÑ ÑÐ°ÑÑÐ²ÑÑ.",
        to: "/referrals",
        cta: "ÐÐµÑÐµÐ³Ð»ÑÐ½ÑÑÐ¸ Ð·Ð°ÑÐ²ÐºÐ¸",
      });
    }
    // 3. Support / subscription requests
    if (supportRequestCount > 0) {
      tasks.push({
        key: "support-requests",
        icon: AlertTriangle,
        tone: "warning" as const,
        title: `${supportRequestCount} Ð·Ð²ÐµÑÐ½ÐµÐ½${
          supportRequestCount === 1 ? "Ð½Ñ" : supportRequestCount < 5 ? "Ð½Ñ" : "Ñ"
        } Ñ ÑÐ»ÑÐ¶Ð±Ñ Ð¿ÑÐ´ÑÑÐ¸Ð¼ÐºÐ¸`,
        description: "Ð ÐµÐ¿ÐµÑÐ¸ÑÐ¾ÑÐ¸ Ð½Ð°Ð´ÑÑÐ»Ð°Ð»Ð¸ Ð·Ð°Ð¿Ð¸ÑÐ°Ð½Ð½Ñ â Ð´Ð°Ð¹ÑÐµ Ð²ÑÐ´Ð¿Ð¾Ð²ÑÐ´Ñ.",
        to: "/subscription-requests",
        cta: "ÐÑÐ´ÐºÑÐ¸ÑÐ¸ Ð·Ð²ÐµÑÐ½ÐµÐ½Ð½Ñ",
      });
    }
    // 4. Students without a tutor
    if (studentsWithoutTutor > 0) {
      tasks.push({
        key: "students-no-tutor",
        icon: UserX,
        tone: "destructive" as const,
        title: `${studentsWithoutTutor} ÑÑÐ½${
          studentsWithoutTutor === 1 ? "ÑÐ²" : studentsWithoutTutor < 5 ? "ÑÐ²" : "ÑÐ²"
        } Ð±ÐµÐ· ÑÐµÐ¿ÐµÑÐ¸ÑÐ¾ÑÐ°`,
        description: "ÐÑÐ¸Ð·Ð½Ð°ÑÑÐµ ÑÑÐ°Ð²ÐºÑ â Ð±ÐµÐ· Ð½ÐµÑ Ð½Ðµ Ð±ÑÐ´Ðµ Ð½Ñ ÑÑÐ¾ÐºÑÐ², Ð½Ñ ÑÐ°ÑÑÐ².",
        to: "/people",
        cta: "ÐÑÐ´ÐºÑÐ¸ÑÐ¸ Ð»ÑÐ´ÐµÐ¹",
      });
    }
    // 5. Lessons without meeting link
    if (lessonsWithoutMeeting > 0) {
      tasks.push({
        key: "no-meeting",
        icon: Video,
        tone: "primary" as const,
        title: `${lessonsWithoutMeeting} Ð¼Ð°Ð¹Ð±ÑÑÐ½ÑÑ ÑÑÐ¾ÐºÑÐ² Ð±ÐµÐ· Ð¿Ð¾ÑÐ¸Ð»Ð°Ð½Ð½Ñ`,
        description: "Ð ÐµÐ¿ÐµÑÐ¸ÑÐ¾ÑÐ¸ Ð½Ðµ Ð²ÐºÐ°Ð·Ð°Ð»Ð¸ Ð»ÑÐ½Ðº Ð½Ð° Ð·ÑÑÑÑÑÑ.",
        to: "/schedule",
        cta: "ÐÑÐ´ÐºÑÐ¸ÑÐ¸ ÑÐ¾Ð·ÐºÐ»Ð°Ð´",
      });
    }
    // Lower-priority items (kept for completeness)
    if (pendingLessonRequests > 0) {
      tasks.push({
        key: "pending-lessons",
        icon: AlertTriangle,
        tone: "warning" as const,
        title: `${pendingLessonRequests} Ð·Ð°Ð¿Ð¸Ñ${
          pendingLessonRequests === 1 ? "" : pendingLessonRequests < 5 ? "Ð¸" : "ÑÐ²"
        } Ð½Ð° ÑÑÐ¾ÐºÐ¸`,
        description: "Ð£ÑÐ½Ñ ÑÐµÐºÐ°ÑÑÑ Ð¿ÑÐ´ÑÐ²ÐµÑÐ´Ð¶ÐµÐ½Ð½Ñ ÑÐ°ÑÑ.",
        to: "/schedule",
        cta: "ÐÑÐ´ÐºÑÐ¸ÑÐ¸ ÑÐ¾Ð·ÐºÐ»Ð°Ð´",
      });
    }
    if (pendingRequestCount > 0) {
      tasks.push({
        key: "availability-requests",
        icon: CalendarPlus,
        tone: "warning" as const,
        title: `${pendingRequestCount} Ð·Ð°Ð¿Ð¸Ñ${
          pendingRequestCount === 1 ? "" : pendingRequestCount < 5 ? "Ð¸" : "ÑÐ²"
        } Ð½Ð° Ð¿ÑÐ¾ÑÑÐ°Ð²Ð»ÐµÐ½Ð½Ñ Ð³Ð¾Ð´Ð¸Ð½`,
        description: "Ð ÐµÐ¿ÐµÑÐ¸ÑÐ¾ÑÐ¸ Ð°Ð±Ð¾ ÑÑÐ½Ñ Ð¿ÑÐ¾ÑÑÑÑ Ð¾Ð½Ð¾Ð²Ð¸ÑÐ¸ Ð´Ð¾ÑÑÑÐ¿Ð½Ñ Ð³Ð¾Ð´Ð¸Ð½Ð¸.",
        to: "/availability",
        cta: "ÐÐµÑÐµÐ¹ÑÐ¸ Ð´Ð¾ Ð³Ð¾Ð´Ð¸Ð½",
      });
    }
    if (lessonsWithoutPrice > 0) {
      tasks.push({
        key: "no-price",
        icon: Tag,
        tone: "warning" as const,
        title: `${lessonsWithoutPrice} ÑÑÐ¾ÐºÑÐ² Ð±ÐµÐ· ÑÑÐ½Ð¸`,
        description: "ÐÐ¾Ð´Ð°Ð¹ÑÐµ ÑÑÐ°Ð²ÐºÑ, ÑÐ¾Ð± ÐºÐ¾ÑÐµÐºÑÐ½Ð¾ ÑÐ°ÑÑÐ²Ð°ÑÐ¸ ÑÑÐ½Ð°Ð½ÑÐ¸.",
        to: "/schedule",
        cta: "ÐÑÐ´ÐºÑÐ¸ÑÐ¸ ÑÑÐ¾ÐºÐ¸",
      });
    }
    return tasks;
  }, [
    isManager,
    pendingLessonRequests,
    pendingRequestCount,
    tutorReferralRequestCount,
    supportRequestCount,
    studentsWithoutTutor,
    lessonsWithoutPrice,
    lessonsWithoutMeeting,
    pendingPayments.length,
  ]);

  return (
    <AppLayout>
      <div className="relative mb-6 overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 via-primary/10 to-primary/5 p-6 shadow-[0_8px_32px_-12px_hsl(var(--primary)/0.25)] sm:mb-8 sm:p-8">
        <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-primary/10" />
        <div className="pointer-events-none absolute -left-10 bottom-0 h-28 w-28 rounded-full bg-primary/10" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {greeting}{firstName ? `, ${firstName}` : ""}! <span className="ml-1">{timeEmoji}</span>
            </h1>
            <p className="mt-3 max-w-lg text-sm italic text-muted-foreground">
              <span className="not-italic font-medium text-primary/80">ÐÑÑÑÐ¼Ð°ÑÑÑ Ð´Ð½Ñ: </span>
              {phraseOfDay}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <div className="flex items-center gap-1.5 rounded-lg bg-background/60 px-3 py-1.5 text-xs text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5 text-primary" />
                Ð¡ÑÐ¾Ð³Ð¾Ð´Ð½Ñ {todayLessons.length}{" "}
                {todayLessons.length === 1 ? "ÑÑÐ¾Ðº" : todayLessons.length < 5 && todayLessons.length !== 0 ? "ÑÑÐ¾ÐºÐ¸" : "ÑÑÐ¾ÐºÑÐ²"}
              </div>
              {pendingPayments.length > 0 && (
                <div className="flex items-center gap-1.5 rounded-lg bg-warning/10 px-3 py-1.5 text-xs text-warning">
                  <Clock className="h-3.5 w-3.5" />
                  {pendingPayments.length} Ð¾ÑÑÐºÑÑÑÑ Ð¾Ð¿Ð»Ð°ÑÐ¸
                </div>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {isManager && (
              <>
                <Button asChild variant="outline" size="sm"><Link to="/people">{t("dashboard.btnPeople")}</Link></Button>
                <Button asChild size="icon" title={t("dashboard.btnPayments")} aria-label={t("dashboard.btnPayments")}>
                  <Link to="/finances"><Wallet className="h-4 w-4" /></Link>
                </Button>
              </>
            )}
            {isTutor && !isManager && (
              <Button size="sm" onClick={() => setQuickLessonOpen(true)}>
                <Plus className="h-4 w-4" />
                {t("dashboard.btnCreateLesson")}
              </Button>
            )}
            {isStudent && !isTutor && !isManager && (
              <FindTutorDialog
                trigger={
                  <Button size="sm">
                    <HandHeart className="h-4 w-4" />
                    {t("dashboard.btnRequestTutor")}
                  </Button>
                }
              />
            )}
          </div>
        </div>
      </div>

      <QuickLessonDialog
        open={quickLessonOpen}
        onOpenChange={setQuickLessonOpen}
        startsAt={quickLessonOpen ? new Date() : null}
        onCreated={loadData}
        onWantFullForm={() => { setQuickLessonOpen(false); navigate("/schedule"); }}
      />

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-6 sm:space-y-8">
          {isIndependentTutor && <TrialCountdownBanner />}
          {isManager && (
            <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
              <StatCard label={t("dashboard.cardTutors")} value={tutorCount} icon={Users} to="/people" />
              <StatCard label={t("dashboard.cardStudents")} value={studentCount} icon={Users} to="/people" />
              <StatCard label={t("dashboard.todayLessons")} value={todayLessons.length} icon={CalendarDays} to="/schedule" />
              <div className="rounded-2xl border border-border bg-card p-2.5 transition-colors hover:border-success/40">
                <div className="flex items-start justify-between gap-1.5">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium leading-tight text-muted-foreground">
                      {t("dashboard.cardProfit")}
                    </p>
                    <Link to="/finances" className="block">
                      <p
                        className={`mt-0.5 truncate font-display text-base font-bold sm:text-lg ${
                          profit >= 0 ? "text-success" : "text-destructive"
                        }`}
                      >
                        {formatPrice(profit, "UAH")}
                      </p>
                    </Link>
                  </div>
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-success/10">
                    <TrendingUp className="h-3.5 w-3.5 text-success" />
                  </div>
                </div>
                <Select value={profitPeriod} onValueChange={(v) => setProfitPeriod(v as ProfitPeriod)}>
                  <SelectTrigger className="mt-1.5 h-6 w-full text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("dashboard.periodAll")}</SelectItem>
                    <SelectItem value="month">{t("dashboard.periodMonth")}</SelectItem>
                    <SelectItem value="week">{t("dashboard.periodWeek")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {isIndependentTutor && <TutorWelcomeBanner />}
          {isIndependentTutor && <AutoCompleteLessonsCard />}
          {(isTutor || isManager) && (
            <div className="mt-4 space-y-4">
              <QuickActionsCard onChanged={loadData} />
              <TutorNotesCard />
            </div>
          )}
          {isIndependentTutor && (
            <ReferralNudgeBanner
              completedLessons={myCompletedLessonsCount}
              invitedCount={referralInvitedCount}
            />
          )}
          {isIndependentTutor && <IndependentTutorStats />}
          {isTutor && !isManager && (
            <div className="mt-4">
              <PendingPaymentsCard />
            </div>
          )}
          {isIndependentTutor && (
            <div id="monthly-summary-anchor" className="mt-6 grid gap-4 lg:grid-cols-2">
              <MonthlySummaryCard />
              <ReferralWidget compact />
            </div>
          )}

          {isStudent && !isTutor && !isManager && user && (
            <div className="mt-4">
              <StudentWalletCard studentId={user.id} />
            </div>
          )}

          {/* "ÐÐ¾ ÑÐ²Ð°Ð³Ð¸" â past scheduled lessons not yet marked. Manager: across all tutors. Tutor: own only. */}
          {(isManager || (isTutor && !isManager)) && user && (
            <NeedsMarkingCard
              lessons={lessons.filter((l) => {
                if (l.status !== "scheduled") return false;
                if (!isManager && l.tutor_id !== user.id) return false;
                return true;
              })}
              studentNames={profiles}
              onChanged={loadData}
            />
          )}

          {needsMarkLessons.length > 0 && (
            <section className="mb-6">
              <div className="mb-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <h2 className="text-base font-semibold">Потребують відмітки</h2>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{needsMarkLessons.length}</span>
              </div>
              <div className="space-y-2">
                {needsMarkLessons.map((lesson) => (
                  <LessonCard
                    key={lesson.id}
                    lesson={{ ...lesson, currency: pairCurrency[`${lesson.tutor_id}_${lesson.student_id}`] ?? 'UAH' }}
                    variant="schedule"
                    studentName={profiles[lesson.student_id] ?? '—'}
                    onContentClick={() => setOpenLessonId(lesson.id)}
                    className={lessonSourceTint(lesson.source)}
                  />
                ))}
              </div>
            </section>
          )}

          <div className="grid gap-6 lg:gap-8 xl:grid-cols-2">
            <section>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-lg font-semibold text-foreground">{t("dashboard.upcomingLessons")}</h2>
                {upcomingAll.length > todayPlusTomorrowLessons.length && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowAllUpcoming((v) => !v)}
                  >
                    {showAllUpcoming ? t("dashboard.hide") : t("dashboard.showAll", { count: upcomingAll.length })}
                  </Button>
                )}
              </div>
              <div className={`space-y-3 ${showAllUpcoming ? "max-h-[60vh] overflow-y-auto pr-1" : ""}`}>
                {upcomingLessons.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
                    {isIndependentTutor && (myStudentCount ?? 0) === 0 ? (
                      <div className="space-y-2">
                        <p className="font-medium text-foreground">ð ÐÐ¾Ð´Ð°Ð¹ Ð¿ÐµÑÑÐ¾Ð³Ð¾ ÑÑÐ½Ñ â ÑÐµ Ð·Ð°Ð¹Ð¼Ðµ 2 ÑÐ²Ð¸Ð»Ð¸Ð½Ð¸</p>
                        <p className="text-xs">ÐÐ²ÐµÐ´Ð¸ ÑÐ¼'Ñ Ñ ÑÑÐ°Ð²ÐºÑ â Ð´Ð°Ð»Ñ ÑÑÐ²Ð¾ÑÐ¸Ñ ÑÑÐ¾Ðº Ð¾Ð´Ð½Ð¸Ð¼ ÐºÐ»ÑÐºÐ¾Ð¼.</p>
                        <Button size="sm" className="mt-1" onClick={() => setAddStudentOpen(true)}>
                          <Plus className="h-4 w-4" />
                          ÐÐ¾Ð´Ð°ÑÐ¸ Ð¿ÐµÑÑÐ¾Ð³Ð¾ ÑÑÐ½Ñ
                        </Button>
                      </div>
                    ) : (
                      <>
                        {t("dashboard.noUpcoming")}
                        {isTutor && !isManager && (
                          <Button asChild size="sm" className="ml-3">
                            <Link to="/schedule">{t("dashboard.btnCreateLesson")}</Link>
                          </Button>
                        )}
                        {isStudent && !isTutor && !isManager && (
                          <span className="ml-3 inline-block">
                            <FindTutorDialog
                              trigger={<Button size="sm">{t("dashboard.btnRequestTutor")}</Button>}
                            />
                          </span>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  upcomingLessons.map((lesson) => {
                    const isParticipant = user?.id === lesson.tutor_id || user?.id === lesson.student_id;
                    const meetingHref = effectiveMeetingUrl(lesson);
                    const tutorName = profiles[lesson.tutor_id] ?? "â";
                    const studentName = profiles[lesson.student_id] ?? "â";

                    if (isManager && !isParticipant) {
                      const canEditStatus = true;
                      return (
                        <LessonCard
                          key={lesson.id}
                          lesson={{ ...lesson, currency: pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`] }}
                          variant="schedule"
                          studentName={studentName}
                          tutorName={tutorName}
                          showTutor
                          meetingUrl={meetingHref}
                          onContentClick={() => setOpenLessonId(lesson.id)}
                          className={lessonSourceTint(lesson.source)}
                          extraActions={
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="min-h-[44px]"
                                onClick={() => setOpenLessonId(lesson.id)}
                              >
                                ÐÑÐ´ÐºÑÐ¸ÑÐ¸
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                title="ÐÐ¾Ð¿Ð¾Ð²Ð½Ð¸ÑÐ¸ Ð³Ð°Ð¼Ð°Ð½ÐµÑÑ"
                                onClick={() =>
                                  setWalletPair({
                                    tutor_id: lesson.tutor_id,
                                    student_id: lesson.student_id,
                                    tutor_name: tutorName,
                                    student_name: studentName,
                                  })
                                }
                              >
                                <Wallet className="h-4 w-4" />
                              </Button>
                              {canEditStatus ? (
                                <Select
                                  value={lesson.status}
                                  onValueChange={(v) => updateStatus(lesson.id, v as LessonStatus)}
                                >
                                  <SelectTrigger className="h-11 w-[140px] text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {(["pending", "scheduled", "completed", "cancelled"] as LessonStatus[]).map((s) => (
                                      <SelectItem key={s} value={s}>{statusLabel[s]}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : null}
                            </>
                          }
                          footer={
                            <div className="mt-2 grid grid-cols-1 gap-1.5 xs:grid-cols-2">
                              <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1">
                                <span className="whitespace-nowrap text-[11px] font-medium text-foreground">
                                  ð {formatPrice(lesson.student_price, pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`])}
                                </span>
                                <Select
                                  value={lesson.student_payment_status}
                                  onValueChange={(v) => updatePayment(lesson.id, "student_payment_status", v as PaymentStatus)}
                                >
                                  <SelectTrigger className={`h-6 min-w-0 flex-1 border-0 px-2 text-[11px] font-medium ${lesson.student_payment_status === "paid" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="unpaid">â³ ÐÑÑÐºÑÑ</SelectItem>
                                    <SelectItem value="paid">â ÐÐ¿Ð»Ð°ÑÐµÐ½Ð¾</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1">
                                <span className="whitespace-nowrap text-[11px] font-medium text-foreground">
                                  ð¼ {formatPrice(lesson.tutor_payout, pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`])}
                                </span>
                                <Select
                                  value={lesson.tutor_payout_status}
                                  onValueChange={(v) => updatePayment(lesson.id, "tutor_payout_status", v as PaymentStatus)}
                                >
                                  <SelectTrigger className={`h-6 min-w-0 flex-1 border-0 px-2 text-[11px] font-medium ${lesson.tutor_payout_status === "paid" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="unpaid">â³ ÐÑÑÐºÑÑ</SelectItem>
                                    <SelectItem value="paid">â ÐÐ¸Ð¿Ð»Ð°ÑÐµÐ½Ð¾</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          }
                        />
                      );
                    }

                    const partnerId =
                      user?.id === lesson.tutor_id ? lesson.student_id : lesson.tutor_id;
                    const canEditStatus = isManager || (isTutor && lesson.tutor_id === user?.id);

                    return (
                      <LessonCard
                        key={lesson.id}
                        lesson={{ ...lesson, currency: pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`] }}
                        variant="schedule"
                        studentName={studentName}
                        tutorName={tutorName}
                        showTutor={isManager}
                        meetingUrl={meetingHref}
                        chatPartnerId={partnerId}
                        onContentClick={() => setOpenLessonId(lesson.id)}
                        className={lessonSourceTint(lesson.source)}
                        extraActions={
                          canEditStatus ? (
                            <Select
                              value={lesson.status}
                              onValueChange={(v) => updateStatus(lesson.id, v as LessonStatus)}
                            >
                              <SelectTrigger className="h-11 w-[140px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(isManager
                                  ? (["pending", "scheduled", "completed", "cancelled"] as LessonStatus[])
                                  : (["scheduled", "completed", "cancelled"] as LessonStatus[])
                                ).map((s) => (
                                  <SelectItem key={s} value={s}>{statusLabel[s]}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : null
                        }
                        footer={
                          isManager ? (
                            <div className="mt-2 grid grid-cols-1 gap-1.5 xs:grid-cols-2">
                              <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1">
                                <span className="whitespace-nowrap text-[11px] font-medium text-foreground">
                                  ð {formatPrice(lesson.student_price, pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`])}
                                </span>
                                <Select
                                  value={lesson.student_payment_status}
                                  onValueChange={(v) => updatePayment(lesson.id, "student_payment_status", v as PaymentStatus)}
                                >
                                  <SelectTrigger className={`h-6 min-w-0 flex-1 border-0 px-2 text-[11px] font-medium ${lesson.student_payment_status === "paid" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="unpaid">â³ ÐÑÑÐºÑÑ</SelectItem>
                                    <SelectItem value="paid">â ÐÐ¿Ð»Ð°ÑÐµÐ½Ð¾</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1">
                                <span className="whitespace-nowrap text-[11px] font-medium text-foreground">
                                  ð¼ {formatPrice(lesson.tutor_payout, pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`])}
                                </span>
                                <Select
                                  value={lesson.tutor_payout_status}
                                  onValueChange={(v) => updatePayment(lesson.id, "tutor_payout_status", v as PaymentStatus)}
                                >
                                  <SelectTrigger className={`h-6 min-w-0 flex-1 border-0 px-2 text-[11px] font-medium ${lesson.tutor_payout_status === "paid" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="unpaid">â³ ÐÑÑÐºÑÑ</SelectItem>
                                    <SelectItem value="paid">â ÐÐ¸Ð¿Ð»Ð°ÑÐµÐ½Ð¾</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          ) : null
                        }
                      />
                    );
                  })
                )}
              </div>
            </section>

            <section>
              <h2 className="mb-5 font-display text-lg font-semibold text-foreground">{t("dashboard.nextSteps")}</h2>
              {isManager ? (
                <div className="space-y-4">
                  {smartTasks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center">
                      <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-success/10">
                        <TrendingUp className="h-4 w-4 text-success" />
                      </div>
                      <p className="text-sm font-medium text-foreground">Ð£ÑÐµ Ð¿ÑÐ´ ÐºÐ¾Ð½ÑÑÐ¾Ð»ÐµÐ¼ ð</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        ÐÐµÐ¼Ð°Ñ ÑÐµÑÐ¼ÑÐ½Ð¾Ð²Ð¸Ñ Ð·Ð°Ð´Ð°Ñ. ÐÐ¾Ð¶Ð½Ð° Ð¿Ð»Ð°Ð½ÑÐ²Ð°ÑÐ¸ Ð½Ð°ÑÑÑÐ¿Ð½Ð¸Ð¹ ÑÐ¸Ð¶Ð´ÐµÐ½Ñ.
                      </p>
                    </div>
                  ) : (
                    smartTasks.map((task) => {
                      const Icon = task.icon;
                      const toneClass =
                        task.tone === "destructive"
                          ? "border-destructive/40 bg-destructive/5"
                          : task.tone === "warning"
                          ? "border-warning/40 bg-warning/5"
                          : "border-primary/40 bg-primary/5";
                      const iconClass =
                        task.tone === "destructive"
                          ? "bg-destructive/10 text-destructive"
                          : task.tone === "warning"
                          ? "bg-warning/10 text-warning"
                          : "bg-primary/10 text-primary";
                      return (
                        <div
                          key={task.key}
                          className={`flex items-start gap-3 rounded-2xl border p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-8px_hsl(var(--foreground)/0.12)] ${toneClass}`}
                        >
                          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground">{task.title}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{task.description}</p>
                            <Button asChild size="sm" className="mt-3">
                              <Link to={task.to}>{task.cta}</Link>
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <TelegramLinkCard />
                </div>
              ) : (
                <div className="space-y-4">
                  {isStudent && (
                    <>
                      {studentTutorCount > 0 ? (
                        <div className="rounded-xl border border-border bg-card p-4">
                          <div className="flex items-start gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                              <CalendarDays className="h-4 w-4 text-primary" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-foreground">Ð£ÑÐ¾ÐºÐ¸ Ð¿ÑÐ¸Ð·Ð½Ð°ÑÐ°Ñ ÑÐµÐ¿ÐµÑÐ¸ÑÐ¾Ñ</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                ÐÐ°ÑÑ Ð¹ ÑÐ°Ñ Ð½Ð¾Ð²Ð¸Ñ ÑÑÐ¾ÐºÑÐ² Ð´Ð¾Ð´Ð°Ñ Ð²Ð°Ñ ÑÐµÐ¿ÐµÑÐ¸ÑÐ¾Ñ Ð°Ð±Ð¾ Ð¼ÐµÐ½ÐµÐ´Ð¶ÐµÑ. Ð¯ÐºÑÐ¾ Ð¿Ð¾ÑÑÑÐ±ÐµÐ½ Ð½Ð¾Ð²Ð¸Ð¹ ÑÐ°Ñ â Ð½Ð°Ð¿Ð¸ÑÑÑÑ ÑÐµÐ¿ÐµÑÐ¸ÑÐ¾ÑÑ Ð² ÑÐ°ÑÑ.
                              </p>
                              <div className="mt-3 flex gap-2">
                                <Button asChild size="sm" variant="outline"><Link to="/schedule">ÐÐ¾ ÑÐ¾Ð·ÐºÐ»Ð°Ð´Ñ</Link></Button>
                                <Button asChild size="sm" variant="ghost"><Link to="/chats">Ð§Ð°ÑÐ¸</Link></Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
                          <div className="flex items-start gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                              <HandHeart className="h-4 w-4 text-primary" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-foreground">ÐÑÐ´ÑÐ±ÑÐ°ÑÐ¸ ÑÐµÐ¿ÐµÑÐ¸ÑÐ¾ÑÐ°</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                Ð£ Ð²Ð°Ñ ÑÐµ Ð½ÐµÐ¼Ð°Ñ Ð·Ð°ÐºÑÑÐ¿Ð»ÐµÐ½Ð¾Ð³Ð¾ ÑÐµÐ¿ÐµÑÐ¸ÑÐ¾ÑÐ°. ÐÐ°Ð»Ð¸ÑÑÐµ Ð·Ð°Ð¿Ð¸Ñ â Ð¼ÐµÐ½ÐµÐ´Ð¶ÐµÑ oTutorHub Ð¿ÑÐ´Ð±ÐµÑÐµ ÑÐ°ÑÑÐ²ÑÑ Ð¿ÑÐ´ Ð²Ð°ÑÑ ÑÑÐ»Ñ, Ð±ÑÐ´Ð¶ÐµÑ Ñ Ð³ÑÐ°ÑÑÐº.
                              </p>
                              <div className="mt-3">
                                <FindTutorDialog
                                  trigger={<Button size="sm">ÐÐ°Ð»Ð¸ÑÐ¸ÑÐ¸ Ð·Ð°Ð¿Ð¸Ñ</Button>}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      {studentTutorCount > 0 && (
                        <div className="rounded-xl border border-border bg-card p-4">
                          <div className="flex items-start gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/10">
                              <Users className="h-4 w-4 text-warning" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-foreground">ÐÐ½Ð°Ð¹ÑÐ¸ Ð½Ð¾Ð²Ð¾Ð³Ð¾ ÑÐµÐ¿ÐµÑÐ¸ÑÐ¾ÑÐ°</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                Ð¨ÑÐºÐ°ÑÑÐµ Ð´Ð¾Ð´Ð°ÑÐºÐ¾Ð²Ð¾Ð³Ð¾ ÑÐµÐ¿ÐµÑÐ¸ÑÐ¾ÑÐ°? ÐÐµÐ½ÐµÐ´Ð¶ÐµÑ oTutorHub Ð¿ÑÐ´Ð±ÐµÑÐµ Ð²Ð°Ð¼ ÑÐ¿ÐµÑÑÐ°Ð»ÑÑÑÐ°.
                              </p>
                              <div className="mt-3">
                                <FindTutorDialog
                                  trigger={<Button size="sm" variant="outline">ÐÐ°Ð»Ð¸ÑÐ¸ÑÐ¸ Ð·Ð°Ð¿Ð¸Ñ</Button>}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  {(isTutor || isManager) && (
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <CalendarPlus className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground">ÐÐ½Ð¾Ð²Ð¸ÑÐ¸ Ð´Ð¾ÑÑÑÐ¿Ð½Ñ Ð³Ð¾Ð´Ð¸Ð½Ð¸</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Ð¢ÑÐ¸Ð¼Ð°Ð¹ÑÐµ ÐºÐ°Ð»ÐµÐ½Ð´Ð°Ñ Ð°ÐºÑÑÐ°Ð»ÑÐ½Ð¸Ð¼, ÑÐ¾Ð± ÑÑÐ½Ñ Ð±Ð°ÑÐ¸Ð»Ð¸ Ð²ÑÐ»ÑÐ½Ñ ÑÐ»Ð¾ÑÐ¸.
                          </p>
                          <Button asChild size="sm" variant="outline" className="mt-3">
                            <Link to="/availability">ÐÑÐ´ÐºÑÐ¸ÑÐ¸</Link>
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                  <TelegramLinkCard />
                </div>
              )}
            </section>
          </div>
        </div>
      )}
      {isTutor && !isManager && <QuickPaymentFab />}
      {walletPair && (
        <WalletDialog
          open={!!walletPair}
          onOpenChange={(o) => { if (!o) setWalletPair(null); }}
          tutorId={walletPair.tutor_id}
          studentId={walletPair.student_id}
          tutorName={walletPair.tutor_name}
          studentName={walletPair.student_name}
          canTopUp={isManager}
          canDelete={isManager}
        />
      )}
      <QuickAddStudentDialog
        open={addStudentOpen}
        onOpenChange={setAddStudentOpen}
        onCreated={() => loadData()}
      />
      <LessonDetailsDialog
        lessonId={openLessonId}
        open={!!openLessonId}
        onOpenChange={(o) => { if (!o) setOpenLessonId(null); }}
        onUpdated={loadData}
      />
      <AutoCompletePromptDialog enabled={isIndependentTutor} />
    </AppLayout>
  );
}
