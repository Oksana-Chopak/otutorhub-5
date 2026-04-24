import { AppLayout } from "@/components/AppLayout";
import { CalendarClock } from "lucide-react";
import { AvailabilityManager } from "@/components/AvailabilityManager";

/**
 * Сторінка залишена для зворотньої сумісності зі старими посиланнями.
 * Основний доступ до годин — у Розкладі (вкладка "Мої години").
 */
export default function AvailabilityPage() {
  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground flex items-center gap-2">
          <CalendarClock className="h-6 w-6 text-primary" />
          Доступні години
        </h1>
        <p className="text-sm text-muted-foreground">
          Тижневий шаблон вільних годин і вихідні дні. Учні бачать ваші вільні слоти, щоб домовитися про урок у чаті.
        </p>
      </div>
      <AvailabilityManager />
    </AppLayout>
  );
}
