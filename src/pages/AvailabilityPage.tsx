import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { CalendarClock, Info, X } from "lucide-react";
import { AvailabilityManager } from "@/components/AvailabilityManager";
import { useTranslation } from "react-i18next";

/**
 * Сторінка залишена для зворотньої сумісності зі старими посиланнями.
 * Основний доступ до годин — у Розкладі (вкладка "Мої години").
 */
export default function AvailabilityPage() {
  const { t } = useTranslation();
  const [infoOpen, setInfoOpen] = useState(false);
  return (
    <AppLayout>
      <div className="mb-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="hidden lg:flex font-display text-2xl font-bold text-foreground items-center gap-2">
            <CalendarClock className="h-6 w-6 text-primary" />
            {t("availability.title")}
          </h1>
          <button
            onClick={() => setInfoOpen(v => !v)}
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors flex-shrink-0"
            style={{
              color: infoOpen ? "var(--teal,#2BBFAA)" : "var(--muted,#b0b4c8)",
              border: "1px solid var(--border,#eceef3)",
            }}
            title={t("availability.subtitle")}
          >
            {infoOpen ? <X className="h-4 w-4" /> : <Info className="h-4 w-4" />}
          </button>
        </div>
        {infoOpen && (
          <div className="mt-3 rounded-[14px] px-4 py-3 text-[14px] leading-relaxed"
            style={{ background: "rgba(43,191,170,.07)", color: "var(--sub,#9398b0)",
                     border: "1px solid rgba(43,191,170,.2)" }}>
            {t("availability.subtitle")}
          </div>
        )}
      </div>
      <AvailabilityManager />
    </AppLayout>
  );
}
