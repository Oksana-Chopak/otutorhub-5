import { ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, ChevronDown, Check, Pencil, Copy, Trash2, MoreVertical, Video, Users2, Wallet, Sparkles } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { safeHref } from "@/lib/safeUrl";
import { formatPrice } from "@/lib/currency";
import { useTranslation } from "react-i18next";

export type LessonCardVariant = "dashboard" | "schedule" | "compact";
export type LessonStatus = "pending" | "scheduled" | "completed" | "cancelled";

export interface LessonCardData {
  id: string;
  subject: string;
  starts_at: string;
  duration_minutes: number;
  meeting_url?: string | null;
  student_price?: number | string | null;
  student_payment_status?: "paid" | "unpaid";
  tutor_payout?: number | string | null;
  tutor_payout_status?: "paid" | "unpaid";
  status?: LessonStatus;
  currency?: string | null;
  lesson_type?: "individual" | "pair" | "group" | null;
  group_id?: string | null;
}

interface LessonCardProps {
  lesson: LessonCardData;
  /** Adds the 💼 tutor-payout row + "Tutor: …" line. */
  role?: "tutor" | "manager" | "student";
  variant?: LessonCardVariant;
  studentName?: string;
  tutorName?: string;
  groupName?: string;
  groupSize?: number;
  showTutor?: boolean;
  /** Force the tutor-payout row (manager / hub lessons). */
  showPayout?: boolean;
  chatPartnerId?: string | null;
  unreadCount?: number;
  meetingUrl?: string | null;
  // Status
  canEditStatus?: boolean;
  statusOptions?: LessonStatus[];
  onStatusChange?: (status: LessonStatus) => void;
  // Payments
  onPayChange?: (field: "student" | "tutor", paid: boolean) => void;
  /** Legacy single-toggle (student). */
  onTogglePayment?: () => void;
  // Overflow / tap
  onEdit?: () => void;
  onContentClick?: () => void;
  canEdit?: boolean;
  canCopy?: boolean;
  canDelete?: boolean;
  onCopy?: () => void;
  onDelete?: () => void;
  onWallet?: () => void;
  onAiNotes?: () => void;
  /** Pure-student self-service actions (cancel / reschedule request). */
  studentActions?: ReactNode;
  className?: string;
}

const STATUS_META: Record<LessonStatus, { key: string; accent: string; bg: string; fg: string; ring: string; dot: string }> = {
  pending:   { key: "lessonCard.statusPending",   accent: "#f59e0b", bg: "rgba(245,158,11,.16)",  fg: "#b4740b", ring: "rgba(245,158,11,.32)",  dot: "#f59e0b" },
  scheduled: { key: "lessonCard.statusScheduled", accent: "#2BBFAA", bg: "rgba(43,191,170,.14)",  fg: "#1f8e7e", ring: "rgba(43,191,170,.3)",   dot: "#2BBFAA" },
  completed: { key: "lessonCard.statusCompleted", accent: "#4ade80", bg: "rgba(34,197,94,.16)",   fg: "#16a34a", ring: "rgba(34,197,94,.32)",   dot: "#22c55e" },
  cancelled: { key: "lessonCard.statusCancelled", accent: "#9aa0b4", bg: "rgba(147,152,176,.18)", fg: "#7b8198", ring: "rgba(147,152,176,.32)", dot: "#9aa0b4" },
};

const L = {
  txt: "#0f0f1a", sub: "#9398b0", muted: "#b0b4c8", border: "#eceef3", bg: "#F5F4F0",
  surface: "#FFFFFF", surface2: "#f6f5f1", teal: "#2BBFAA", tealD: "#1f8e7e",
  tealTint: "#f0fdf9", tealRing: "rgba(43,191,170,.28)", successD: "#16a34a", warningD: "#B4740B",
  coral: "#e0552f", gradIncome: "linear-gradient(160deg,#23232f 0%,#0f0f1a 100%)",
  display: "Inter, system-ui, sans-serif", body: "'Plus Jakarta Sans', system-ui, sans-serif",
};

