// Scheduled proactive notifications for oTutorHub
// Invoke via pg_cron (see migration comment for cron schedule setup).
// POST body: { "window": "morning" | "evening" }
//   morning (07:00 UTC ≈ 09:00 Kyiv): trial expiry, onboarding nudge, monthly recap
//   evening (16:00 UTC ≈ 19:00 Kyiv): streak at risk, inactivity check
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const UK_MONTHS = [
  "Січень","Лютий","Березень","Квітень","Травень","Червень",
  "Липень","Серпень","Вересень","Жовтень","Листопад","Грудень",
];

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Missing env" }), { status: 500 });
  }

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const window = (body as { window?: string }).window ?? "morning";
  const results: string[] = [];

  // ── Deduplication helper ────────────────────────────────────────────────
  async function upsertNotif(userId: string, type: string, title: string, body_: string, link: string) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await db
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("type", type)
      .gte("created_at", since)
      .maybeSingle();
    if (existing) return;
    await db.from("notifications").insert({ user_id: userId, type, title, body: body_, link });
  }

  if (window === "morning") {
    // ── 1. Trial ending in 3 days ─────────────────────────────────────────
    const { data: trialRows } = await db
      .from("workspace_settings")
      .select("tutor_id, trial_until")
      .eq("subscription_status", "trial")
      .gte("trial_until", new Date().toISOString())
      .lte("trial_until", new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString());

    for (const row of trialRows ?? []) {
      await upsertNotif(
        row.tutor_id,
        "trial_ending",
        "⏰ Тріал закінчується через 3 дні",
        "Перейди на Pro щоб не втратити доступ до всіх функцій",
        "/subscription",
      );
    }
    results.push(`trial_ending: ${(trialRows ?? []).length}`);

    // ── 2. Onboarding incomplete after 3 days ────────────────────────────
    const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data: onboardingRows } = await db
      .from("workspace_settings")
      .select("tutor_id")
      .eq("onboarding_completed", false)
      .lt("created_at", cutoff);

    for (const row of onboardingRows ?? []) {
      await upsertNotif(
        row.tutor_id,
        "onboarding_incomplete",
        "👋 Ти ще не завершив налаштування",
        "Залишилось кілька кроків — це займе 5 хвилин",
        "/onboarding",
      );
    }
    results.push(`onboarding_incomplete: ${(onboardingRows ?? []).length}`);

    // ── 3. Monthly recap (1st of month) ─────────────────────────────────
    const today = new Date();
    if (today.getDate() === 1) {
      const prevMonth = today.getMonth() === 0 ? 11 : today.getMonth() - 1;
      const prevYear  = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
      const monthStart = new Date(prevYear, prevMonth, 1).toISOString();
      const monthEnd   = new Date(prevYear, prevMonth + 1, 0, 23, 59, 59).toISOString();
      const monthName  = UK_MONTHS[prevMonth];

      // Get all tutors
      const { data: tutorRoles } = await db
        .from("user_roles")
        .select("user_id")
        .eq("role", "tutor");

      for (const { user_id } of tutorRoles ?? []) {
        const { data: lessons } = await db
          .from("lessons")
          .select("id, student_price, student_payment_status")
          .eq("tutor_id", user_id)
          .eq("status", "completed")
          .gte("starts_at", monthStart)
          .lte("starts_at", monthEnd);

        const count = (lessons ?? []).length;
        if (count === 0) continue;

        const income = (lessons ?? [])
          .filter((l: any) => l.student_payment_status === "paid")
          .reduce((sum: number, l: any) => sum + Number(l.student_price ?? 0), 0);

        await upsertNotif(
          user_id,
          "monthly_recap",
          `📊 Твій ${monthName}: ${count} уроків`,
          `Зароблено: ${income.toFixed(0)} грн. Подивись детальну аналітику`,
          "/finances",
        );
      }
      results.push(`monthly_recap sent`);
    }
  }

  if (window === "evening") {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // ── 4. Streak at risk (tutors with streak > 2, no lesson today) ──────
    const { data: streakRows } = await db
      .from("tutor_streaks")
      .select("tutor_id, current_streak")
      .gt("current_streak", 2);

    for (const row of streakRows ?? []) {
      const { count } = await db
        .from("lessons")
        .select("id", { count: "exact", head: true })
        .eq("tutor_id", row.tutor_id)
        .eq("status", "completed")
        .gte("starts_at", todayStart.toISOString());

      if ((count ?? 0) === 0) {
        await upsertNotif(
          row.tutor_id,
          "streak_at_risk",
          "🔥 Збережи серію сьогодні!",
          `У тебе ${row.current_streak} днів поспіль — не переривай!`,
          "/schedule",
        );
      }
    }
    results.push(`streak_at_risk: ${(streakRows ?? []).length}`);

    // ── 5. 7 days without activity ───────────────────────────────────────
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: tutorRoles } = await db
      .from("user_roles")
      .select("user_id")
      .eq("role", "tutor");

    for (const { user_id } of tutorRoles ?? []) {
      const { count } = await db
        .from("lessons")
        .select("id", { count: "exact", head: true })
        .eq("tutor_id", user_id)
        .gte("starts_at", sevenDaysAgo);

      if ((count ?? 0) === 0) {
        await upsertNotif(
          user_id,
          "inactive",
          "Давно не бачились 👋",
          "Як справи? Заплануй урок щоб не загубити учнів",
          "/schedule",
        );
      }
    }
    results.push(`inactive checked for ${(tutorRoles ?? []).length} tutors`);
  }

  return new Response(JSON.stringify({ ok: true, window, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
