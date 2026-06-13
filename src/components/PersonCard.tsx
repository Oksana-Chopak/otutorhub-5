/**
 * PersonCard — уніфікована картка списку людей.
 * Дизайн: design_handoff_people/README.md §6, people.cards.jsx
 *
 * Логіку даних НЕ містить — лише відображення.
 * Аватар з градієнтом + статус-крапка + ім'я + підрядок + бейджі + email+Copy + «Написати».
 */
import { useState } from "react";
import { MessageCircle, Copy, Check, Mail } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Design tokens ────────────────────────────────────────────────────────────
const T = {
  teal:    "#2BBFAA",
  tealD:   "#25a896",
  border:  "#eceef3",
  bg:      "#F5F4F0",
  txt:     "#0f0f1a",
  sub:     "#9398b0",
  muted:   "#b0b4c8",
  display: "Inter, system-ui, sans-serif",
  body:    "'Plus Jakarta Sans', system-ui, sans-serif",
};

const STATUS_DOT: Record<string, string> = {
  ok:       "#22c55e",
  debt:     "#f59e0b",
  inactive: "#9aa0b4",
  new:      "#b0b4c8",
  pending:  "#EF9F27",
};

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg,#2BBFAA,#1d8f7e)",
  "linear-gradient(135deg,#6366F1,#4f46e5)",
  "linear-gradient(135deg,#F59E0B,#d97706)",
  "linear-gradient(135deg,#EF4444,#dc2626)",
  "linear-gradient(135deg,#EC4899,#db2777)",
  "linear-gradient(135deg,#8B5CF6,#7c3aed)",
  "linear-gradient(135deg,#F97316,#ea580c)",
  "linear-gradient(135deg,#14B8A6,#0d9488)",
];

export function avatarGradient(name: string): string {
  const code = (name || "?").charCodeAt(0) + ((name || "?").charCodeAt(1) || 0);
  return AVATAR_GRADIENTS[code % AVATAR_GRADIENTS.length];
}

export function computeInitials(name: string): string {
  const parts = (name || "?").trim().split(" ");
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

// ── Avatar with status dot ────────────────────────────────────────────────────
export function PersonAva({
  name,
  avatarUrl,
  status = "ok",
  size = 52,
}: {
  name: string;
  avatarUrl?: string | null;
  status?: string;
  size?: number;
}) {
  const dotSize  = Math.round(size * 0.27);
  const dotColor = STATUS_DOT[status] ?? STATUS_DOT.new;

  return (
    <div style={{ position: "relative", flexShrink: 0, width: size, height: size }}>
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={name}
          style={{ width: size, height: size, borderRadius: 999, objectFit: "cover" }}
        />
      ) : (
        <div style={{
          width: size, height: size, borderRadius: 999,
          background: avatarGradient(name),
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: T.display, fontWeight: 700, color: "#fff",
          fontSize: Math.round(size * 0.35),
        }}>
          {computeInitials(name)}
        </div>
      )}
      <span style={{
        position: "absolute", right: -1, bottom: -1,
        width: dotSize, height: dotSize, borderRadius: 999,
        background: dotColor, boxShadow: "0 0 0 3px #fff",
      }} />
    </div>
  );
}

// ── Inline email/copy row ─────────────────────────────────────────────────────
export function ContactInline({ value }: { value: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;

  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 7 }}>
      <Mail size={17} style={{ color: T.muted, flexShrink: 0 }} />
      <span style={{
        flex: 1, fontSize: 15, color: T.sub, minWidth: 0,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        fontFamily: T.body,
      }}>
        {value}
      </span>
      <button
        onClick={copy}
        title="Копіювати"
        aria-label="Копіювати"
        style={{
          width: 44, height: 44, borderRadius: 11, flexShrink: 0,
          border: "none", background: "transparent",
          cursor: "pointer", display: "flex", alignItems: "center",
          justifyContent: "center",
          color: copied ? "#16a34a" : T.tealD,
        }}
      >
        {copied
          ? <Check size={19} strokeWidth={2.4} />
          : <Copy size={19} strokeWidth={2} />
        }
      </button>
    </div>
  );
}

