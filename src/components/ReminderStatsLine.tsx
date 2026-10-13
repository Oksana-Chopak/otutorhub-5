import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { formatPrice } from "@/lib/currency";

/**
 * «Вау»-лічильник (13.10, пре-мортем; рішення власниці: не на головний екран,
 * але десь поставити можна): «Нагадано за вас N разів · повернуто M після
 * нагадувань». Це доказ головної обіцянки продукту цифрами людини — тому
 * він стоїть там, де людина думає про гроші й про те, чи платити за Pro:
 * у Фінансах, на сторінці підписки й у тижневому дайджесті.
 *
 * ОДНЕ джерело цифр — RPC `tutor_reminder_stats` (міграція 20261013150000):
 * нагадування = один запис на учня на день незалежно від каналів;
 * «повернуто» = проведені уроки, оплачені ПІСЛЯ нагадування про них.
 * Рядок не рендериться, поки нагадувань 0 (хвалитись нічим — і не вигадуємо),
 * і коли бази ще нема (SQL не вставлено) — відсутнє рендериться як відсутнє.
 */
export interface ReminderStats {
  reminded_times: number;
  recovered_lessons: number;
  recovered_sum: number;
  currency: string;
}

export function useReminderStats(tutorId?: string | null): ReminderStats | null {
  const [stats, setStats] = useState<ReminderStats | null>(null);
  useEffect(() => {
    if (!tutorId) { setStats(null); return; }
    let alive = true;
    (async () => {
      try {
        const { data, error } = await (supabase.rpc as any)("tutor_reminder_stats", { _tutor_id: tutorId });
        if (!alive || error || !data) return;
        setStats({
          reminded_times: Number(data.reminded_times ?? 0),
          recovered_lessons: Number(data.recovered_lessons ?? 0),
          recovered_sum: Number(data.recovered_sum ?? 0),
          currency: String(data.currency ?? "UAH"),
        });
      } catch { /* бази ще нема — рядка немає */ }
    })();
    return () => { alive = false; };
  }, [tutorId]);
  return stats;
}

export function ReminderStatsLine({ tutorId, variant = "card" }: { tutorId?: string | null; variant?: "card" | "hero" }) {
  const { t } = useTranslation();
  const stats = useReminderStats(tutorId);
  if (!stats || stats.reminded_times <= 0) return null;
  const reminded = t("reminderStats.reminded", { count: stats.reminded_times });
  const recovered = stats.recovered_sum > 0
    ? t("reminderStats.recovered", { sum: formatPrice(stats.recovered_sum, stats.currency) })
    : null;
  if (variant === "hero") {
    return (
      <div data-testid="reminder-stats" style={{ marginTop: 14, padding: "10px 12px", borderRadius: 12, background: "rgba(255,255,255,.08)", fontSize: 14, lineHeight: 1.45, color: "rgba(255,255,255,.85)" }}>
        🔔 {reminded}{recovered ? ` · 💸 ${recovered}` : ""}
        <div style={{ fontSize: 13, color: "rgba(255,255,255,.6)", marginTop: 2 }}>{t("reminderStats.heroTail")}</div>
      </div>
    );
  }
  return (
    <div data-testid="reminder-stats" className="rounded-[16px] border-[0.5px] border-border bg-card px-4 py-3 text-[14px] text-foreground" style={{ lineHeight: 1.45 }}>
      <span className="font-semibold">🔔 {reminded}</span>
      {recovered && <span> · 💸 {recovered}</span>}
      <div className="text-[13px] text-muted-foreground" style={{ marginTop: 2 }}>{t("reminderStats.cardTail")}</div>
    </div>
  );
}
