/**
 * DashboardLessonCard — new unified lesson card for the dashboard.
 * Design: design_handoff_dashboard/README.md §6-9
 *
 * Rules:
 * - Does NOT modify src/components/LessonCard.tsx
 * - Calls Supabase directly for status / payment toggles
 * - Role-aware: showTutor + showPayout for manager/hub
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, MessageSquare, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

// ── types (mirror DashboardPage) ────────────────────────────────────────────
type LessonStatus = "pending" | "scheduled" | "completed" | "cancelled";
type PayStatus    = "paid" | "unpaid";

export interface DashLesson {
  id: string;
  tutor_id: string;
  student_id: string;
  subject: string;
  starts_at: string;
  duration_minutes: number;
  status: LessonStatus;
  student_price: number;
  tutor_payout: number;
  student_payment_status: PayStatus;
  tutor_payout_status: PayStatus;
}

interface Props {
  lesson: DashLesson;
  studentName: string;
  tutorName?: string;   // manager only
  showTutor?: boolean;
  showPayout?: boolean; // manager / hub
  full?: boolean;       // desktop chrome (edit/copy/delete)
  onStatusChange?: (id: string, s: LessonStatus) => void;
  onPayChange?: (id: string, field: "student_payment_status" | "tutor_payout_status", v: PayStatus) => void;
}

const STATUSES: { key: LessonStatus; label: string; tone: string; dot: string }[] = [
  { key: "scheduled",  label: "Заплановано", tone: "teal",    dot: "#2BBFAA" },
  { key: "completed",  label: "Проведено",   tone: "success", dot: "#22C55E" },
  { key: "cancelled",  label: "Скасовано",   tone: "muted",   dot: "#b0b4c8" },
];

// Avatar: initials from name
function Av({ name, size = 36 }: { name: string; size?: number }) {
  const parts = (name || "??").split(" ");
  const init  = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "");
  // deterministic colour from name
  const colours = ["#2BBFAA","#5b6bf5","#FF7A59","#F59E0B","#8B5CF6","#EC4899"];
  const idx = (name.charCodeAt(0) + (name.charCodeAt(1) ?? 0)) % colours.length;
  return (
    <div style={{ width: size, height: size, borderRadius: 999, background: colours[idx],
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "Inter, system-ui", fontWeight: 700, fontSize: size * 0.36, color: "#fff",
      flexShrink: 0, textTransform: "uppercase" as const }}>
      {init.toUpperCase()}
    </div>
  );
}

// Inline status select
function StatusSelect({ value, onChange }: { value: LessonStatus; onChange: (s: LessonStatus) => void }) {
  const [open, setOpen] = useState(false);
  const cur = STATUSES.find(s => s.key === value) ?? STATUSES[0];
  return (
    <div style={{ position: "relative" }}>
      <button onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[10px] border border-border bg-white text-[13px] font-bold transition-colors hover:bg-muted/30 cursor-pointer"
        style={{ fontFamily: "Inter, system-ui", color: cur.tone === "teal" ? "#25a896" : cur.tone === "success" ? "#16a34a" : "#9398b0" }}>
        <span className="w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ background: cur.dot }} />
        {cur.label}
        <ChevronDown className="h-3 w-3 ml-0.5 opacity-50" />
      </button>
      {open && (
        <>
          <div onClick={e => { e.stopPropagation(); setOpen(false); }} className="fixed inset-0 z-40" />
          <div className="absolute top-10 right-0 z-50 bg-white rounded-xl border border-border shadow-lg p-1 min-w-[152px]">
            {STATUSES.map(s => (
              <button key={s.key} onClick={e => { e.stopPropagation(); onChange(s.key); setOpen(false); }}
                className="flex items-center gap-2 w-full h-9 px-3 rounded-lg text-left text-[13.5px] transition-colors hover:bg-muted/30"
                style={{ fontFamily: "Inter, system-ui", fontWeight: s.key === value ? 700 : 500,
                  background: s.key === value ? "var(--ds-bg,#F5F4F0)" : "transparent" }}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.dot }} />
                {s.label}
                {s.key === value && <Check className="ml-auto h-3.5 w-3.5 text-teal-600" strokeWidth={2.6} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// One payment row
function PayRow({ emoji, amount, paid, paidLabel, unpaidLabel, onToggle }: {
  emoji: string; amount: number; paid: boolean;
  paidLabel: string; unpaidLabel: string; onToggle: () => void;
}) {
  return (
    <button onClick={e => { e.stopPropagation(); onToggle(); }}
      className="flex items-center gap-2 w-full h-[42px] px-3 rounded-[11px] text-left transition-all cursor-pointer"
      style={{ border: `1px solid ${paid ? "rgba(34,197,94,.32)" : "var(--border,#eceef3)"}`,
               background: paid ? "rgba(34,197,94,.08)" : "#fbfbfc" }}>
      <span className="text-[15px] w-[18px] text-center flex-shrink-0">{emoji}</span>
      <span className="font-bold text-[13.5px] min-w-[52px]" style={{ fontFamily: "Inter, system-ui", color: "var(--txt,#0f0f1a)" }}>
        ₴{amount}
      </span>
      <span className="flex-1 flex items-center gap-1.5 text-[13.5px] font-semibold"
        style={{ color: paid ? "#16a34a" : "#B4740B" }}>
        {paid ? <><span className="font-extrabold">✓</span> {paidLabel}</> : <>⏳ {unpaidLabel}</>}
      </span>
      <ChevronDown className="h-3.5 w-3.5 rotate-[-90deg] flex-shrink-0 text-muted-foreground/50" />
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function DashboardLessonCard({
  lesson, studentName, tutorName, showTutor, showPayout, full, onStatusChange, onPayChange,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<LessonStatus>(lesson.status ?? "scheduled");
  const [sPaid,  setSPaid]  = useState(lesson.student_payment_status === "paid");
  const [tPaid,  setTPaid]  = useState(lesson.tutor_payout_status === "paid");
  const [payOpen, setPayOpen] = useState(false);
  const [pulse,   setPulse]   = useState(false);

  const cancelled = status === "cancelled";
  const completed  = status === "completed";
  const accentColor = cancelled ? "#b0b4c8" : completed ? "#22C55E" : "#2BBFAA";

  const time = new Date(lesson.starts_at).toLocaleTimeString("uk-UA", {
    hour: "2-digit", minute: "2-digit", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  const handleStatus = async (s: LessonStatus) => {
    if (s === "completed" && status !== "completed") { setPulse(true); setTimeout(() => setPulse(false), 600); }
    setStatus(s);
    onStatusChange?.(lesson.id, s);
    await supabase.from("lessons").update({ status: s } as any).eq("id", lesson.id);
  };

  const togglePay = async (field: "student_payment_status" | "tutor_payout_status", cur: boolean, set: (v: boolean) => void) => {
    const next = cur ? "unpaid" : "paid";
    set(!cur);
    onPayChange?.(lesson.id, field, next);
    await (supabase.from("lesson_details") as any).upsert(
      { lesson_id: lesson.id, [field]: next }, { onConflict: "lesson_id" }
    );
  };

  const pillBg   = cancelled ? "rgba(176,180,200,.15)" : completed ? "rgba(34,197,94,.15)" : "rgba(43,191,170,.15)";
  const pillFg   = cancelled ? "#9398b0" : completed ? "#16a34a" : "#25a896";

  return (
    <div style={{
      position: "relative", borderRadius: 16, background: "#fff",
      border: `1px solid ${completed ? "rgba(34,197,94,.3)" : "var(--border,#eceef3)"}`,
      borderLeft: `4px solid ${accentColor}`,
      boxShadow: "0 1px 4px rgba(15,15,26,.06)",
      paddingTop: 30,
      transform: pulse ? "scale(1.012)" : "scale(1)",
      transition: "transform .3s, border-color .3s",
      opacity: cancelled ? 0.72 : 1,
    }}>

      {/* Status pill — absolute top-left */}
      <div style={{ position: "absolute", left: 12, top: 9 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 24, padding: "0 9px",
          borderRadius: 999, background: pillBg,
          fontFamily: "Inter, system-ui", fontWeight: 700, fontSize: 12, color: pillFg }}>
          {status === "cancelled" ? "Скасовано" : status === "completed" ? "Проведено" : "Заплановано"}
        </span>
      </div>

      {/* Desktop actions — edit/copy/delete */}
      {full && (
        <div style={{ position: "absolute", right: 8, top: 7, display: "flex", gap: 2 }}>
          {[{icon:"✎",label:"edit"},{icon:"⧉",label:"copy"},{icon:"🗑",label:"delete"}].map(a => (
            <button key={a.label}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[13px] text-muted-foreground/50 hover:bg-muted/40 hover:text-foreground transition-colors">{a.icon}</button>
          ))}
        </div>
      )}

      {/* Main row */}
      <div style={{ display: "flex", alignItems: "center", gap: full ? 13 : 11, flexWrap: "wrap",
        padding: full ? "0 14px 12px" : "0 12px 11px" }}>
        {/* Time block */}
        <div style={{ minWidth: full ? 88 : 56 }}>
          <div style={{ fontFamily: "Inter, system-ui", fontWeight: 800,
            fontSize: full ? 22 : 19, color: "var(--txt,#0f0f1a)", lineHeight: 1.05, letterSpacing: "-0.02em" }}>
            {time}
          </div>
          <div style={{ fontSize: 10.5, textTransform: "uppercase" as const, letterSpacing: "0.05em",
            color: "#b0b4c8", marginTop: 3 }}>
            {full ? "сьогодні · " : ""}{lesson.duration_minutes} хв
          </div>
        </div>

        <div style={{ width: 1, alignSelf: "stretch", background: "var(--border,#eceef3)", margin: "2px 0" }} />

        {/* Identity */}
        <div style={{ flex: 1, minWidth: 110, display: "flex", alignItems: "center", gap: 9 }}>
          <Av name={studentName} size={full ? 40 : 36} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: "Inter, system-ui", fontWeight: 700,
              fontSize: full ? 15.5 : 14.5, color: "var(--txt,#0f0f1a)",
              whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" }}>
              {studentName || "—"}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--sub,#9398b0)", marginTop: 1 }}>{lesson.subject}</div>
            {showTutor && tutorName && (
              <div style={{ fontSize: 12, color: "var(--sub,#9398b0)", marginTop: 1 }}>
                Репетитор: <span style={{ color: "var(--txt,#0f0f1a)" }}>{tutorName}</span>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <StatusSelect value={status} onChange={handleStatus} />
          <button onClick={() => navigate(`/chats?with=${lesson.student_id}`)}
            style={{ width: 40, height: 40, borderRadius: 999, border: "none", cursor: "pointer", flexShrink: 0,
              background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 4px 12px -4px rgba(43,191,170,.6)" }}
            aria-label="Чат">
            <MessageSquare size={17} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Payment footer */}
      <div style={{ borderTop: "1px solid var(--border,#eceef3)", padding: "8px 12px 10px" }}>
        <button onClick={() => setPayOpen(v => !v)}
          style={{ display: "flex", alignItems: "center", gap: 7, width: "100%",
            border: "none", background: "transparent", cursor: "pointer", padding: "2px 0" }}>
          <span style={{ display: "flex", gap: 5, flex: 1, minWidth: 0, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, height: 22, padding: "0 8px",
              borderRadius: 999, fontSize: 11, fontFamily: "Inter, system-ui", fontWeight: 700,
              background: sPaid ? "rgba(34,197,94,.12)" : "rgba(245,158,11,.12)",
              color: sPaid ? "#16a34a" : "#B4740B" }}>
              🎓 {sPaid ? "Оплачено" : "Очікує"}
            </span>
            {showPayout && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, height: 22, padding: "0 8px",
                borderRadius: 999, fontSize: 11, fontFamily: "Inter, system-ui", fontWeight: 700,
                background: tPaid ? "rgba(34,197,94,.12)" : "rgba(245,158,11,.12)",
                color: tPaid ? "#16a34a" : "#B4740B" }}>
                💼 {tPaid ? "Виплачено" : "До виплати"}
              </span>
            )}
          </span>
          <span style={{ fontSize: 12, color: "var(--sub,#9398b0)", fontWeight: 600,
            fontFamily: "Inter, system-ui", whiteSpace: "nowrap" as const }}>
            {payOpen ? "Згорнути" : t("lessonCard.paymentDetails") || "Деталі оплати"}
          </span>
          {payOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground/50" />
                    : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50" />}
        </button>

        {payOpen && (
          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 9 }}>
            <PayRow emoji="🎓" amount={lesson.student_price} paid={sPaid}
              paidLabel={t("lessonCard.studentPaid") || "Оплачено учнем"}
              unpaidLabel={t("lessonCard.studentAwaiting") || "Очікує оплати від учня"}
              onToggle={() => togglePay("student_payment_status", sPaid, setSPaid)} />
            {showPayout && (
              <PayRow emoji="💼" amount={lesson.tutor_payout} paid={tPaid}
                paidLabel={t("lessonCard.tutorPaid") || "Виплачено репетитору"}
                unpaidLabel={t("lessonCard.tutorPayout") || "До виплати репетитору"}
                onToggle={() => togglePay("tutor_payout_status", tPaid, setTPaid)} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
