// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { rateLimit, clientIp } from "../_shared/rateLimit.ts";
import { withErrorLog } from "../_shared/errorLog.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Payload {
  name: string;
  email: string;
  phone?: string;
  quiz: {
    subjects: string[];
    level: string | null;
    schedule: string[];
    goal: string | null;
    goal_other?: string | null;
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Ліміти (27.09): у БАЗІ, не в памʼяті ізолята — див. _shared/rateLimit.ts.
//   • 5 анкет за годину з однієї адреси (кожна може створити акаунт і лист);
//   • 2 анкети на добу на одну пошту (чужу скриньку не завалити листами);
//   • 500 анкет на добу на всю платформу (стеля від зловмисного шквалу;
//     при зростанні — підняти тут, це одна цифра).
const PER_IP_HOUR = 5;
const PER_EMAIL_DAY = 2;
const PLATFORM_DAY = 500;

Deno.serve(withErrorLog("landing-find-tutor-quiz", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const name = (body.name ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();
  const phone = (body.phone ?? "").trim() || null;
  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(400, { error: "invalid_input" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const ip = clientIp(req);
  /* 01.10, та сама причина, що в `import-sheet-fetch`: `rate_limit_check`
     записує спробу до вердикту, тож паралельна перевірка дозволяла одній адресі
     зжерти ПЛАТФОРМЕНИЙ ліміт на добу для всіх. Перевіряємо послідовно —
     найдешевший ключ першим, спільний лічильник чіпаємо лише якщо свої пройшли. */
  for (const [scope, key, max, win] of [
    ["landing_quiz_ip", ip, PER_IP_HOUR, 3600],
    ["landing_quiz_email", email, PER_EMAIL_DAY, 86400],
    ["landing_quiz_all", "platform", PLATFORM_DAY, 86400],
  ] as [string, string, number, number][]) {
    if ((await rateLimit(admin, scope, key, max, win)) === "limit") {
      console.error("landing-find-tutor-quiz rate-limited", { ip, scope });
      return json(429, { error: "rate_limited" });
    }
  }

  let userId: string | null = null;

  // Try to create the user; if it already exists, look it up.
  const password = crypto.randomUUID() + crypto.randomUUID();
  const ALLOWED_ORIGINS = new Set([
    "https://otutorhub.com",
    "https://www.otutorhub.com",
    "https://otutorhub.lovable.app",
    "https://id-preview--0aa51a41-1c1e-499c-b511-ba5e0d425456.lovable.app",
  ]);
  const rawOrigin = req.headers.get("origin") ?? undefined;
  const origin = rawOrigin && ALLOWED_ORIGINS.has(rawOrigin) ? rawOrigin : undefined;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    user_metadata: { first_name: name, role: "student" },
  });

  let isNewAccount = false;
  if (createErr) {
    // Пошта вже зареєстрована — шукаємо акаунт у базі, а не через
    // listUsers({perPage: 200}), який після 200-го користувача мовчки «не знаходив».
    const { data: existingId, error: lookupErr } = await (admin.rpc as any)("user_id_by_email", { _email: email });
    if (lookupErr) console.error("[landing-find-tutor-quiz] user_id_by_email failed", lookupErr.message);
    if (typeof existingId === "string" && existingId) userId = existingId;
  } else {
    isNewAccount = true;
    userId = created.user?.id ?? null;
    // Send a magic-link / password reset so the user can sign in (since password is random).
    try {
      await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo: origin },
      });
    } catch (_) {
      // ignore — Supabase will already send the signup confirmation.
    }
  }

  // Телефон у профіль — ЛИШЕ для щойно створеного акаунта. Для вже
  // зареєстрованої пошти анонім із лендінгу міг перезаписати чужий номер без
  // жодного підтвердження (27.09) — тепер його номер лишається тільки в самій
  // заявці (lead_phone), а профіль людини не чіпаємо.
  if (isNewAccount && userId && phone) {
    await admin.from("profile_contacts").upsert(
      { user_id: userId, phone },
      { onConflict: "user_id" },
    );
  }

  // Build a referral request entry.
  const quiz = body.quiz ?? { subjects: [], level: null, schedule: [], goal: null };
  const summary = [
    quiz.subjects?.length ? `Предмети: ${quiz.subjects.join(", ")}` : null,
    quiz.level ? `Рівень: ${quiz.level}` : null,
    quiz.schedule?.length ? `Зручний час: ${quiz.schedule.join(", ")}` : null,
    quiz.goal
      ? `Ціль: ${quiz.goal}${quiz.goal === "other" && quiz.goal_other ? ` — ${quiz.goal_other}` : ""}`
      : null,
    phone ? `Телефон: ${phone}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const { error: insertErr } = await admin.from("tutor_referral_requests").insert({
    student_id: userId,
    subject: quiz.subjects?.[0] ?? null,
    preferred_level: quiz.level,
    message: summary || null,
    source: "landing_quiz",
    lead_name: name,
    lead_email: email,
    lead_phone: phone,
    quiz_data: quiz as any,
    status: "open",
  });

  if (insertErr) {
    console.error("[landing-find-tutor-quiz] insert error", insertErr);
    return json(500, { error: "insert_failed" });
  }

  return json(200, { ok: true });
}));
