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

    const safe = async <T,>(p: PromiseLike<{ data: T; error: unknown }>, fb: T): Promise<T> => {
      try { const { data, error } = await p; return error ? fb : (data ?? fb); } catch { return fb; }
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

    return json({
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
