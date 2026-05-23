import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, Video, Users2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { safeHref } from "@/lib/safeUrl";
import { useTranslation } from "react-i18next";

export type LessonCardVariant = "dashboard" | "schedule" | "compact";

export interface LessonCardData {
  id: string;
  subject: string;
  starts_at: string;
  duration_minutes: number;
  meeting_url?: string | null;
  student_price?: number | string | null;
  student_payment_status?: "paid" | "unpaid";
  status?: "pending" | "scheduled" | "completed" | "cancelled";
  /** ISO 4217 code (UAH default). */
  currency?: string | null;
  lesson_type?: "individual" | "pair" | "group" | null;
  group_id?: string | null;
}

interface LessonCardProps {
  lesson: LessonCardData;
  variant?: LessonCardVariant;
  studentName?: string;
  tutorName?: string;
  groupName?: string;
  groupSize?: number;
  showTutor?: boolean;
  meetingUrl?: string | null;
  /** Toggle handler — kept for API compat; renders the same static badge either way (no big "Отримав" pill). */
  onTogglePayment?: () => void;
  chatPartnerId?: string | null;
  /** Extra actions (status select, etc.) rendered in the right action row. */
  extraActions?: ReactNode;
  /** Compact icon actions (edit/copy/delete) pinned to the top-right corner. */
  topRightActions?: ReactNode;
  footer?: ReactNode;
  className?: string;
  onContentClick?: () => void;
}

const STATUS_CLASS: Record<NonNullable<LessonCardData["status"]>, string> = {
  pending: "bg-warning/15 text-warning ring-1 ring-warning/30",
  scheduled: "bg-primary/15 text-primary ring-1 ring-primary/30",
  completed: "bg-success/15 text-success ring-1 ring-success/30",
  cancelled: "bg-destructive/15 text-destructive ring-1 ring-destructive/30 line-through",
};

const STATUS_KEY: Record<NonNullable<LessonCardData["status"]>, string> = {
  pending: "lessonCard.statusPending",
  scheduled: "lessonCard.statusScheduled",
  completed: "lessonCard.statusCompleted",
  cancelled: "lessonCard.statusCancelled",
};

