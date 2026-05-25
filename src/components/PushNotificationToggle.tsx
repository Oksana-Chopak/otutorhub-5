import { Bell, BellOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useTranslation } from "react-i18next";

export function PushNotificationToggle() {
  const { t } = useTranslation();
  const { supported, permission, subscribed, loading, subscribe, unsubscribe } = usePushNotifications();

  if (!supported) return null;
  if (permission === "denied") {
    return (
      <p className="text-xs text-muted-foreground">{t("pushNotif.denied")}</p>
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
