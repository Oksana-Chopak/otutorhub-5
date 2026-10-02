// Надсилає нагадування про оплату (Telegram + пошта + дзвіночок) — одразу, на дотик.
//
// Два режими:
//   { lessonId }  — один урок (як було з початку; звідси кличуть «Фінанси»);
//   { studentId, tutorId? } — ВСЯ пара «репетитор+учень» одним повідомленням
//     (важіль 2 аудиту шляхів 24.09: «нагадати — там, де видно борг, і на
//     ЛЮДИНУ, а не на урок»). Борг людини живе на кількох уроках, а розмова
//     з нею — одна; надсилати три повідомлення про три уроки означає навчити
//     її їх не читати. Ядро `sendPaymentReminder` уміло приймати список
//     уроків від початку — тепер цей режим доступний і з кнопки.
// tutorId має право передати лише менеджер школи цього репетитора; репетитор
// нагадує тільки про своїх учнів (tutorId = він сам).
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendPaymentReminder } from "../_shared/paymentReminder.ts";
import { versionProbe } from "../_shared/build.ts";
import { withErrorLog } from "../_shared/errorLog.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}




Deno.serve(withErrorLog("remind-payment", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const probe = versionProbe(req, "remind-payment");
  if (probe) return probe;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing authorization" }, 401);

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: "Invalid auth token" }, 401);

  let lessonId: string | null = null;
  let studentId: string | null = null;
  let tutorIdArg: string | null = null;
  try {
    const body = await req.json();
    lessonId = body.lessonId || body.lesson_id || null;
    studentId = body.studentId || body.student_id || null;
    tutorIdArg = body.tutorId || body.tutor_id || null;
    if (!lessonId && !studentId) return json({ error: "lessonId or studentId required" }, 400);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const admin = createClient(supabaseUrl, supabaseServiceKey);

  // Хто питає: менеджер школи? (та сама перевірка, що й у режимі одного уроку)
  const { data: isManagerData } = await admin.rpc("check_user_role", { _user_id: user.id, _role: "manager" });
  const callerIsManager = isManagerData === true;

  // ── РЕЖИМ ПАРИ: одне нагадування про ВЕСЬ борг людини ──────────────────────
  if (studentId) {
    const tutorId = tutorIdArg ?? user.id;
    if (tutorId !== user.id) {
      // За чужого репетитора нагадує лише менеджер ЙОГО школи.
      if (!callerIsManager) return json({ error: "Not found" }, 404);
      const { data: scoped } = await admin.rpc("is_manager_of_tutor", { _manager: user.id, _tutor: tutorId });
      if (scoped !== true) return json({ error: "Not found" }, 404);
    }
    let q = admin
      .from("lessons")
      .select("id, subject, starts_at, status, source, lesson_details!inner(student_price, student_payment_status, is_cancellation_fee)")
      .eq("tutor_id", tutorId)
      .eq("student_id", studentId)
      .in("status", ["completed", "cancelled"])
      .limit(500);
    // Уроки незалежного репетитора — не поле школи (модель «школа = сутність»).
    if (tutorId !== user.id) q = q.neq("source", "independent");
    const { data: rows, error: rowsErr } = await q;
    if (rowsErr) return json({ error: "read_failed" }, 500);
    // Дзеркало isStudentDebtLesson (src/lib/financials.ts, рішення 04.09):
    // борг = ПРОВЕДЕНЕ й неоплачене; скасоване — лише зі штрафом.
    const debts = ((rows ?? []) as any[])
      .map((l) => ({
        id: l.id as string, subject: l.subject as string | null, starts_at: l.starts_at as string,
        student_price: l.lesson_details?.student_price ?? null,
        status: l.status as string,
        paid: l.lesson_details?.student_payment_status === "paid",
        fee: l.lesson_details?.is_cancellation_fee === true,
      }))
      .filter((l) => !l.paid && Number(l.student_price ?? 0) > 0 && (l.status === "completed" || (l.status === "cancelled" && l.fee)))
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    if (debts.length === 0) return json({ success: false, reason: "no_debt" }, 200);

    const pairResult = await sendPaymentReminder({
      admin, supabaseUrl, serviceKey: supabaseServiceKey, botToken: TELEGRAM_BOT_TOKEN,
      tutorId, studentId, kind: "manual",
      dedupKind: "manual", dedupHours: 1,
      lessons: debts.map((l) => ({ id: l.id, subject: l.subject, starts_at: l.starts_at, student_price: l.student_price })),
    });
    if (pairResult.sent === 0 && pairResult.skipped > 0) {
      return json({ success: false, reason: "already_reminded_today", lastSentAt: pairResult.lastSentAt ?? null }, 200);
    }
    if (pairResult.channels.length === 0) return json({ success: false, reason: "no_channels" }, 200);
    return json({
      success: true, channels: pairResult.channels, lessons: pairResult.sent,
      total: debts.reduce((sum, l) => sum + Number(l.student_price ?? 0), 0),
    });
  }

  const { data: lessonRow } = await admin
    .from("lessons")
    .select(
      "id, tutor_id, student_id, subject, starts_at, source, lesson_details!inner(student_price, student_payment_status)",
    )
    .eq("id", lessonId)
    .maybeSingle();

  // П1.4 (вердикт 31.08): авторизація ПЕРЕД будь-якою відповіддю про урок.
  // Раніше 404/409 летіли ДО перевірки прав — функція з service role давала
  // будь-кому перебирати id і читати статус оплати чужих уроків. Тепер
  // «не існує» і «не твій» — та сама відповідь: нема чого перебирати.
  // Менеджерський арм скоуплено: уроки незалежних — не поле школи; з 07.09
  // (модель «школа = сутність») — лише менеджер ШКОЛИ репетитора уроку
  // (is_manager_of_tutor: суперадмін або hub_managers × settings.hub_id).
  const isManager = callerIsManager;
  let managesTutor = false;
  if (isManager && lessonRow) {
    const { data: scoped } = await admin.rpc("is_manager_of_tutor", {
      _manager: user.id,
      _tutor: (lessonRow as any).tutor_id,
    });
    managesTutor = scoped === true;
  }
  const authorized = !!lessonRow && (
    (lessonRow as any).tutor_id === user.id ||
    (managesTutor && (lessonRow as any).source !== "independent")
  );
  if (!authorized) return json({ error: "Lesson not found" }, 404);

  const lesson: any = {
    ...lessonRow,
    student_price: (lessonRow as any).lesson_details?.student_price,
    student_payment_status: (lessonRow as any).lesson_details?.student_payment_status,
  };
  if (lesson.student_payment_status === "paid") {
    return json({ error: "already_paid" }, 409);
  }

  // Усе нижче — спільне ядро (_shared/paymentReminder.ts): канали, мова
  // одержувача, лог і 24-годинна дедуплікація за lesson_payment_reminders.
  // 13.09: ручний дотик «Нагадати» — це явний намір репетитора, тож він не
  // блокується автоматичним нагадуванням крона за ту саму добу (так кнопка
  // «нічого не робила» з червоною помилкою). Захист лишається лише від
  // подвійного дотику: одне ручне нагадування на урок за годину.
  const result = await sendPaymentReminder({
    admin, supabaseUrl, serviceKey: supabaseServiceKey, botToken: TELEGRAM_BOT_TOKEN,
    tutorId: lesson.tutor_id, studentId: lesson.student_id, kind: "manual",
    dedupKind: "manual", dedupHours: 1,
    lessons: [{ id: lesson.id, subject: lesson.subject, starts_at: lesson.starts_at, student_price: lesson.student_price }],
  });
  if (result.skipped > 0 && result.sent === 0) {
    return json({ success: false, reason: "already_reminded_today", lastSentAt: result.lastSentAt ?? null }, 200);
  }
  const channels = result.channels;
  const email = channels.includes("email") ? "sent" : null;

  // inapp завжди є у channels, тож «жодного каналу» тепер неможливе; лишаємо
  // гілку на випадок майбутніх змін ядра.
  if (channels.length === 0) {
    return json({ success: false, reason: "no_channels", hasEmail: !!email }, 200);
  }
  return json({ success: true, channels, telegram: channels.includes("telegram"), email: channels.includes("email") });
}));
