import { Bell, BellOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { isNativeApp } from "@/lib/platform";
import { useTranslation } from "react-i18next";

export function PushNotificationToggle() {
  const { t } = useTranslation();
  const { supported, permission, subscribed, loading, subscribe, unsubscribe } = usePushNotifications();

  // Web Push (service worker + VAPID) does not work inside the iOS/Android native
  // wrapper — hide the toggle there so it isn't a dead control. Native push needs
  // @capacitor/push-notifications + APNs/FCM (v1.1).
  if (isNativeApp()) return null;
  if (!supported) return null;
  if (permission === "denied") {
    return (
      <p className="text-[14px] text-muted-foreground">{t("pushNotif.denied")}</p>
    );
  }

  return (
    <Button
      variant={subscribed ? "secondary" : "outline"}
      size="sm"
      onClick={subscribed ? unsubscribe : subscribe}
      disabled={loading}
      className="w-full justify-start gap-2"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : subscribed ? (
        <Bell className="h-4 w-4 text-primary" />
      ) : (
        <BellOff className="h-4 w-4" />
      )}
      {subscribed ? t("pushNotif.enabled") : t("pushNotif.enable")}
    </Button>
  );
}
