/**
 * AddFab — expandable "+" FAB with three quick-add actions.
 * Design: design_handoff_dashboard §6 + detail-add-fab.png
 */
import { useState } from "react";
import { Plus, X, CalendarPlus, GraduationCap, CreditCard } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface Action {
  key: string;
  labelKey: string;
  icon: React.ElementType;
  bg: string;
  fg: string;
}

const ACTIONS: Action[] = [
  { key: "lesson",   labelKey: "quickAdd.lesson",   icon: CalendarPlus,    bg: "#f0fdf9", fg: "#25a896" },
  { key: "student",  labelKey: "quickAdd.student",  icon: GraduationCap,   bg: "#eff6ff", fg: "#3b82f6" },
  { key: "payment",  labelKey: "quickAdd.payment",  icon: CreditCard,      bg: "#fff7ed", fg: "#f59e0b" },
];

interface Props {
  onLesson: () => void;
  onStudent: () => void;
  onPayment?: () => void;
  bottom?: number;
}

export function AddFab({ onLesson, onStudent, onPayment, bottom = 88 }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const handlers: Record<string, () => void> = {
    lesson:  onLesson,
    student: onStudent,
    payment: onPayment ?? (() => {}),
  };

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div className="fixed inset-0 z-30"
          style={{ background: "rgba(15,15,26,.25)", backdropFilter: "blur(2px)" }}
          onClick={() => setOpen(false)} />
      )}

      <div className="fixed right-4 z-40 flex flex-col items-end gap-2.5"
        style={{ bottom }}>
        {/* Action items — appear from bottom */}
        {open && ACTIONS.map((a, i) => (
          <div key={a.key} className="flex items-center gap-2.5"
            style={{ animation: `fabRise .16s ease ${i * 0.04}s both` }}>
            <span className="text-[13.5px] font-bold px-3 py-1.5 rounded-[9px] whitespace-nowrap shadow-sm"
              style={{ background: "#fff", fontFamily: "Inter, system-ui", color: "var(--txt,#0f0f1a)",
                       boxShadow: "0 2px 8px rgba(15,15,26,.1)" }}>
              {t(a.labelKey) || a.key}
            </span>
            <button
              onClick={() => { setOpen(false); handlers[a.key](); }}
              className="w-[46px] h-[46px] rounded-[14px] border-0 cursor-pointer flex items-center justify-center transition-transform active:scale-95"
              style={{ background: a.bg, color: a.fg,
                       boxShadow: "0 2px 8px rgba(15,15,26,.1)" }}
              aria-label={t(a.labelKey)}>
              <a.icon size={21} strokeWidth={2} />
            </button>
          </div>
        ))}

        {/* Main FAB */}
        <button
          onClick={() => setOpen(v => !v)}
          className="w-[58px] h-[58px] rounded-[18px] border-0 cursor-pointer flex items-center justify-center transition-transform active:scale-95"
          style={{
            background: "linear-gradient(135deg,#2BBFAA,#25a896)",
            boxShadow: "0 12px 28px -8px rgba(43,191,170,.65)",
            transform: open ? "rotate(45deg)" : "rotate(0deg)",
            transition: "transform .2s cubic-bezier(.34,1.56,.64,1)",
          }}
          aria-label={open ? "Закрити" : "Додати"}>
          {open ? <X size={28} strokeWidth={2.2} color="#fff" />
                : <Plus size={28} strokeWidth={2.4} color="#fff" />}
        </button>
      </div>

      <style>{`
        @keyframes fabRise {
          from { transform: translateY(12px) scale(.9); opacity: 0; }
          to   { transform: translateY(0)    scale(1);  opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes fabRise { from { opacity: 0; } to { opacity: 1; } }
        }
      `}</style>
    </>
  );
}
