import { ReactNode, useMemo } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, Video, Users2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { safeHref } from "@/lib/safeUrl";

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

const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const isToday = d.toDateString() === today.toDateString();
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const time = d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `Сьогодні · ${time}`;
  if (isTomorrow) return `Завтра · ${time}`;
  return d.toLocaleDateString("uk-UA", { day: "numeric", month: "short" }) + ` · ${time}`;
};

const STATUS_LABEL: Record<NonNullable<LessonCardData["status"]>, string> = {
  pending: "Запит",
  scheduled: "Заплановано",
  completed: "Проведено",
  cancelled: "Скасовано",
};

const STATUS_CLASS: Record<NonNullable<LessonCardData["status"]>, string> = {
  pending: "text-warning",
  scheduled: "text-primary",
  completed: "text-success",
  cancelled: "text-muted-foreground line-through",
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
  const isGroup = lesson.lesson_type === "pair" || lesson.lesson_type === "group";
  const titleLabel = isGroup
    ? groupName ?? (groupSize ? `Група · ${groupSize} учнів` : "Група")
    : studentName ?? "—";
  const startMs = new Date(lesson.starts_at).getTime();
  const endMs = startMs + (lesson.duration_minutes ?? 0) * 60_000;
  const nowMs = Date.now();

  const isNow = nowMs >= startMs && nowMs < endMs && lesson.status !== "cancelled";
  const isPast = endMs < nowMs;
  const isCancelled = lesson.status === "cancelled";
  const isPaid = lesson.student_payment_status === "paid";
  const isUnpaid =
    lesson.student_payment_status === "unpaid" &&
    lesson.status !== "cancelled" &&
    lesson.status !== "pending";

  const href = useMemo(() => (meetingUrl ? safeHref(meetingUrl) : null), [meetingUrl]);

  // Single left accent — implemented via border-left color (no second :before strip).
  const borderLeft = isCancelled
    ? "border-l-muted-foreground/40"
    : isNow
    ? "border-l-success"
    : isPaid
    ? "border-l-success"
    : isUnpaid
    ? "border-l-warning"
    : "border-l-border";

  const compact = variant === "compact";

  return (
    <div className={cn("space-y-0", className)}>
      <div
        className={cn(
          "relative flex flex-col gap-3 rounded-xl border border-l-4 bg-card transition-colors",
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
          <div className={cn("absolute left-3 top-3 text-[11px] font-semibold", STATUS_CLASS[lesson.status])}>
            {STATUS_LABEL[lesson.status]}
          </div>
        )}

        {/* LEFT: time block */}
        <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-start sm:justify-center sm:pr-4">
          <div className="min-w-[112px]">
            <div className="font-display text-xl font-bold leading-tight tracking-tight text-foreground sm:text-2xl">
              {fmtDateTime(lesson.starts_at)}
            </div>
            <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              {lesson.duration_minutes} хв
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
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              Репетитор: <span className="text-foreground">{tutorName}</span>
            </div>
          )}
          {isNow && (
            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
              ● Зараз
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
              aria-label="Чат"
              title="Чат"
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
