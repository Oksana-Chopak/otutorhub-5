import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatPrice } from "@/lib/currency";

/**
 * «Нагадування повернули X ₴» (05.09, премортем п.1: продукт має показувати
 * ГРОШІ, які він приніс, а не лише порядок). Метрика: уроки, оплачені
 * протягом 7 днів ПІСЛЯ надісланого нагадування про оплату, за останні
 * 60 днів. Джерела: lesson_payment_reminders (RLS: репетитор бачить свої) +
 * lessons_visible (оплата/сума/валюта). Це та сама цифра, що піде в
 * рекламні креативи — тут вона чесно рахується з власних даних людини.
 *
 * Рендериться ЛИШЕ коли є що показати (>0) — нуль не soромимо.
 */
const WINDOW_DAYS = 60;
const ATTRIBUTION_DAYS = 7;

export function RemindersRecoveredCard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [state, setState] = useState<{ byCur: Record<string, number>; lessons: number } | null>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    void (async () => {
      const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
      const { data: reminders, error: remErr } = await supabase
        .from("lesson_payment_reminders")
        .select("lesson_id, sent_at")
        .eq("tutor_id", user.id)
        .gte("sent_at", since)
        .order("sent_at", { ascending: true })
        .limit(500);
      if (!alive || remErr || !reminders || reminders.length === 0) return;

      // Перше нагадування по кожному уроку — точка відліку атрибуції.
      const firstByLesson = new Map<string, number>();
      for (const r of reminders as Array<{ lesson_id: string; sent_at: string }>) {
        if (!firstByLesson.has(r.lesson_id)) {
          firstByLesson.set(r.lesson_id, new Date(r.sent_at).getTime());
        }
      }
      const ids = Array.from(firstByLesson.keys());
      // Той самий доступ, що всюди в застосунку: lessons_visible (RLS + маскування).
      const { data: lessons, error: lesErr } = await (supabase.from("lessons_visible" as any) as any)
        .select("id, student_payment_status, student_paid_at, student_price, currency")
        .in("id", ids);
      if (!alive || lesErr || !lessons) return;

      const byCur: Record<string, number> = {};
      let count = 0;
      for (const l of lessons as Array<{
        id: string;
        student_payment_status: string | null;
        student_paid_at: string | null;
        student_price: number | null;
        currency: string | null;
      }>) {
        if (l.student_payment_status !== "paid" || !l.student_paid_at) continue;
        const remAt = firstByLesson.get(l.id);
        if (remAt === undefined) continue;
        const paidAt = new Date(l.student_paid_at).getTime();
        // Оплата ПІСЛЯ нагадування і в межах вікна атрибуції.
        if (paidAt < remAt || paidAt > remAt + ATTRIBUTION_DAYS * 86_400_000) continue;
        const price = Number(l.student_price ?? 0);
        if (price <= 0) continue;
        const cur = l.currency ?? "UAH";
        byCur[cur] = (byCur[cur] ?? 0) + price;
        count++;
      }
      if (!alive || count === 0) return;
      setState({ byCur, lessons: count });
    })();
    return () => { alive = false; };
  }, [user?.id]);

  if (!state) return null;
  const sumLabel = Object.entries(state.byCur)
    .map(([cur, sum]) => formatPrice(sum, cur))
    .join(" + ");

  return (
    <div
      className="mt-3 rounded-[16px] p-4"
      style={{
        background: "linear-gradient(135deg, rgba(43,191,170,.12), rgba(43,191,170,.04))",
        border: "1px solid rgba(43,191,170,.3)",
      }}
    >
      <p className="text-[13px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sub,#666b82)" }}>
        💌 {t("remindersRecovered.label")}
      </p>
      <p className="mt-1 text-[22px] font-extrabold" style={{ color: "#1f8e7e", fontFamily: "Inter, system-ui, sans-serif", letterSpacing: "-.01em" }}>
        {sumLabel}
      </p>
      <p className="mt-0.5 text-[14px] text-muted-foreground">
        {t("remindersRecovered.desc", { count: state.lessons, days: WINDOW_DAYS })}
      </p>
    </div>
  );
}
