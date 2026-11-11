import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMyHub } from "@/hooks/useMyHub";
import { useDataVersion } from "@/lib/dataBus";

/**
 * «Запуск школи» — картка на «Моєму дні» менеджера, поки школа не запрацювала (11.11).
 *
 * Живий прохід нової школи показав: власниця після підключення бачила порожній
 * дашборд із «Сьогодні вільний день», «Так тримати! Усі уроки оплачені» та «Усе під
 * контролем 🎉» — тобто святкування на порожньому місці й жодного слова про те, що
 * робити першим. А порядок тут не очевидний і жорсткий: без репетитора немає кого
 * призначити учневі, без пари «учень — репетитор — ціна» форма уроку порожня.
 *
 * Картка веде цим порядком: кожен крок — один дотик у те місце, де він робиться,
 * зроблене позначається саме (рахуємо з бази, а не з памʼяті пристрою), і коли
 * перший урок стоїть — картка зникає назавжди. Школі, що вже працює, вона не
 * показується зовсім.
 */
type Counts = { tutors: number; students: number; pairs: number; lessons: number };

export function SchoolSetupCard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { hub } = useMyHub();
  const dataVersion = useDataVersion();
  const [c, setC] = useState<Counts | null>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      const head = { count: "exact" as const, head: true };
      // Усе читання — крізь RLS менеджера: рахується лише його школа.
      const [tu, st, pr, le] = await Promise.all([
        supabase.from("user_roles").select("user_id", head).eq("role", "tutor"),
        supabase.from("user_roles").select("user_id", head).eq("role", "student"),
        supabase.from("student_rates").select("id", head).is("archived_at", null),
        supabase.from("lessons").select("id", head),
      ]);
      if (!alive) return;
      // «Не прочитав» ≠ «нічого немає»: при збої картку не показуємо взагалі,
      // щоб не вчити школу, що працює, «додати першого репетитора».
      if (tu.error || st.error || pr.error || le.error) { setC(null); return; }
      setC({ tutors: tu.count ?? 0, students: st.count ?? 0, pairs: pr.count ?? 0, lessons: le.count ?? 0 });
    })();
    return () => { alive = false; };
  }, [user?.id, dataVersion]);

  if (!c || c.lessons > 0) return null;

  const steps = [
    { key: "tutor", done: c.tutors > 0, to: "/people?add=tutor" },
    { key: "student", done: c.students > 0, to: "/people?add=student" },
    { key: "pair", done: c.pairs > 0, to: "/people?tab=students" },
    { key: "lesson", done: false, to: "/schedule?create=1" },
  ] as const;
  const next = steps.findIndex((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <section
      aria-label={t("schoolSetup.title")}
      className="mb-4 rounded-[16px] border-[0.5px] border-[var(--border)] bg-card p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-extrabold text-foreground">
          🚀 {hub?.name ? t("schoolSetup.titleNamed", { name: hub.name }) : t("schoolSetup.title")}
        </h2>
        <span className="shrink-0 text-[14px] font-semibold text-muted-foreground">{doneCount}/{steps.length}</span>
      </div>
      <p className="mt-1 text-[14px] text-muted-foreground">{t("schoolSetup.subtitle")}</p>
      <ol className="mt-3 space-y-2">
        {steps.map((s, i) => {
          const isNext = i === next;
          const locked = !s.done && i > next;   // крок ще не має сенсу: бракує попереднього
          const body = (
            <>
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[14px] font-bold"
                style={{
                  background: s.done ? "var(--teal)" : isNext ? "var(--teal-l)" : "var(--bg)",
                  color: s.done ? "#fff" : isNext ? "var(--teal-text)" : "var(--sub)",
                }}
              >
                {s.done ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-[15px] font-semibold ${s.done ? "text-muted-foreground line-through" : "text-foreground"}`}>
                  {t(`schoolSetup.step_${s.key}`)}
                </span>
                {isNext && (
                  <span className="mt-0.5 block text-[14px] text-muted-foreground">{t(`schoolSetup.hint_${s.key}`)}</span>
                )}
              </span>
              {!s.done && !locked && <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />}
            </>
          );
          const cls = `flex min-h-[52px] items-center gap-3 rounded-[12px] px-3 py-2 ${isNext ? "bg-[var(--teal-l)] dark:bg-[rgba(43,191,170,.12)]" : ""}`;
          return (
            <li key={s.key}>
              {s.done || locked ? (
                <div className={cls} aria-disabled={locked || undefined} style={locked ? { opacity: 0.6 } : undefined}>{body}</div>
              ) : (
                <Link to={s.to} className={cls}>{body}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
