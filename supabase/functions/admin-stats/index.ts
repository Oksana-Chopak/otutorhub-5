// admin-stats — PLATFORM-WIDE statistics for the superadmin (platform owner).
//
// Security: the caller is identified by their own JWT, then checked against the
// platform_admins table using the service role. Only a superadmin gets data; everyone
// else gets 403. This is the ONLY place that reads across all hubs/tutors — per-user /
// per-hub RLS stays strict everywhere else.
//
// Returns: totals (lesson statuses, groups, tutors, students), a recent-window lesson
// list, the groups list with members, a pricing summary, and 60-day activity.
// READ-ONLY. Detail (lists/pricing/activity) is a recent window; totals are all-time.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const WINDOW_LESSONS = 500; // recent lessons used for the list
const DETAIL_LIMIT = 3000;  // safety cap for detail tables
const ACTIVITY_DAYS = 60;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json({ error: "Missing env" }, 500);
    }

    // 1. Identify the caller from their own JWT.
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

    // 2. Superadmin gate (service-role lookup; RLS-independent).
    const { data: adminRow } = await admin
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!adminRow) return json({ error: "Forbidden — superadmin only" }, 403);

    // ── Картка репетитора (спека, крок 5): деталь по кліку + дія «подарувати Pro» ──
    const detBody = await req.json().catch(() => null);
    const detTutor: string | undefined = detBody?.tutor_id;
    if (detTutor) {
      if (detBody?.action === "gift_pro") {
        const detDays = Number(detBody?.days ?? 7) || 7;
        const { error: gErr } = await admin.rpc("grant_pro_days", {
          _tutor_id: detTutor, _days: detDays, _reason: "superadmin_gift", _metadata: {},
        });
        if (gErr) return json({ error: "gift_failed" }, 400);
        return json({ ok: true, days: detDays });
      }
      const d30 = new Date(Date.now() - 30 * 86400000).toISOString();
      const [evR, erR, pyR, lsR] = await Promise.all([
        admin.from("app_events").select("name, props, created_at").eq("user_id", detTutor).gte("created_at", d30).order("created_at", { ascending: false }).limit(100),
        admin.from("error_log").select("message, url, created_at").eq("user_id", detTutor).gte("created_at", d30).order("created_at", { ascending: false }).limit(30),
        admin.from("liqpay_payments").select("created_at, amount, plan, status, period_end").eq("tutor_id", detTutor).order("created_at", { ascending: false }).limit(20),
        admin.from("lessons").select("id, subject, starts_at, status").eq("tutor_id", detTutor).order("starts_at", { ascending: false }).limit(10),
      ]);
      const detLessonIds = (lsR.data ?? []).map((l: { id: string }) => l.id);
      const detPaid = new Map<string, string>();
      if (detLessonIds.length) {
        const { data: ldS } = await admin.from("lesson_details")
          .select("lesson_id, student_payment_status").in("lesson_id", detLessonIds);
        for (const x of ldS ?? []) detPaid.set(x.lesson_id, x.student_payment_status);
      }
      return json({
        detail: {
          timeline: evR.data ?? [],
          errors: erR.data ?? [],
          payments: pyR.data ?? [],
          lessons: (lsR.data ?? []).map((l: { id: string }) => ({ ...l, paid: detPaid.get(l.id) === "paid" })),
        },
      });
    }

    const safe = async <T,>(p: PromiseLike<{ data: T | null; error: unknown }>, fb: NonNullable<T>): Promise<NonNullable<T>> => {
      try { const { data, error } = await p; return error ? fb : ((data as NonNullable<T>) ?? fb); } catch { return fb; }
    };
    const countOf = async (status?: string): Promise<number> => {
      let q = admin.from("lessons").select("id", { count: "exact", head: true });
      if (status) q = q.eq("status", status);
      const { count, error } = await q;
      return error ? 0 : (count ?? 0);
    };

    // 3. Totals (all-time, exact).
    const [lessonsTotal, scheduled, completed, cancelled] = await Promise.all([
      countOf(), countOf("scheduled"), countOf("completed"), countOf("cancelled"),
    ]);
    const groupsCount = await (async () => {
      const { count } = await admin.from("lesson_groups").select("id", { count: "exact", head: true });
      return count ?? 0;
    })();
    const tutorsCount = await (async () => {
      const { count } = await admin.from("user_roles").select("id", { count: "exact", head: true }).eq("role", "tutor");
      return count ?? 0;
    })();
    const studentsCount = await (async () => {
      const { count } = await admin.from("user_roles").select("id", { count: "exact", head: true }).eq("role", "student");
      return count ?? 0;
    })();

    // 4. Detail fetches (recent windows).
    const lessons = await safe(
      admin.from("lessons")
        .select("id, tutor_id, student_id, group_id, subject, starts_at, status, source")
        .order("starts_at", { ascending: false })
        .limit(WINDOW_LESSONS),
      [] as any[],
    );
    const details = await safe(
      admin.from("lesson_details")
        .select("lesson_id, student_price, student_paid_at")
        .order("created_at", { ascending: false })
        .limit(DETAIL_LIMIT),
      [] as any[],
    );
    const participants = await safe(
      admin.from("lesson_participants")
        .select("lesson_id, student_id, student_price, student_paid_at")
        .order("created_at", { ascending: false })
        .limit(DETAIL_LIMIT),
      [] as any[],
    );
    const groups = await safe(
      admin.from("lesson_groups").select("id, name, subject, tutor_id").limit(DETAIL_LIMIT),
      [] as any[],
    );
    const enrollments = await safe(
      admin.from("group_enrollments")
        .select("group_id, student_id, price_per_lesson, status")
        .eq("status", "active")
        .limit(DETAIL_LIMIT),
      [] as any[],
    );
    const profiles = await safe(
      admin.from("profiles").select("id, first_name, last_name, created_at").limit(DETAIL_LIMIT),
      [] as any[],
    );

    // 5. Helpers / maps.
    const nameOf = new Map<string, string>();
    for (const p of profiles) {
      nameOf.set(p.id, `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "—");
    }
    const detailByLesson = new Map<string, any>();
    for (const d of details) detailByLesson.set(d.lesson_id, d);
    const partsByLesson = new Map<string, any[]>();
    for (const pt of participants) {
      const arr = partsByLesson.get(pt.lesson_id) ?? [];
      arr.push(pt);
      partsByLesson.set(pt.lesson_id, arr);
    }

    // 6. Lessons list (recent window).
    const lessonRows = lessons.map((l: any) => {
      const isGroup = !!l.group_id;
      let price: number | null = null;
      let people: string[] = [];
      if (isGroup) {
        const parts = partsByLesson.get(l.id) ?? [];
        const sum = parts.reduce((s, p) => s + (Number(p.student_price) || 0), 0);
        price = parts.length ? sum : null;
        people = parts.map((p) => nameOf.get(p.student_id) ?? "—");
      } else {
        const d = detailByLesson.get(l.id);
        price = d?.student_price != null ? Number(d.student_price) : null;
        people = l.student_id ? [nameOf.get(l.student_id) ?? "—"] : [];
      }
      return {
        id: l.id,
        date: l.starts_at,
        subject: l.subject ?? "—",
        status: l.status ?? "—",
        source: l.source ?? "—",
        type: isGroup ? "group" : "individual",
        price,
        tutor: nameOf.get(l.tutor_id) ?? "—",
        participants: people,
      };
    });

    // 7. Groups list with members.
    const enrollByGroup = new Map<string, any[]>();
    for (const e of enrollments) {
      const arr = enrollByGroup.get(e.group_id) ?? [];
      arr.push(e);
      enrollByGroup.set(e.group_id, arr);
    }
    const groupRows = groups.map((g: any) => ({
      id: g.id,
      name: g.name ?? "—",
      subject: g.subject ?? "—",
      tutor: nameOf.get(g.tutor_id) ?? "—",
      members: (enrollByGroup.get(g.id) ?? []).map((e) => ({
        name: nameOf.get(e.student_id) ?? "—",
        price: e.price_per_lesson != null ? Number(e.price_per_lesson) : null,
      })),
    }));

    // 8. Pricing summary (individual = lesson_details, group = participants + enrollments).
    const indPrices = details.map((d: any) => Number(d.student_price)).filter((n) => Number.isFinite(n) && n > 0);
    const grpPrices = [
      ...participants.map((p: any) => Number(p.student_price)),
      ...enrollments.map((e: any) => Number(e.price_per_lesson)),
    ].filter((n) => Number.isFinite(n) && n > 0);
    const allPrices = [...indPrices, ...grpPrices];
    const avg = (a: number[]) => (a.length ? Math.round(a.reduce((s, n) => s + n, 0) / a.length) : 0);
    const pricing = {
      count: allPrices.length,
      avg: avg(allPrices),
      min: allPrices.length ? Math.min(...allPrices) : 0,
      max: allPrices.length ? Math.max(...allPrices) : 0,
      avgIndividual: avg(indPrices),
      avgGroup: avg(grpPrices),
    };

    // 9. Activity over the last N days (lessons by starts_at, signups by profile created_at,
    //    payments by paid_at).
    const dayKey = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : null);
    const sinceMs = Date.now() - ACTIVITY_DAYS * 86400000;
    const activityMap = new Map<string, { lessons: number; signups: number; payments: number }>();
    const bump = (k: string | null, field: "lessons" | "signups" | "payments") => {
      if (!k) return;
      const cur = activityMap.get(k) ?? { lessons: 0, signups: 0, payments: 0 };
      cur[field] += 1;
      activityMap.set(k, cur);
    };
    for (const l of lessons) if (l.starts_at && new Date(l.starts_at).getTime() >= sinceMs) bump(dayKey(l.starts_at), "lessons");
    for (const p of profiles) if (p.created_at && new Date(p.created_at).getTime() >= sinceMs) bump(dayKey(p.created_at), "signups");
    for (const d of details) if (d.student_paid_at && new Date(d.student_paid_at).getTime() >= sinceMs) bump(dayKey(d.student_paid_at), "payments");
    for (const pt of participants) if (pt.student_paid_at && new Date(pt.student_paid_at).getTime() >= sinceMs) bump(dayKey(pt.student_paid_at), "payments");
    const activity = [...activityMap.entries()]
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));


    // ── CRM (спека адмін-панелі): воронка, гроші, таблиця ризику ──
    const nowMs = Date.now();
    const day = 86400000;
    const [wsR, rolesR, profR, contR, lessAllR, ldR, payR, errR, refR, streakR, ratesR] = await Promise.all([
      admin.from("tutor_workspace_settings").select("user_id, created_at, onboarding_completed, onboarding_step, independent_workspace, subscription_status, subscription_until, trial_until, current_plan"),
      admin.from("user_roles").select("user_id, role"),
      admin.from("profiles").select("id, first_name, last_name"),
      admin.from("profile_contacts").select("user_id, email, telegram"),
      admin.from("lessons").select("id, tutor_id, starts_at, status").gte("starts_at", new Date(nowMs - 45 * day).toISOString()),
      admin.from("lesson_details").select("lesson_id, student_price, student_payment_status"),
      admin.from("liqpay_payments").select("tutor_id, amount, status, created_at, period_end"),
      admin.from("error_log").select("user_id, created_at").gte("created_at", new Date(nowMs - 7 * day).toISOString()),
      admin.from("referrals").select("referrer_id, upgraded_to_pro_at"),
      admin.from("tutor_streaks").select("user_id, last_lesson_date"),
      admin.from("student_rates").select("tutor_id, student_id, archived_at"),
    ]);
    const ws = wsR.data ?? [];
    const managerIds = new Set((rolesR.data ?? []).filter((r: any) => r.role === "manager").map((r: any) => r.user_id));
    const tutorIds = new Set((rolesR.data ?? []).filter((r: any) => r.role === "tutor").map((r: any) => r.user_id));
    const crmNameOf = new Map((profR.data ?? []).map((p: any) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(" ")]));
    const contactOf = new Map((contR.data ?? []).map((c: any) => [c.user_id, { email: c.email, telegram: c.telegram }]));
    const lessonsAll = lessAllR.data ?? [];
    const tutorOfLesson = new Map(lessonsAll.map((l: any) => [l.id, l.tutor_id]));
    const debtByTutor = new Map<string, number>();
    for (const d of ldR.data ?? []) {
      if (d.student_payment_status !== "unpaid") continue;
      const t = tutorOfLesson.get(d.lesson_id); if (!t) continue;
      debtByTutor.set(t, (debtByTutor.get(t) ?? 0) + Number(d.student_price ?? 0));
    }
    const paidPays = (payR.data ?? []).filter((p: any) => p.status === "paid");
    const ltvByTutor = new Map<string, number>();
    const lastPeriodEnd = new Map<string, string>();
    const firstPaidAt = new Map<string, number>();
    for (const p of paidPays) {
      ltvByTutor.set(p.tutor_id, (ltvByTutor.get(p.tutor_id) ?? 0) + Number(p.amount ?? 0));
      const tms = new Date(p.created_at).getTime();
      if (!firstPaidAt.has(p.tutor_id) || tms < (firstPaidAt.get(p.tutor_id) as number)) firstPaidAt.set(p.tutor_id, tms);
      if (p.period_end && (!lastPeriodEnd.has(p.tutor_id) || p.period_end > (lastPeriodEnd.get(p.tutor_id) as string))) lastPeriodEnd.set(p.tutor_id, p.period_end);
    }
    const err7 = new Map<string, number>();
    for (const e of errR.data ?? []) if (e.user_id) err7.set(e.user_id, (err7.get(e.user_id) ?? 0) + 1);
    const refBy = new Map<string, { total: number; paying: number }>();
    for (const r of refR.data ?? []) {
      const b = refBy.get(r.referrer_id) ?? { total: 0, paying: 0 };
      b.total++; if (r.upgraded_to_pro_at) b.paying++;
      refBy.set(r.referrer_id, b);
    }
    const streakOf = new Map((streakR.data ?? []).map((x: any) => [x.user_id, x.last_lesson_date]));
    const activeStudents = new Map<string, Set<string>>();
    for (const r of ratesR.data ?? []) {
      if (r.archived_at) continue;
      if (!activeStudents.has(r.tutor_id)) activeStudents.set(r.tutor_id, new Set());
      (activeStudents.get(r.tutor_id) as Set<string>).add(r.student_id);
    }
    const completedByTutor = new Map<string, { d7: number; d30: number; last: number | null; total: number }>();
    for (const l of lessonsAll) {
      if (l.status !== "completed") continue;
      const b = completedByTutor.get(l.tutor_id) ?? { d7: 0, d30: 0, last: null, total: 0 };
      const tms = new Date(l.starts_at).getTime();
      b.total++;
      if (nowMs - tms <= 7 * day) b.d7++;
      if (nowMs - tms <= 30 * day) b.d30++;
      if (!b.last || tms > b.last) b.last = tms;
      completedByTutor.set(l.tutor_id, b);
    }
    const PLAN_USD: Record<string, number> = { pro_monthly: 7, pro_halfyear: 6.3, pro_yearly: 5.95 };
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    let mrr = 0, activeN = 0, trialN = 0, newPaid = 0, churned = 0;
    const rows: Record<string, unknown>[] = [];
    for (const w of ws) {
      if (!tutorIds.has(w.user_id) && !managerIds.has(w.user_id)) continue;
      const comp = completedByTutor.get(w.user_id) ?? { d7: 0, d30: 0, last: null, total: 0 };
      const streak = streakOf.get(w.user_id);
      const lastLesson = streak ? new Date(streak as string).getTime() : comp.last;
      const daysSince = lastLesson ? Math.floor((nowMs - lastLesson) / day) : null;
      const activated = comp.total >= 1;
      const trialLeft = w.trial_until ? Math.ceil((new Date(w.trial_until).getTime() - nowMs) / day) : null;
      let stage: string;
      if (w.subscription_status === "past_due") stage = "payment_problem";
      else if (w.subscription_status === "active") stage = "paying";
      else if (ltvByTutor.has(w.user_id)) stage = "churned";
      else if (trialLeft !== null && trialLeft > 0) stage = trialLeft <= 5 ? "trial_ending" : "trial";
      else if (!w.onboarding_completed) stage = (nowMs - new Date(w.created_at).getTime() > 3 * day) ? "stuck_onboarding" : "new";
      else stage = activated ? "activated" : "new";
      if (w.subscription_status === "active") { activeN++; mrr += PLAN_USD[w.current_plan ?? "pro_monthly"] ?? 7; }
      if (trialLeft !== null && trialLeft > 0) trialN++;
      const fp = firstPaidAt.get(w.user_id);
      if (fp && fp >= monthStart.getTime()) newPaid++;
      if (stage === "churned") churned++;
      let risk: "red" | "orange" | "green" = "green";
      if ((trialLeft !== null && trialLeft >= 0 && trialLeft <= 3 && activated) ||
          w.subscription_status === "past_due" ||
          (activated && w.subscription_status === "active" && daysSince !== null && daysSince >= 14)) risk = "red";
      else if (stage === "stuck_onboarding" || (err7.get(w.user_id) ?? 0) > 0 ||
               (trialLeft !== null && trialLeft >= 0 && trialLeft <= 3 && !activated) ||
               (debtByTutor.get(w.user_id) ?? 0) > 0) risk = "orange";
      rows.push({
        user_id: w.user_id,
        name: crmNameOf.get(w.user_id) ?? "—",
        contact: contactOf.get(w.user_id) ?? null,
        type: managerIds.has(w.user_id) ? "manager" : w.independent_workspace ? "independent" : "hub",
        stage, onboarding_step: w.onboarding_step ?? null,
        days_since_lesson: daysSince,
        lessons_7d: comp.d7, lessons_30d: comp.d30,
        active_students: activeStudents.get(w.user_id)?.size ?? 0,
        students_debt: debtByTutor.get(w.user_id) ?? 0,
        paid_us: ltvByTutor.get(w.user_id) ?? 0,
        next_charge: lastPeriodEnd.get(w.user_id) ?? w.subscription_until ?? null,
        errors_7d: err7.get(w.user_id) ?? 0,
        referred: refBy.get(w.user_id) ?? { total: 0, paying: 0 },
        trial_left_days: trialLeft, risk,
        created_at: w.created_at,
      });
    }
    const riskOrder: Record<string, number> = { red: 0, orange: 1, green: 2 };
    rows.sort((a: any, b: any) => riskOrder[a.risk] - riskOrder[b.risk] || (b.paid_us - a.paid_us));
    const weekKey = (iso: string) => {
      const d = new Date(iso); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); d.setHours(0, 0, 0, 0);
      return d.toISOString().slice(0, 10);
    };
    const cohorts = new Map<string, { signed: number; onboarded: number; l1: number; l5: number; paying: number }>();
    for (const w of ws) {
      if (!tutorIds.has(w.user_id) && !managerIds.has(w.user_id)) continue;
      const k = weekKey(w.created_at);
      const c = cohorts.get(k) ?? { signed: 0, onboarded: 0, l1: 0, l5: 0, paying: 0 };
      c.signed++;
      if (w.onboarding_completed) c.onboarded++;
      const tot = completedByTutor.get(w.user_id)?.total ?? 0;
      if (tot >= 1) c.l1++;
      if (tot >= 5) c.l5++;
      if (w.subscription_status === "active") c.paying++;
      cohorts.set(k, c);
    }
    const funnel = [...cohorts.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 8)
      .map(([week, c]) => ({ week, ...c }));
    const crm = {
      funnel,
      money: { active: activeN, trial: trialN, new_paid_month: newPaid, churned_month: churned, mrr_usd: Math.round(mrr * 100) / 100 },
      tutors: rows,
    };

    return json({
      crm,
      totals: {
        lessonsTotal,
        lessonsScheduled: scheduled,
        lessonsCompleted: completed,
        lessonsCancelled: cancelled,
        groups: groupsCount,
        tutors: tutorsCount,
        students: studentsCount,
      },
      pricing,
      activity,
      lessons: lessonRows,
      groups: groupRows,
      generatedAt: new Date().toISOString(),
      windowed: { lessons: WINDOW_LESSONS, activityDays: ACTIVITY_DAYS },
    }, 200);
  } catch (e) {
    console.error("admin-stats error", e);
    return json({ error: "Internal error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
