import { AppLayout } from "@/components/AppLayout";
import { CalendarClock } from "lucide-react";
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
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground flex items-center gap-2">
          <CalendarClock className="h-6 w-6 text-primary" />
          {t("availability.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("availability.subtitle")}
        </p>
      </div>
      <AvailabilityManager />
    </AppLayout>
  );
}
