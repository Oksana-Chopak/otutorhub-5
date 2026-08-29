import { useEffect, useMemo, useState } from "react";
import { formatPrice } from "@/lib/currency";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { getLocale } from "@/lib/locale";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface Member { name: string; price: number | null; }
interface LessonRow {
  id: string; date: string; subject: string; status: string; source: string;
  type: "group" | "individual"; price: number | null; tutor: string; participants: string[];
}
interface GroupRow { id: string; name: string; subject: string; tutor: string; members: Member[]; }
interface Stats {
  totals: {
    lessonsTotal: number; lessonsScheduled: number; lessonsCompleted: number; lessonsCancelled: number;
    groups: number; tutors: number; students: number;
  };
  pricing: { count: number; avg: number; min: number; max: number; avgIndividual: number; avgGroup: number };
  activity: { date: string; lessons: number; signups: number; payments: number }[];
  lessons: LessonRow[];
  groups: GroupRow[];
  generatedAt: string;
}

const card = "rounded-[16px] border-[0.5px] border-[var(--border)] bg-white p-4";

export default function AdminStatsPage() {
  const { t } = useTranslation();
  // Активність САМОСТІЙНИХ репетиторів (запит власниці): чи проводять уроки.
  // Рахуємо з вікна останніх уроків, що вже приходить у stats.lessons.
  const [state, setState] = useState<"loading" | "noaccess" | "error" | "ready">("loading");
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // cast: is_superadmin enters generated types only after the migration is applied
        const { data: isAdmin } = await (supabase as any).rpc("is_superadmin");
        if (isAdmin !== true) { setState("noaccess"); return; }
        const { data, error } = await supabase.functions.invoke("admin-stats");
        if (error || !data) { setState("error"); return; }
        setStats(data as Stats);
        setState("ready");
      } catch {
        setState("error");
      }
    })();
  }, []);

  const money = (n: number | null) =>
    n == null ? "—" : formatPrice(Math.round(n), "UAH");
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(getLocale(), { day: "numeric", month: "short", year: "numeric" });

  const indepActivity = useMemo(() => {
    if (!stats) return [] as { tutor: string; lessons30: number; completed30: number; last: string }[];
    const cutoff = Date.now() - 30 * 86400000;
    const m = new Map<string, { lessons30: number; completed30: number; last: string }>();
    for (const l of stats.lessons) {
      if (l.source !== "independent") continue;
      const cur = m.get(l.tutor) ?? { lessons30: 0, completed30: 0, last: l.date };
      const ts = new Date(l.date).getTime();
      if (ts >= cutoff && l.status !== "cancelled") {
        cur.lessons30 += 1;
        if (l.status === "completed") cur.completed30 += 1;
      }
      if (l.date > cur.last) cur.last = l.date;
      m.set(l.tutor, cur);
    }
    return Array.from(m.entries())
      .map(([tutor, v]) => ({ tutor, ...v }))
      .sort((a, b) => b.lessons30 - a.lessons30);
  }, [stats]);

  const statusLabel = (s: string) =>
    s === "scheduled" ? t("admin.statusScheduled")
      : s === "completed" ? t("admin.statusCompleted")
      : s === "cancelled" ? t("admin.statusCancelled")
      : s;

  return (
    <AppLayout>
      <div className="mx-auto w-full max-w-[1100px] px-4 py-5">
        <h1 className="text-[22px] font-extrabold sm:text-2xl">{t("admin.title")}</h1>
        <p className="mt-1 text-[14px] text-[var(--sub)]">{t("admin.subtitle")}</p>

        {state === "loading" && (
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-[78px] animate-pulse rounded-[16px] bg-[var(--bg)]" />
            ))}
          </div>
        )}

        {state === "noaccess" && (
          <div className={`mt-6 ${card} text-[15px]`}>🔒 {t("admin.noAccess")}</div>
        )}
        {state === "error" && (
          <div className={`mt-6 ${card} text-[15px]`}>⚠️ {t("admin.error")}</div>
        )}

        {state === "ready" && stats && (
          <div className="mt-5 space-y-6">
            {/* KPI cards */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                { label: t("admin.kpiLessons"), val: stats.totals.lessonsTotal },
                { label: t("admin.kpiScheduled"), val: stats.totals.lessonsScheduled },
                { label: t("admin.kpiCompleted"), val: stats.totals.lessonsCompleted },
                { label: t("admin.kpiCancelled"), val: stats.totals.lessonsCancelled },
                { label: t("admin.kpiGroups"), val: stats.totals.groups },
                { label: t("admin.kpiTutors"), val: stats.totals.tutors },
                { label: t("admin.kpiStudents"), val: stats.totals.students },
              ].map((k) => (
                <div key={k.label} className={card}>
                  <div className="text-[26px] font-extrabold text-[var(--txt)]">{k.val}</div>
                  <div className="mt-0.5 text-[14px] font-semibold uppercase tracking-[0.04em] text-[var(--sub)]">{k.label}</div>
                </div>
              ))}
            </div>

            {/* Самостійні репетитори — активність (superadmin) */}
            <div className={card}>
              <h2 className="mb-2 text-[15px] font-bold">{t("admin.indepTitle")}</h2>
              {indepActivity.length === 0 ? (
                <p className="text-[14px] text-[var(--sub)]">{t("admin.indepEmpty")}</p>
              ) : (
                <div className="space-y-1.5">
                  {indepActivity.map((r) => (
                    <div key={r.tutor} className="flex items-center justify-between gap-3 text-[14px]">
                      <span className="min-w-0 truncate font-semibold">{r.tutor}</span>
                      <span className="shrink-0 text-[var(--sub)]">
                        {t("admin.indepLine", { n: r.lessons30, done: r.completed30 })} · {date(r.last)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Activity over time */}
            <div className={card}>
              <h2 className="mb-3 text-[15px] font-bold">{t("admin.activityTitle")}</h2>
              {stats.activity.length === 0 ? (
                <p className="text-[14px] text-[var(--sub)]">{t("admin.noData")}</p>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={stats.activity} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef0f4" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 13 }} tickFormatter={(d) => d.slice(5)} minTickGap={20} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 13 }} width={32} />
                    <Tooltip contentStyle={{ fontSize: 13, borderRadius: 12 }} />
                    <Bar dataKey="lessons" name={t("admin.activityLessons")} fill="#2BBFAA" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="payments" name={t("admin.activityPayments")} fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="signups" name={t("admin.activitySignups")} fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Pricing dynamics */}
            <div className={card}>
              <h2 className="mb-3 text-[15px] font-bold">{t("admin.pricingTitle")}</h2>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  { label: t("admin.pricingAvg"), val: money(stats.pricing.avg) },
                  { label: t("admin.pricingIndividual"), val: money(stats.pricing.avgIndividual) },
                  { label: t("admin.pricingGroup"), val: money(stats.pricing.avgGroup) },
                  { label: t("admin.pricingRange"), val: `${money(stats.pricing.min)} – ${money(stats.pricing.max)}` },
                ].map((p) => (
                  <div key={p.label} className="rounded-[12px] bg-[var(--bg)] p-3">
                    <div className="text-[17px] font-bold text-[var(--txt)]">{p.val}</div>
                    <div className="mt-0.5 text-[14px] text-[var(--sub)]">{p.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Lessons list */}
            <div className={card}>
              <h2 className="mb-3 text-[15px] font-bold">{t("admin.lessonsTitle")}</h2>
              {stats.lessons.length === 0 ? (
                <p className="text-[14px] text-[var(--sub)]">{t("admin.noData")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[14px]">
                    <thead>
                      <tr className="text-left text-[14px] uppercase tracking-[0.04em] text-[var(--sub)]">
                        <th className="py-2 pr-3 font-semibold">{t("admin.colDate")}</th>
                        <th className="py-2 pr-3 font-semibold">{t("admin.colSubject")}</th>
                        <th className="py-2 pr-3 font-semibold">{t("admin.colTutor")}</th>
                        <th className="py-2 pr-3 font-semibold">{t("admin.colStatus")}</th>
                        <th className="py-2 pr-3 font-semibold">{t("admin.colType")}</th>
                        <th className="py-2 pr-3 font-semibold">{t("admin.colPrice")}</th>
                        <th className="py-2 font-semibold">{t("admin.colParticipants")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.lessons.map((l) => (
                        <tr key={l.id} className="border-t border-[var(--border)] align-top">
                          <td className="py-2 pr-3 whitespace-nowrap">{date(l.date)}</td>
                          <td className="py-2 pr-3">{l.subject}</td>
                          <td className="py-2 pr-3 whitespace-nowrap">{l.tutor}</td>
                          <td className="py-2 pr-3 whitespace-nowrap">{statusLabel(l.status)}</td>
                          <td className="py-2 pr-3 whitespace-nowrap">{l.type === "group" ? t("admin.typeGroup") : t("admin.typeIndividual")}</td>
                          <td className="py-2 pr-3 whitespace-nowrap">{money(l.price)}</td>
                          <td className="py-2">{l.participants.join(", ") || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Groups list */}
            <div className={card}>
              <h2 className="mb-3 text-[15px] font-bold">{t("admin.groupsTitle")}</h2>
              {stats.groups.length === 0 ? (
                <p className="text-[14px] text-[var(--sub)]">{t("admin.noData")}</p>
              ) : (
                <div className="space-y-3">
                  {stats.groups.map((g) => (
                    <div key={g.id} className="rounded-[12px] bg-[var(--bg)] p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-[15px] font-bold">{g.name}</span>
                        <span className="text-[14px] text-[var(--sub)]">{g.subject} · {g.tutor}</span>
                      </div>
                      <div className="mt-2 text-[14px]">
                        {g.members.length === 0 ? (
                          <span className="text-[var(--sub)]">{t("admin.noData")}</span>
                        ) : (
                          g.members.map((m, i) => (
                            <span key={i} className="mr-2 inline-block whitespace-nowrap">
                              {m.name} <span className="text-[var(--sub)]">({money(m.price)})</span>
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="text-[14px] text-[var(--sub)]">
              {t("admin.generatedAt", { date: new Date(stats.generatedAt).toLocaleString(getLocale()) })}
            </p>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
