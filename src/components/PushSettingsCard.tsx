import { useTranslation } from "react-i18next";
import { PushNotificationToggle } from "@/components/PushNotificationToggle";
import { isPushCapable } from "@/hooks/usePushNotifications";

/**
 * Картка «Пуш-сповіщення» — ОДНА на весь застосунок.
 *
 * Аудит шляхів 24.09 (§4, учень): «пуші учневі нема де ввімкнути». І це було
 * буквально так: картка жила локальною функцією в `ProfilePage`, а `/profile`
 * відкритий лише репетитору й менеджеру; у поповері дзвіночка тумблер зʼявлявся
 * тільки якщо сповіщення ВЖЕ є, тож учень без сповіщень не мав входу взагалі.
 * Тому картку винесено сюди й додано в профіль УЧНЯ — не другою копією, а тим
 * самим компонентом.
 *
 * П2.8 (вердикт 31.08): ховаємось лише там, де пуші справді неможливі
 * (`isPushCapable`), а не «в нативі» — у нативі вони живі через FCM.
 */
export function PushSettingsCard() {
  const { t } = useTranslation();
  if (!isPushCapable()) return null;
  return (
    <div className="mb-4 rounded-[16px] border-[0.5px] bg-card p-4" style={{ borderColor: "var(--border,var(--ds-border,#eceef3))" }}>
      <p style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 15, color: "var(--ds-txt,#0f0f1a)" }}>
        {t("pushNotif.cardTitle")}
      </p>
      <p className="mt-0.5 mb-3 text-[14px]" style={{ color: "var(--sub,#62677E)" }}>
        {t("pushNotif.cardDesc")}
      </p>
      <PushNotificationToggle />
    </div>
  );
}
