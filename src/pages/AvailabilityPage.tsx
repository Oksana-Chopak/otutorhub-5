import { CalendarClock } from "lucide-react";
import { AvailabilityManager } from "@/components/AvailabilityManager";
import { useTranslation } from "react-i18next";

/**
 * Сторінка залишена для зворотньої сумісності зі старими посиланнями.
 * Основний доступ до годин — у Розкладі (вкладка "Мої години").
 *
 * Довідка («Як це працює?») живе ВСЕРЕДИНІ AvailabilityManager (один пілюля-чип),
 * тож тут НЕ додаємо власну іконку (i) — інакше виходить дубль (див. баг 2026-06).
 */
export default function AvailabilityPage() {
  const { t } = useTranslation();
  return (
    <>
      <h1 className="mb-6 hidden lg:flex font-display text-2xl font-bold text-foreground items-center gap-2">
        <CalendarClock className="h-6 w-6 text-primary" />
        {t("availability.title")}
      </h1>
      <AvailabilityManager />
    </>
  );
}