// ── Status / meta badges ──────────────────────────────────────────────────────
export function PersonBadges({
  status,
  isPending,
  inactiveDays,
  unpaidTotal,
  obDone,
  kind,
  isOwner,
}: {
  status: string;
  isPending?: boolean;
  inactiveDays?: number;
  unpaidTotal?: number;
  obDone?: number;
  kind?: "student" | "tutor" | "manager";
  isOwner?: boolean;
}) {
  const pills: React.ReactNode[] = [];

  const Pill = ({ tone, children }: { tone: string; children: React.ReactNode }) => {
    const colors: Record<string, { bg: string; color: string; border: string }> = {
      warn:  { bg: "rgba(245,158,11,.12)", color: "#b45309", border: "rgba(245,158,11,.3)" },
      muted: { bg: "rgba(148,155,185,.12)", color: T.sub,    border: "rgba(148,155,185,.3)" },
      teal:  { bg: "rgba(43,191,170,.12)", color: T.tealD,   border: "rgba(43,191,170,.3)" },
      blue:  { bg: "rgba(99,102,241,.12)", color: "#4f46e5", border: "rgba(99,102,241,.3)" },
    };
    const c = colors[tone] ?? colors.muted;
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", height: 22, padding: "0 8px",
        borderRadius: 999, fontSize: 13, fontFamily: T.display, fontWeight: 700,
        background: c.bg, color: c.color, border: `1px solid ${c.border}`,
      }}>
        {children}
      </span>
    );
  };

  if (isPending)              pills.push(<Pill key="p" tone="warn">⏳ Очікує входу</Pill>);
  else if (status === "debt") pills.push(<Pill key="d" tone="warn">⚠️ Борг ₴{unpaidTotal}</Pill>);
  else if (status === "inactive" && inactiveDays) pills.push(<Pill key="i" tone="muted">💤 {inactiveDays} дн. тиша</Pill>);
  else if (status === "new")  pills.push(<Pill key="n" tone="muted">✨ Новий</Pill>);

  if (kind === "tutor" && obDone !== undefined && obDone < 3 && !isPending)
    pills.push(<Pill key="o" tone="blue">Онбординг {obDone}/3</Pill>);
  if (kind === "manager" && isOwner)
    pills.push(<Pill key="ow" tone="teal">Власник</Pill>);

  return pills.length ? (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
      {pills}
    </div>
  ) : null;
}

// ── Main card ─────────────────────────────────────────────────────────────────
interface PersonCardProps {
  id: string;
  name: string;
  avatarUrl?: string | null;
  status: string;
  subLine: string;          // "Англійська · ₴500/урок" / "Математика · Фізика" / "Менеджер"
  email?: string | null;
  isPending?: boolean;
  inactiveDays?: number;
  unpaidTotal?: number;
  obDone?: number;          // onboarding steps done (tutor in manager view)
  kind?: "student" | "tutor" | "manager";
  isOwner?: boolean;
  active?: boolean;         // selected on desktop
  onOpen: () => void;
  onWrite: () => void;
}

export function PersonCard({
  name, avatarUrl, status, subLine, email, isPending, inactiveDays,
  unpaidTotal, obDone, kind, isOwner, active, onOpen, onWrite,
}: PersonCardProps) {
  const [hover, setHover] = useState(false);
  const canWrite = !isPending;

  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", gap: 13, cursor: "pointer",
        borderRadius: 18, padding: "13px 14px",
        background: active ? "rgba(43,191,170,0.07)" : "#fff",
        border: active ? "1.5px solid rgba(43,191,170,0.4)" : `1px solid ${T.border}`,
        boxShadow: hover && !active
          ? "0 4px 14px -4px rgba(15,15,26,0.12)"
          : "0 1px 3px rgba(15,15,26,0.06)",
        transition: "box-shadow .15s, border-color .15s",
      }}
    >
      <PersonAva name={name} avatarUrl={avatarUrl} status={status} size={54} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          display: "block", fontFamily: T.display, fontWeight: 700,
          fontSize: 17, color: T.txt,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {name}
        </span>
        <span style={{ fontSize: 14, color: T.sub, fontFamily: T.body }}>
          {subLine}
        </span>
        <PersonBadges
          status={status} isPending={isPending} inactiveDays={inactiveDays}
          unpaidTotal={unpaidTotal} obDone={obDone} kind={kind} isOwner={isOwner}
        />
        <ContactInline value={email} />
      </div>

      {/* Single action — Написати */}
      <div style={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onWrite}
          disabled={!canWrite}
          title="Написати"
          aria-label="Написати"
          style={{
            width: 46, height: 46, borderRadius: 14, border: "none",
            cursor: canWrite ? "pointer" : "default", flexShrink: 0,
            background: canWrite
              ? `linear-gradient(135deg,${T.teal},${T.tealD})`
              : "rgba(15,15,26,0.06)",
            color: canWrite ? "#fff" : T.muted,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: canWrite ? "0 6px 14px -6px rgba(43,191,170,0.6)" : "none",
          }}
        >
          <MessageCircle size={21} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
