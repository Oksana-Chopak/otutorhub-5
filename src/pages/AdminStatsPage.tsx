import { useEffect, useMemo, useState, useCallback } from "react";
import { ErrorState } from "@/components/ErrorState";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { toast } from "sonner";
import { formatPrice } from "@/lib/currency";
import { useTranslation } from "react-i18next";
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
  crm?: {
    funnel: { week: string; signed: number; onboarded: number; l1: number; l5: number; paying: number }[];
    money: { active: number; trial: number; new_paid_month: number; churned_month: number; mrr_uah: number };
    tutors: {
      user_id: string; name: string; contact: { email?: string | null; telegram?: string | null } | null;
      type: "manager" | "independent" | "hub"; stage: string; onboarding_step?: string | null;
      days_since_lesson: number | null; lessons_7d: number; lessons_30d: number;
      active_students: number; students_debt: number; paid_us: number;
      next_charge: string | null; errors_7d: number;
      referred: { total: number; paying: number }; trial_left_days: number | null;
      risk: "red" | "orange" | "green";
    }[];
  };
}

const card = "rounded-[16px] border-[0.5px] border-[var(--border)] bg-card p-4";


type CrmRow = NonNullable<Stats["crm"]>["tutors"][number];

/** Крок 5: картка репетитора — таймлайн, помилки, платежі, останні уроки, дії. */
function CrmDetailSheet({ row, onClose }: { row: CrmRow; onClose: () => void }) {
  useEscapeKey(true, onClose);
  const { t } = useTranslation();
  const [st, setSt] = useState<"loading" | "ready" | "error">("loading");
  const [d, setD] = useState<{
    timeline: { name: string; props: Record<string, unknown> | null; created_at: string }[];
    errors: { message: string; url: string | null; created_at: string }[];
    payments: { created_at: string; amount: number; plan: string | null; status: string; period_end: string | null }[];
    lessons: { subject: string | null; starts_at: string; status: string; paid: boolean }[];
  } | null>(null);
  const [gifting, setGifting] = useState(false);
  const loadDetail = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("admin-stats", { body: { tutor_id: row.user_id } });
      if (error || !data?.detail) { setSt("error"); return; }
      setD(data.detail); setSt("ready");
    } catch { setSt("error"); }
  };
  useEffect(() => { void loadDetail(); }, [row.user_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const dt = (iso: string) => new Date(iso).toLocaleString(getLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const gift = async () => {
    setGifting(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-stats", { body: { tutor_id: row.user_id, action: "gift_pro", days: 7 } });
      if (error || !data?.ok) toast.error(t("adminCrm.giftProFail"));
      else toast.success(t("adminCrm.giftProDone", { d: data.days }));
    } finally { setGifting(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-[20px] bg-card p-4 sm:rounded-[20px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <RiskChip risk={row.risk} t={t} />
          <h3 className="text-[16px] font-bold">{row.name}</h3>
          <span className="text-[13px] text-[var(--sub)]">{t(`adminCrm.stage_${row.stage}`)}</span>
          <button type="button" className="ml-auto rounded-full border px-3 py-1 text-[13px]" onClick={onClose}>{t("adminCrm.close")}</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {row.contact?.telegram && (
            <a className="rounded-full border px-3 py-1.5 text-[13px] font-semibold" target="_blank" rel="noreferrer"
               href={`https://t.me/${String(row.contact.telegram).replace(/^@/, "")}`}>{t("adminCrm.writeTg")}</a>
          )}
          {row.contact?.email && (
            <a className="rounded-full border px-3 py-1.5 text-[13px] font-semibold" href={`mailto:${row.contact.email}`}>{t("adminCrm.writeEmail")}</a>
          )}
          <button type="button" disabled={gifting} onClick={gift}
            className="rounded-full bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground disabled:opacity-60">
            {t("adminCrm.giftPro")}
          </button>
        </div>
        {st === "loading" && <p className="mt-4 text-[14px] text-[var(--sub)]">…</p>}
        {st === "error" && (
          // P5: головна сторінка файлу вміє «Спробувати ще», а картка казала
          // «Немає даних» без повтору — розбіжність усередині одного файлу.
          <div className="mt-4">
            <ErrorState onRetry={() => { setSt("loading"); void loadDetail(); }} retrying={st !== "error"} />
          </div>
        )}
        {st === "ready" && d && (
          <div className="mt-4 space-y-4">
            <section>
              <h4 className="text-[14px] font-bold">{t("adminCrm.cardTimeline")}</h4>
              {d.timeline.length === 0 ? <p className="text-[13px] text-[var(--sub)]">{t("adminCrm.cardEmpty")}</p> : (
                <ul className="mt-1 space-y-1">
                  {d.timeline.map((e, i) => (
                    <li key={i} className="flex justify-between gap-3 text-[13px]">
                      <span className="truncate">{t(`adminCrm.evt_${e.name}`, { defaultValue: e.name })}{e.name === "onboarding_step_done" && (e.props as any)?.step ? ` · ${(e.props as any).step}` : ""}</span>
                      <span className="shrink-0 text-[var(--sub)]">{dt(e.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h4 className="text-[14px] font-bold">{t("adminCrm.cardErrors")}</h4>
              {d.errors.length === 0 ? <p className="text-[13px] text-[var(--sub)]">{t("adminCrm.cardEmpty")}</p> : (
                <ul className="mt-1 space-y-1">
                  {d.errors.map((e, i) => (
                    <li key={i} className="text-[13px]">
                      <span className="text-[var(--sub)]">{dt(e.created_at)}</span> · <span className="break-all">{e.message.slice(0, 140)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h4 className="text-[14px] font-bold">{t("adminCrm.cardPayments")}</h4>
              {d.payments.length === 0 ? <p className="text-[13px] text-[var(--sub)]">{t("adminCrm.cardEmpty")}</p> : (
                <ul className="mt-1 space-y-1">
                  {d.payments.map((pm, i) => (
                    <li key={i} className="flex flex-wrap justify-between gap-2 text-[13px]">
                      <span>{dt(pm.created_at)} · {pm.plan ?? "—"} · {pm.status}</span>
                      <span className="font-semibold">{formatPrice(Number(pm.amount), "UAH")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h4 className="text-[14px] font-bold">{t("adminCrm.cardLessons")}</h4>
              {d.lessons.length === 0 ? <p className="text-[13px] text-[var(--sub)]">{t("adminCrm.cardEmpty")}</p> : (
                <ul className="mt-1 space-y-1">
                  {d.lessons.map((l, i) => (
                    <li key={i} className="flex justify-between gap-3 text-[13px]">
                      <span className="truncate">{l.subject ?? "—"} · {l.status}</span>
                      <span className="shrink-0 text-[var(--sub)]">{dt(l.starts_at)} {l.paid ? "✓" : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

// C7: ризик передавався ЛИШЕ кольором емодзі з aria-hidden — дальтонік не
// відрізняв, скрінрідер не отримував узагалі. Текстовий чип видно всім.
function RiskChip({ risk, t }: { risk: string; t: (k: string) => string }) {
  const cfg =
    risk === "red"
      ? { bg: "rgba(239,68,68,.14)", color: "#b91c1c", key: "adminCrm.risk_red" }
      : risk === "orange"
        ? { bg: "rgba(245,158,11,.16)", color: "#92400e", key: "adminCrm.risk_orange" }
        : { bg: "rgba(34,197,94,.14)", color: "#15803d", key: "adminCrm.risk_green" };
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[13px] font-bold"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {t(cfg.key)}
    </span>
  );
}

export default function AdminStatsPage() {
  const { t } = useTranslation();
  // Активність САМОСТІЙНИХ репетиторів (запит власниці): чи проводять уроки.
  // Рахуємо з вікна останніх уроків, що вже приходить у stats.lessons.
  const [state, setState] = useState<"loading" | "noaccess" | "error" | "ready">("loading");
  const [stats, setStats] = useState<Stats | null>(null);
  const [detail, setDetail] = useState<CrmRow | null>(null);

  /* Аудит 03.09: завантаження жило всередині useEffect, тож кнопці
     «Спробувати ще» не було що викликати. Піднято у функцію. */
  const load = useCallback(async () => {
    {
      setState("loading");
      try {
        // cast: is_superadmin enters generated types only after the migration is applied
        // Аудит 01.09: error не діставався — обрив мережі давав data=null і
        // власниця платформи бачила замок «доступ лише для суперадміна»
        // замість «не вдалося перевірити, спробувати ще».
        const { data: isAdmin, error: adminErr } = await (supabase as any).rpc("is_superadmin");
        if (adminErr) { setState("error"); return; }
        if (isAdmin !== true) { setState("noaccess"); return; }
        const { data, error } = await supabase.functions.invoke("admin-stats");
        if (error || !data) { setState("error"); return; }
        setStats(data as Stats);
        setState("ready");
      } catch {
        setState("error");
      }
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

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
    <>
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
          /* Аудит 03.09: коментар у цьому ж файлі обіцяв «Спробувати ще», а
             головна сторінка мала лише рядок тексту — власниця платформи
             після одного збою мусила перезавантажувати вручну. */
          <div className="mt-6">
            <ErrorState title={t("admin.error")} onRetry={() => void load()} />
          </div>
        )}

        {state === "ready" && stats && (
          <div className="mt-5 space-y-6">
            {/* ── CRM: хто платить, хто відвалюється, кому писати ── */}
            {!stats.crm ? (
              <div className={card}><p className="text-[14px] text-[var(--sub)]">{t("adminCrm.needsDeploy")}</p></div>
            ) : (
              <>
                <section className={card}>
                  <h2 className="text-[15px] font-bold">{t("adminCrm.attentionTitle")}</h2>
                  {stats.crm.tutors.filter((r) => r.risk === "red").length === 0 ? (
                    <p className="mt-2 text-[14px] text-[var(--sub)]">{t("adminCrm.attentionEmpty")}</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {stats.crm.tutors.filter((r) => r.risk === "red").slice(0, 10).map((r) => (
                        <div key={r.user_id} className="flex flex-wrap items-center gap-2 rounded-[12px] bg-[var(--bg)] p-3">
                          {/* C7: замість самого лише кольору — той самий текстовий чип, що й у таблиці */}
                          <RiskChip risk={r.risk} t={t} />
                          <span className="text-[15px] font-semibold">{r.name}</span>
                          <span className="text-[13px] text-[var(--sub)]">{t(`adminCrm.stage_${r.stage}`)}</span>
                          <span className="ml-auto flex gap-2">
                            {r.contact?.telegram && (
                              <a className="text-[13px] font-semibold text-primary underline" target="_blank" rel="noreferrer"
                                 href={`https://t.me/${String(r.contact.telegram).replace(/^@/, "")}`}>{t("adminCrm.writeTg")}</a>
                            )}
                            {r.contact?.email && (
                              <a className="text-[13px] font-semibold text-primary underline" href={`mailto:${r.contact.email}`}>{t("adminCrm.writeEmail")}</a>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className={card}>
                  <h2 className="text-[15px] font-bold">{t("adminCrm.moneyTitle")}</h2>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {([
                      ["moneyActive", stats.crm.money.active],
                      ["moneyTrial", stats.crm.money.trial],
                      ["moneyNewPaid", stats.crm.money.new_paid_month],
                      ["moneyChurned", stats.crm.money.churned_month],
                      ["moneyMrr", formatPrice(stats.crm.money.mrr_uah, "UAH")],
                    ] as [string, number | string][]).map(([k, v]) => (
                      <div key={k} className="rounded-[12px] bg-[var(--bg)] p-3 text-center">
                        <div className="text-[18px] font-extrabold">{v}</div>
                        <div className="text-[13px] text-[var(--sub)]">{t(`adminCrm.${k}`)}</div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className={card}>
                  <h2 className="text-[15px] font-bold">{t("adminCrm.funnelTitle")}</h2>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[420px] text-[13px]">
                      <thead><tr className="text-left text-[var(--sub)]">
                        <th className="py-1 pr-2">{t("adminCrm.week")}</th>
                        <th className="px-2">{t("adminCrm.colSigned")}</th>
                        <th className="px-2">{t("adminCrm.colOnboarded")}</th>
                        <th className="px-2">{t("adminCrm.colL1")}</th>
                        <th className="px-2">{t("adminCrm.colL5")}</th>
                        <th className="px-2">{t("adminCrm.colPaying")}</th>
                      </tr></thead>
                      <tbody>
                        {stats.crm.funnel.map((w) => (
                          <tr key={w.week} className="border-t border-[var(--border)]">
                            <td className="py-1.5 pr-2 font-medium">{w.week}</td>
                            <td className="px-2">{w.signed}</td>
                            <td className="px-2">{w.onboarded}</td>
                            <td className="px-2">{w.l1}</td>
                            <td className="px-2">{w.l5}</td>
                            <td className="px-2">{w.paying}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className={card}>
                  <h2 className="text-[15px] font-bold">{t("adminCrm.tutorsTitle")}</h2>
                  <div className="mt-3 space-y-2">
                    {stats.crm.tutors.map((r) => (
                      <div key={r.user_id} role="button" tabIndex={0} onClick={() => setDetail(r)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetail(r); } }} className="cursor-pointer rounded-[12px] bg-[var(--bg)] p-3 transition hover:bg-white">
                        <div className="flex flex-wrap items-center gap-2">
                          <RiskChip risk={r.risk} t={t} />
                          <span className="text-[15px] font-semibold">{r.name}</span>
                          <span className="rounded-full bg-card px-2 py-0.5 text-[13px] text-[var(--sub)]">{t(`adminCrm.type_${r.type}`)}</span>
                          <span className="text-[13px] text-[var(--sub)]">{t(`adminCrm.stage_${r.stage}`)}{r.stage === "stuck_onboarding" && r.onboarding_step ? ` · ${r.onboarding_step}` : ""}</span>
                          {r.trial_left_days !== null && r.trial_left_days >= 0 && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[13px] text-amber-800">{t("adminCrm.trialLeftChip", { d: r.trial_left_days })}</span>
                          )}
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-4">
                          <span>{t("adminCrm.daysNoLesson")}: <b>{r.days_since_lesson ?? "—"}</b></span>
                          <span>{t("adminCrm.lessons7_30")}: <b>{r.lessons_7d} / {r.lessons_30d}</b></span>
                          <span>{t("adminCrm.studentsCol")}: <b>{r.active_students}</b></span>
                          <span>{t("adminCrm.debtCol")}: <b>{r.students_debt || 0}</b></span>
                          <span>{t("adminCrm.ltvCol")}: <b>{money(r.paid_us)}</b></span>
                          <span>{t("adminCrm.nextChargeCol")}: <b>{r.next_charge ? date(r.next_charge) : "—"}</b></span>
                          <span>{t("adminCrm.errorsCol")}: <b>{r.errors_7d}</b></span>
                          <span>{t("adminCrm.referredCol")}: <b>{r.referred.total} / {r.referred.paying}</b></span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}

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
      {detail && <CrmDetailSheet row={detail} onClose={() => setDetail(null)} />}
    </>
  );
}
