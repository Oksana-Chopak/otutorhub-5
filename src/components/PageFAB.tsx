import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageFABProps {
  onClick: () => void;
  label?: string;
  className?: string;
}

/**
 * Unified FAB (+) button — always fixed bottom-right.
 * Replaces all "Створити урок", "Додати людину" etc. header buttons.
 */
export function PageFAB({ onClick, label = "Додати", className }: PageFABProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "fixed bottom-[78px] right-4 z-50 flex h-[52px] w-[52px] items-center justify-center rounded-full text-white shadow-lg transition-all duration-200 hover:scale-105 active:scale-95",
        className
      )}
      style={{ background: "var(--teal,#2BBFAA)", boxShadow: "0 4px 16px rgba(43,191,170,0.4)" }}
    >
      <Plus className="h-6 w-6" />
    </button>
  );
}
