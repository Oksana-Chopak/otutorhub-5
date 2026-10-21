// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { rateLimit, clientIp } from "../_shared/rateLimit.ts";
import { withErrorLog } from "../_shared/errorLog.ts";
import { cleanPersonName } from "../_shared/textSafety.ts";

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

  const name = cleanPersonName(body.name, 80) ?? "";
  const email = (body.email ?? "").trim().toLowerCase();
  const phone = (body.phone ?? "").trim().slice(0, 40) || null;
  if (!name || !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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

  // Red team 20.10: анкета БІЛЬШЕ НЕ СТВОРЮЄ акаунтів. Раніше анонім міг завести
  // auth-користувача на БУДЬ-ЯКУ пошту (випадковий пароль, лист не йшов): справжній
  // власник скриньки потім бачив «пошта вже зайнята», а запрошений учень із такою
  // поштою «зливався» у акаунт, яким ніхто не володіє. Заявка живе своїми полями
  // (lead_name / lead_email / lead_phone); якщо пошта вже зареєстрована —
  // привʼязуємо до акаунта за `user_id_by_email`, інакше student_id = NULL.
  let userId: string | null = null;
  const { data: existingId, error: lookupErr } = await (admin.rpc as any)("user_id_by_email", { _email: email });
  if (lookupErr) console.error("[landing-find-tutor-quiz] user_id_by_email failed", lookupErr.message);
  if (typeof existingId === "string" && existingId) userId = existingId;

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
