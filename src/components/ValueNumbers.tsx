import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { formatPrice } from "@/lib/currency";
import { PRICE_PER_MONTH, priceLabel } from "@/lib/pricing";

/**
 * ПЕЙВОЛ ІЗ ЦИФРАМИ (01.11, Рада 26.10, п. 4).
 *
 * Гола ціна «299 ₴/міс» нічого не виправдовує. Виправдовують ЇЇ цифри:
 *   · проведено уроків за 30 днів
 *   · нагадано без неї (справжні канали, не дзвіночок)
 *   · повернуто після нагадувань
 *   · середній час до оплати після нагадування
 * і одна фраза: «299 ₴ — це менше одного твого уроку».
 *
 * Якщо цифр ще немає (новачок нічим не користувався) — не продаємо, а ведемо
 * назад в онбординг: «додай учня, щоб побачити, як це працює». Одне джерело
 * цифр — RPC `tutor_value_stats` (міграція 20261101120000), спільне з
 * тижневим дайджестом і сторінкою підписки.
 */
export interface ValueStats {
  conducted_30d: number;
  students_30d: number;
  reminded_times: number;
  recovered_sum: number;
  recovered_lessons: number;
  currency: string;
  avg_hours_to_pay: number | null;
  active_days_30d: number;
}

export function useTutorValueStats(enabled = true) {
  const [stats, setStats] = useState<ValueStats | null>(null);
  const [loading, setLoading] = useState(enabled);
  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    let alive = true;
    (async () => {
      try {
        const { data, error } = await (supabase.rpc as any)("tutor_value_stats", { _tutor_id: null });
        if (!alive) return;
        if (error || !data) { setStats(null); return; }
        setStats(data as ValueStats);
      } catch {
        if (alive) setStats(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [enabled]);
  return { stats, loading };
}

/** Чи є що показати: хоч один урок, нагадування чи повернута оплата. */
export function hasValue(s: ValueStats | null): boolean {
  return !!s && (s.conducted_30d > 0 || s.reminded_times > 0 || s.recovered_sum > 0);
}

/** Чотири цифри тилом сітки + фраза про частку уроку. Null, коли цифр немає. */
export function ValueNumbers({ stats, compact }: { stats: ValueStats | null; compact?: boolean }) {
  const { t } = useTranslation();
  if (!hasValue(stats) || !stats) return null;
  const avgPrice = stats.recovered_lessons > 0 ? stats.recovered_sum / stats.recovered_lessons : 0;
  const share = avgPrice > 0 ? Math.round((PRICE_PER_MONTH.monthly / avgPrice) * 10) / 10 : null;
  const hours = stats.avg_hours_to_pay;
  const tiles: Array<{ n: string; l: string }> = [
    { n: String(stats.conducted_30d), l: t("valueNumbers.conducted") },
    { n: String(stats.reminded_times), l: t("valueNumbers.reminded") },
    { n: formatPrice(stats.recovered_sum, stats.currency), l: t("valueNumbers.recovered") },
    {
      n: hours == null ? "—" : hours < 48 ? t("valueNumbers.hours", { count: Math.max(1, Math.round(hours)) }) : t("valueNumbers.days", { count: Math.round(hours / 24) }),
      l: t("valueNumbers.timeToPay"),
    },
  ];
  return (
    <div data-testid="value-numbers">
      <div className="grid grid-cols-2 gap-2">
        {tiles.map((x) => (
          <div key={x.l} className="rounded-[14px] bg-secondary px-3 py-2.5">
            <p className="text-[20px] font-extrabold leading-tight text-foreground" style={{ fontFamily: "Inter, system-ui, sans-serif", letterSpacing: "-.01em" }}>{x.n}</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground" style={{ lineHeight: 1.3 }}>{x.l}</p>
          </div>
        ))}
      </div>
      {!compact && (
        <p className="mt-3 text-[14px] text-foreground" style={{ lineHeight: 1.45 }}>
          {share && share <= 1
            ? t("valueNumbers.shareLess", { price: priceLabel("monthly") })
            : share
              ? t("valueNumbers.shareLessons", { price: priceLabel("monthly"), count: Math.ceil(share) })
              : t("valueNumbers.shareGeneric", { price: priceLabel("monthly") })}
        </p>
      )}
    </div>
  );
}

/** Коли цифр немає: не ціна, а шлях до першої цінності. */
export function ValueEmpty({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-[14px] px-4 py-3 text-[14px]" style={{ background: "var(--teal-l,#f0fdf9)", color: "var(--teal-text,#1a7a6c)", lineHeight: 1.45 }}>
      <p className="font-semibold text-foreground">{t("valueNumbers.emptyTitle")}</p>
      <p className="mt-1 text-muted-foreground">{t("valueNumbers.emptyDesc")}</p>
      <Link to="/onboarding" onClick={onClose} className="mt-2 inline-flex items-center font-bold" style={{ minHeight: 44, color: "var(--teal-text,#1a7a6c)" }}>
        {t("valueNumbers.emptyCta")} →
      </Link>
    </div>
  );
}
