import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { openExternal } from "@/lib/openExternal";
import { logEvent } from "@/lib/analytics";
import { formatPrice } from "@/lib/currency";

/**
 * «Підключи Telegram» одразу після імпорту (13.10, пре-мортем, важіль «дайджест
 * у Telegram одразу після імпорту»). Момент обрано свідомо: щойно людина
 * перенесла учнів — у неї є що показати в дайджесті, і бот у мить підключення
 * надішле перший (telegram-poll → tutor_snapshot). До імпорту це було б
 * «підключи щось, щоб колись щось отримувати».
 *
 * Один дотик: код генерується тут (як в OnboardingFlowB), кнопка відкриває
 * t.me/<бот>?start=<код>. «Пізніше» — тиша на 14 днів (localStorage), щоб
 * аркуш не ставав настирливим.
 */
const SNOOZE_KEY = "ot_tg_nudge_snooze_until";
export const TG_NUDGE_SNOOZE_DAYS = 14;

export function tgNudgeSnoozed(now = Date.now()): boolean {
  try { return Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > now; } catch { return false; }
}
export function snoozeTgNudge(now = Date.now()): void {
  try { localStorage.setItem(SNOOZE_KEY, String(now + TG_NUDGE_SNOOZE_DAYS * 86_400_000)); } catch { /* приватний режим */ }
}

export function TelegramNudgeSheet({ open, onOpenChange, students, debtTotal, currency = "UAH" }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  students: number;
  debtTotal: number;
  currency?: string;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [botUrl, setBotUrl] = useState("");

  useEffect(() => {
    if (!open || !user) return;
    let alive = true;
    (async () => {
      const [{ data: code }, info] = await Promise.all([
        supabase.rpc("generate_telegram_link_code", { _user_id: user.id }),
        supabase.functions.invoke("telegram-bot-info").catch(() => ({ data: null })),
      ]);
      if (!alive) return;
      const d = (info as { data?: { bot_username?: string; username?: string } | null })?.data;
      const bot = d?.bot_username || d?.username || "oTutorHubBot";
      setBotUrl(typeof code === "string" && code ? `https://t.me/${bot}?start=${code}` : `https://t.me/${bot}`);
    })();
    return () => { alive = false; };
  }, [open, user?.id]);

  const connect = () => {
    logEvent("tg_nudge_connect", { students });
    void openExternal(botUrl || "https://t.me/oTutorHubBot");
    onOpenChange(false);
  };
  const later = () => {
    logEvent("tg_nudge_later", { students });
    snoozeTgNudge();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) later(); else onOpenChange(o); }}>
      <DialogContent aria-describedby={undefined} className="w-full max-w-md p-0 gap-0 rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto [&>button.absolute]:hidden">
        <DialogTitle className="sr-only">{t("tgNudge.title")}</DialogTitle>
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden"><div className="h-1 w-9 rounded-full bg-border" /></div>
        <div style={{ padding: "12px 20px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div className="text-foreground" style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 20, letterSpacing: "-.01em" }}>
              ✈️ {t("tgNudge.title")}
            </div>
            <button type="button" onClick={later} aria-label={t("common.close")}
              className="bg-secondary text-muted-foreground" style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <X size={18} />
            </button>
          </div>
          <p className="text-muted-foreground" style={{ fontSize: 15, lineHeight: 1.45, marginTop: 6 }}>
            {debtTotal > 0
              ? t("tgNudge.introDebt", { count: students, sum: formatPrice(debtTotal, currency) })
              : t("tgNudge.intro", { count: students })}
          </p>
          <ul className="text-foreground" style={{ fontSize: 15, lineHeight: 1.5, margin: "12px 0 0", paddingLeft: 0, listStyle: "none" }}>
            <li>🌅 {t("tgNudge.b1")}</li>
            <li>🔔 {t("tgNudge.b2")}</li>
            <li>💸 {t("tgNudge.b3")}</li>
          </ul>
          <button type="button" onClick={connect}
            className="w-full text-white"
            style={{ marginTop: 18, height: 52, borderRadius: 14, border: "none", cursor: "pointer", background: "#2AABEE", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 16 }}>
            {t("tgNudge.connect")}
          </button>
          <button type="button" onClick={later}
            className="w-full text-muted-foreground"
            style={{ marginTop: 8, height: 44, borderRadius: 12, border: "none", cursor: "pointer", background: "transparent", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 600, fontSize: 15 }}>
            {t("tgNudge.later")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