export function LessonCard({
  lesson,
  variant = "schedule",
  studentName,
  tutorName,
  groupName,
  groupSize,
  showTutor = false,
  meetingUrl,
  onTogglePayment,
  chatPartnerId,
  extraActions,
  topRightActions,
  footer,
  className,
  onContentClick,
}: LessonCardProps) {
  const { t, i18n } = useTranslation();

  const fmtDateTime = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const isToday = d.toDateString() === today.toDateString();
    const isTomorrow = d.toDateString() === tomorrow.toDateString();
    const locale = i18n.language === "sv" ? "sv-SE" : i18n.language === "en" ? "en-GB" : "uk-UA";
    const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    if (isToday) return t("lessonCard.today", { time });
    if (isTomorrow) return t("lessonCard.tomorrow", { time });
    return d.toLocaleDateString(locale, { day: "numeric", month: "short" }) + ` · ${time}`;
  };

  const isGroup = lesson.lesson_type === "pair" || lesson.lesson_type === "group";
  const titleLabel = isGroup
    ? groupName ?? (groupSize ? t("lessonCard.groupStudents", { count: groupSize }) : t("lessonCard.group"))
    : studentName ?? "—";
  const startMs = new Date(lesson.starts_at).getTime();
  const endMs = startMs + (lesson.duration_minutes ?? 0) * 60_000;
  const nowMs = Date.now();

  const isNow = nowMs >= startMs && nowMs < endMs && lesson.status !== "cancelled";
  const isPast = endMs < nowMs;
  const isCancelled = lesson.status === "cancelled";
  const href = useMemo(() => (meetingUrl ? safeHref(meetingUrl) : null), [meetingUrl]);

  // Brief micro-victory pulse when a lesson flips to "completed"
  const [justCompleted, setJustCompleted] = useState(false);
  const prevStatusRef = useRef(lesson.status);
  useEffect(() => {
    if (prevStatusRef.current !== "completed" && lesson.status === "completed") {
      setJustCompleted(true);
      const id = window.setTimeout(() => setJustCompleted(false), 600);
      prevStatusRef.current = lesson.status;
      return () => window.clearTimeout(id);
    }
    prevStatusRef.current = lesson.status;
  }, [lesson.status]);

  // Single structural left border only. Payment/source state is shown in explicit labels,
  // not as an unexplained orange vertical stripe.
  const borderLeft = isCancelled
    ? "border-l-muted-foreground/40"
    : isNow
    ? "border-l-success"
    : "border-l-border";

  const compact = variant === "compact";

  return (
    <div className={cn("space-y-0", className)}>
      <div
        className={cn(
          "relative flex flex-col gap-3 rounded-xl border border-l-4 bg-card transition-transform duration-300",
          justCompleted && "scale-[1.02] animate-pulse",
          borderLeft,
          isNow && "bg-success/5 border-success/40 border-l-success",
          isPast && !isNow && "opacity-80",
          compact ? "p-2.5 sm:p-3" : "p-3 sm:p-4",
          lesson.status && (compact ? "pt-7 sm:pt-7" : "pt-8 sm:pt-8"),
          "sm:flex-row sm:items-stretch",
        )}
      >
        {/* TOP-RIGHT compact icon actions */}
        {topRightActions && (
          <div className="absolute right-2 top-2 flex items-center gap-0.5 sm:right-3 sm:top-3">
            {topRightActions}
          </div>
        )}

        {lesson.status && (
          <div className={cn("absolute left-3 top-2 rounded-full px-2 py-0.5 text-xs font-semibold", STATUS_CLASS[lesson.status])}>
            {t(STATUS_KEY[lesson.status])}
          </div>
        )}

        {/* LEFT: time block */}
        <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-start sm:justify-center sm:pr-4">
          <div className="min-w-[112px]">
            <div className="font-display text-xl font-bold leading-tight tracking-tight text-foreground sm:text-2xl">
              {fmtDateTime(lesson.starts_at)}
            </div>
            <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
              {lesson.duration_minutes} {t("lessonCard.min")}
            </div>
          </div>
        </div>

        {/* Vertical divider (sm+) */}
        <div className="hidden sm:block w-px self-stretch bg-border" />

        {/* CENTER: content */}
        <button
          type="button"
          onClick={onContentClick}
          disabled={!onContentClick}
          className={cn(
            "min-w-0 flex-1 text-left sm:px-4",
            topRightActions ? "pr-16" : "",
            onContentClick ? "cursor-pointer" : "cursor-default",
          )}
        >
          <div className="flex items-center gap-1.5 truncate text-base font-semibold text-foreground">
            {isGroup && <Users2 className="h-4 w-4 shrink-0 text-muted-foreground" />}
            <span className="truncate">{titleLabel}</span>
          </div>
          <div className="mt-0.5 truncate text-sm text-muted-foreground">
            {lesson.subject}
          </div>
          {showTutor && tutorName && (
            <div className="mt-0.5 truncate text-sm text-muted-foreground">
              {t("lessonCard.tutor")}<span className="text-foreground">{tutorName}</span>
            </div>
          )}
          {isNow && (
            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
              {t("lessonCard.now")}
            </div>
          )}
        </button>

        {/* RIGHT: actions row */}
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border pt-3 sm:border-0 sm:pt-0">
          {href && (
            <Button asChild size="sm" className="min-h-[44px] min-w-[44px] gap-1.5">
              <a href={href} target="_blank" rel="noopener noreferrer" aria-label="Zoom">
                <Video className="h-4 w-4" />
                <span className="font-semibold">Zoom</span>
              </a>
            </Button>
          )}

          {/* Payment badge removed — duplicates the hourglass row in the footer/expanded section. */}

          {extraActions}

          {chatPartnerId && (
            <Button
              asChild
              size="icon"
              className="h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
              aria-label={t("lessonCard.chatAriaLabel")}
              title={t("lessonCard.chatAriaLabel")}
            >
              <Link to={`/chats?with=${chatPartnerId}`}>
                <MessageCircle className="h-5 w-5" />
              </Link>
            </Button>
          )}
        </div>
      </div>

      {footer}
    </div>
  );
}

export default LessonCard;
