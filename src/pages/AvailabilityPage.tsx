import { AppLayout } from "@/components/AppLayout";
import { CalendarClock, Info } from "lucide-react";
import { AvailabilityManager } from "@/components/AvailabilityManager";
import { useTranslation } from "react-i18next";

/**
 * Сторінка залишена для зворотньої сумісності зі старими посиланнями.
 * Основний доступ до годин — у Розкладі (вкладка "Мої години").
 */
export default function AvailabilityPage() {
  const { t } = useTranslation();
  return (
    <AppLayout>
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-foreground flex items-center gap-2">
          <CalendarClock className="h-6 w-6 text-primary" />
          {t("availability.title")}
        </h1>
        <button
          title={t("availability.subtitle")}
          className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors flex-shrink-0"
          style={{ color: "var(--muted,#b0b4c8)", border: "1px solid var(--border,#eceef3)" }}
          onClick={() => alert(t("availability.subtitle"))}
        >
          <Info className="h-4 w-4" />
        </button>
      </div>
      <AvailabilityManager />
    </AppLayout>
  );
}
