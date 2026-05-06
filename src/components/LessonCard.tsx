import { ReactNode, useMemo } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, Video } from "lucide-react";
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
}

interface LessonCardProps {
  lesson: LessonCardData;
  variant?: LessonCardVariant;
  studentName?: string;
  tutorName?: string;
  /** Show tutor name (typically for managers). */
  showTutor?: boolean;
  /** Effective meeting URL (already resolved with fallback). */
  meetingUrl?: string | null;
  /** When provided, renders a payment toggle pill instead of a static badge. */
  onTogglePayment?: () => void;
  /** Chat target: pass a participant id to deep-link to /chats. If omitted, chat icon hides. */
  chatPartnerId?: string | null;
  /** Extra action buttons appended on the right (status select, edit, copy, delete, etc.) */
  extraActions?: ReactNode;
  /** Renders below the card body (e.g. collapsible footer with workspace). */
  footer?: ReactNode;
  className?: string;
  /** Optional click handler for the central content area. */
  onContentClick?: () => void;
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });

export function LessonCard({
  lesson,
  variant = "schedule",
  studentName,
  tutorName,
  showTutor = false,
  meetingUrl,
  onTogglePayment,
  chatPartnerId,
  extraActions,
  footer,
  className,
  onContentClick,
}: LessonCardProps) {
  const startMs = new Date(lesson.starts_at).getTime();
  const endMs = startMs + (lesson.duration_minutes ?? 0) * 60_000;
  const nowMs = Date.now();

  const isNow = nowMs >= startMs && nowMs < endMs && lesson.status !== "cancelled";
  const isPast = endMs < nowMs;
  const isUnpaid =
    lesson.student_payment_status === "unpaid" &&
    lesson.status !== "cancelled" &&
    lesson.status !== "pending";

  const href = useMemo(() => (meetingUrl ? safeHref(meetingUrl) : null), [meetingUrl]);
  const isPaid = lesson.student_payment_status === "paid";
  const price = Number(lesson.student_price ?? 0);

  // Left accent strip color
  const accent = isNow
    ? "before:bg-success"
    : isUnpaid
    ? "before:bg-warning"
    : "before:bg-transparent";

  const compact = variant === "compact";

  return (
    <div className={cn("space-y-0", className)}>
      <div
        className={cn(
          "relative flex flex-col gap-3 rounded-xl border bg-card transition-colors",
          "before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-full",
          accent,
          isNow && "border-success/40 bg-success/5",
          !isNow && "border-border hover:border-primary/30",
          isPast && !isNow && "opacity-70",
          compact ? "p-2.5 sm:p-3" : "p-3 sm:p-4",
          "sm:flex-row sm:items-stretch",
        )}
      >
        {/* LEFT: time block */}
        <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-start sm:justify-center sm:pr-4">
          <div className="min-w-[64px]">
            <div className="font-display text-2xl font-bold leading-none tracking-tight text-foreground sm:text-3xl">
              {fmtTime(lesson.starts_at)}
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
            onContentClick ? "cursor-pointer" : "cursor-default",
          )}
        >
          <div className="truncate text-base font-semibold text-foreground">
            {studentName ?? "—"}
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

        {/* RIGHT: actions */}
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border pt-3 sm:border-0 sm:pt-0">
          {href && (
            <Button
              asChild
              size="sm"
              className="min-h-[44px] min-w-[44px] gap-1.5"
            >
              <a href={href} target="_blank" rel="noopener noreferrer" aria-label="Zoom">
                <Video className="h-4 w-4" />
                <span className="font-semibold">Zoom</span>
              </a>
            </Button>
          )}

          {lesson.student_payment_status &&
            lesson.status !== "cancelled" &&
            lesson.status !== "pending" &&
            (onTogglePayment ? (
              <button
                type="button"
                onClick={onTogglePayment}
                className={cn(
                  "inline-flex min-h-[44px] items-center gap-1 rounded-full px-3 text-xs font-semibold transition-colors",
                  isPaid
                    ? "bg-success/15 text-success hover:bg-success/25"
                    : "bg-success text-success-foreground hover:bg-success/90",
                )}
                title={isPaid ? "Натисніть, щоб скасувати оплату" : "Натисніть, щоб позначити як отримано"}
              >
                {isPaid ? "Оплачено ✓" : `✓ Отримав ${price > 0 ? `${price} ₴` : ""}`.trim()}
              </button>
            ) : isPaid ? (
              <span className="inline-flex min-h-[28px] items-center rounded-full bg-success/15 px-2.5 py-1 text-xs font-semibold text-success">
                Оплачено ✓
              </span>
            ) : (
              <span className="inline-flex min-h-[28px] items-center rounded-full bg-warning/15 px-2.5 py-1 text-xs font-semibold text-warning">
                Очікує оплати
              </span>
            ))}

          {extraActions}

          {chatPartnerId && (
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="h-11 w-11 text-muted-foreground hover:text-primary"
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