const AV_GRADS = [
  "linear-gradient(135deg,#2BBFAA,#25a896)", "linear-gradient(135deg,#5b6bf5,#4f46e5)",
  "linear-gradient(135deg,#FF7A59,#f43f5e)", "linear-gradient(135deg,#f59e0b,#d97706)",
  "linear-gradient(135deg,#8b5cf6,#7c3aed)",
];
const avGrad = (n: string) => {
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return AV_GRADS[h % AV_GRADS.length];
};
const initials = (n: string) => n.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";

export function LessonCard({
  lesson,
  role = "tutor",
  studentName,
  tutorName,
  groupName,
  groupSize,
  showTutor = false,
  showPayout = false,
  chatPartnerId,
  unreadCount = 0,
  meetingUrl,
  canEditStatus = false,
  statusOptions,
  onStatusChange,
  onPayChange,
  onTogglePayment,
  onEdit,
  onContentClick,
  canEdit = true,
  canCopy = false,
  canDelete = false,
  onCopy,
  onDelete,
  onWallet,
  onAiNotes,
  studentActions,
  className,
}: LessonCardProps) {
  const { t, i18n } = useTranslation();

  const status: LessonStatus = lesson.status ?? "scheduled";
  const sm = STATUS_META[status];
  const isCancelled = status === "cancelled";
  const isGroup = lesson.lesson_type === "pair" || lesson.lesson_type === "group";
  const manager = role === "manager";
  const withPayout = manager || showPayout;

  const title = isGroup
    ? groupName ?? (groupSize ? t("lessonCard.groupStudents", { count: groupSize }) : t("lessonCard.group"))
    : studentName ?? "—";

  const locale = i18n.language === "sv" ? "sv-SE" : i18n.language === "en" ? "en-GB" : "uk-UA";
  const d = new Date(lesson.starts_at);
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const isToday = d.toDateString() === today.toDateString();
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const relLabel = isToday ? t("lessonCard.todayShort", "Сьогодні") : isTomorrow ? t("lessonCard.tomorrowShort", "Завтра") : null;
  const dow = d.toLocaleDateString(locale, { weekday: "short" }).replace(".", "");
  const dateLabel = d.toLocaleDateString(locale, { day: "numeric", month: "short" }).replace(".", "");

  const href = meetingUrl ?? lesson.meeting_url ? safeHref(meetingUrl ?? lesson.meeting_url ?? "") : null;
  const statusEditable = canEditStatus && !!onStatusChange;
  const opts = statusOptions ?? ["scheduled", "completed", "cancelled"];

  const sPaid = lesson.student_payment_status === "paid";
  const tPaid = lesson.tutor_payout_status === "paid";
  const canTogglePay = !!onPayChange || !!onTogglePayment;

  const tap = onContentClick ?? onEdit;
  const overflowItems = [
    onAiNotes ? { ic: Sparkles, t: t("lessonCard.aiNotes", "AI-конспект"), fn: onAiNotes } : null,
    onEdit && canEdit ? { ic: Pencil, t: t("lessonCard.edit", "Редагувати"), fn: onEdit } : null,
    onCopy && canCopy ? { ic: Copy, t: t("lessonCard.copy", "Копіювати"), fn: onCopy } : null,
    onWallet ? { ic: Wallet, t: t("lessonCard.topUp", "Поповнити гаманець"), fn: onWallet } : null,
    onDelete && canDelete ? { ic: Trash2, t: t("lessonCard.delete", "Видалити"), fn: onDelete, danger: true } : null,
  ].filter(Boolean) as { ic: typeof Pencil; t: string; fn: () => void; danger?: boolean }[];

  // micro-pulse when flipping to completed
  const [pulse, setPulse] = useState(false);
  const prev = useRef(status);
  useEffect(() => {
    if (prev.current !== "completed" && status === "completed") {
      setPulse(true);
      const id = window.setTimeout(() => setPulse(false), 600);
      prev.current = status;
      return () => window.clearTimeout(id);
    }
    prev.current = status;
  }, [status]);

  const stop = (fn?: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn?.(); };

  const PayRow = ({ icon, amount, paid, paidLabel, pendLabel, onToggle }: {
    icon: string; amount: number | string | null | undefined; paid: boolean; paidLabel: string; pendLabel: string; onToggle?: () => void;
  }) => {
    const inner = (
      <>
        <span style={{ fontSize: 17, width: 20, textAlign: "center", flexShrink: 0 }}>{icon}</span>
        <span style={{ fontFamily: L.display, fontWeight: 800, fontSize: 15, minWidth: 48, color: L.txt }}>{formatPrice(amount, lesson.currency)}</span>
        <span style={{ flex: 1, minWidth: 0, textAlign: "right", fontFamily: L.display, fontWeight: 700, fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: paid ? L.successD : L.warningD }}>
          {paid ? `✓ ${paidLabel}` : pendLabel}
        </span>
      </>
    );
    const baseStyle: React.CSSProperties = {
      display: "flex", alignItems: "center", gap: 11, width: "100%", height: 46, padding: "0 13px",
      borderRadius: 12, textAlign: "left",
      border: `1px solid ${paid ? "rgba(34,197,94,.32)" : L.border}`,
      background: paid ? "rgba(34,197,94,.08)" : L.surface2,
    };
    return onToggle ? (
      <button onClick={stop(onToggle)} style={{ ...baseStyle, cursor: "pointer" }}>{inner}</button>
    ) : (
      <div style={baseStyle}>{inner}</div>
    );
  };

  return (
    <div
      onClick={tap ? () => tap() : undefined}
      className={cn(pulse && "animate-pulse", className)}
      style={{
        position: "relative", display: "flex", background: L.surface, border: `1px solid ${L.border}`,
        borderRadius: 20, boxShadow: "0 2px 10px -4px rgba(15,15,26,.12)", overflow: "hidden",
        cursor: tap ? "pointer" : "default", opacity: isCancelled ? 0.72 : 1, fontFamily: L.body, color: L.txt,
      }}
    >
      {/* Dark rail */}
      <div style={{ position: "relative", width: 88, flexShrink: 0, background: L.gradIncome, color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "16px 6px", textAlign: "center", overflow: "hidden" }}>
        <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: sm.accent }} />
        <div style={{ fontFamily: L.display, fontWeight: 700, fontSize: 13, letterSpacing: ".08em", textTransform: "uppercase", color: "rgba(255,255,255,.6)" }}>
          {relLabel ?? dow}
        </div>
        {!relLabel && <div style={{ fontFamily: L.display, fontWeight: 800, fontSize: 13.5, color: "#fff", marginBottom: 4 }}>{dateLabel}</div>}
        <div style={{ fontFamily: L.display, fontWeight: 800, fontSize: 25, letterSpacing: "-.02em", lineHeight: 1, color: sm.accent, marginTop: relLabel ? 6 : 0 }}>{time}</div>
        <div style={{ fontFamily: L.display, fontWeight: 600, fontSize: 13, color: "rgba(255,255,255,.55)", marginTop: 3 }}>{lesson.duration_minutes} {t("lessonCard.min")}</div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "12px 13px", display: "flex", flexDirection: "column", gap: 11 }}>
          {/* status + overflow */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            {statusEditable ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <button style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 11px", border: "none", cursor: "pointer", borderRadius: 999, fontFamily: L.display, fontWeight: 700, fontSize: 13, background: sm.bg, color: sm.fg, boxShadow: `inset 0 0 0 1px ${sm.ring}` }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: "currentColor" }} />
                    {t(sm.key)}
                    <ChevronDown size={14} strokeWidth={2.2} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
                  {opts.map((o) => (
                    <DropdownMenuItem key={o} onClick={stop(() => onStatusChange?.(o))} style={{ fontWeight: o === status ? 800 : 600 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 999, background: STATUS_META[o].dot, marginRight: 8 }} />
                      {t(STATUS_META[o].key)}
                      {o === status && <Check size={14} strokeWidth={2.6} style={{ marginLeft: "auto", color: L.tealD }} />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 11px", borderRadius: 999, fontFamily: L.display, fontWeight: 700, fontSize: 13, background: sm.bg, color: sm.fg, boxShadow: `inset 0 0 0 1px ${sm.ring}` }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: "currentColor" }} />
                {t(sm.key)}
              </span>
            )}

            {overflowItems.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <button aria-label={t("lessonCard.actions", "Дії")} style={{ width: 34, height: 34, borderRadius: 999, border: "none", cursor: "pointer", background: "transparent", color: L.muted, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <MoreVertical size={20} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  {overflowItems.map((it) => {
                    const Ic = it.ic;
                    return (
                      <DropdownMenuItem key={it.t} onClick={stop(it.fn)} style={{ color: it.danger ? L.coral : L.txt }}>
                        <Ic size={16} style={{ marginRight: 10 }} /> {it.t}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* identity + chat */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 46, height: 46, borderRadius: 999, flexShrink: 0, background: isGroup ? "rgba(43,191,170,.12)" : avGrad(title), color: isGroup ? L.tealD : "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: L.display, fontWeight: 800, fontSize: 16 }}>
              {isGroup ? <Users2 size={22} /> : initials(title)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: L.display, fontWeight: 700, fontSize: 17, lineHeight: 1.18, color: L.txt, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
              <div style={{ fontSize: 14, color: L.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{lesson.subject}</div>
              {showTutor && tutorName && (
                <div style={{ fontSize: 13, color: L.sub, marginTop: 1 }}>{t("lessonCard.tutor")}<b style={{ color: L.txt, fontWeight: 600 }}>{tutorName}</b></div>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {href && (
                <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} aria-label="Zoom"
                  style={{ width: 44, height: 44, borderRadius: 14, background: L.teal, color: "#0f0f1a", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 14px -6px rgba(43,191,170,.7)" }}>
                  <Video size={21} />
                </a>
              )}
              {chatPartnerId && (
                <Link to={`/chats?with=${chatPartnerId}`} onClick={(e) => e.stopPropagation()} aria-label={t("lessonCard.chatAriaLabel")}
                  style={{ position: "relative", width: 44, height: 44, borderRadius: 14, background: L.tealTint, color: L.tealD, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `inset 0 0 0 1px ${L.tealRing}` }}>
                  <MessageCircle size={22} />
                  {unreadCount > 0 && (
                    <span style={{ position: "absolute", top: -6, right: -6, minWidth: 19, height: 19, padding: "0 5px", borderRadius: 999, background: L.coral, color: "#fff", fontFamily: L.display, fontWeight: 800, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 2px #fff" }}>{unreadCount}</span>
                  )}
                </Link>
              )}
            </div>
          </div>

          {studentActions && <div onClick={(e) => e.stopPropagation()}>{studentActions}</div>}
        </div>

        {/* Payment rows */}
        {(lesson.student_price != null || withPayout) && (
          <div style={{ borderTop: `1px solid ${L.border}`, padding: "11px 13px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
            <PayRow icon="🎓" amount={lesson.student_price} paid={sPaid} paidLabel={t("lessonCard.paid", "Оплачено")} pendLabel={t("lessonCard.pending", "Очікує")}
              onToggle={canTogglePay ? () => (onPayChange ? onPayChange("student", !sPaid) : onTogglePayment?.()) : undefined} />
            {withPayout && (
              <PayRow icon="💼" amount={lesson.tutor_payout ?? lesson.student_price} paid={tPaid} paidLabel={t("lessonCard.paidOut", "Виплачено")} pendLabel={t("lessonCard.toPayout", "До виплати")}
                onToggle={onPayChange ? () => onPayChange("tutor", !tPaid) : undefined} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default LessonCard;
