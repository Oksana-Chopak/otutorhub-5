import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { tutorAiAllowed } from "../_shared/aiGate.ts";
import {
  AI_DAILY_LIMIT, AI_SUMMARY_MODEL, AI_TIMEOUT_MS, buildMessages, explainRejection,
  hasEnoughInput, inputHash, validateAiSummary, type SummaryInput,
} from "../_shared/aiSummaryGuard.ts";

interface RequestBody {
  lessonId: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Verify JWT and identify caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid auth token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const callerId = userData.user.id;

    // 2. Validate input
    let body: RequestBody;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!body.lessonId || typeof body.lessonId !== "string") {
      return new Response(JSON.stringify({ error: "lessonId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Load lesson and verify caller is the tutor
    const { data: lesson, error: lessonErr } = await userClient
      .from("lessons")
      .select("id, tutor_id, student_id, subject, starts_at, duration_minutes, lesson_details(homework, summary, student_notes)")
      .eq("id", body.lessonId)
      .maybeSingle();

    if (lessonErr || !lesson) {
      return new Response(JSON.stringify({ error: "Lesson not found or access denied" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const details = Array.isArray((lesson as any).lesson_details)
      ? (lesson as any).lesson_details[0]
      : (lesson as any).lesson_details;
    const homework: string | null = details?.homework ?? null;
    const summary: string | null = details?.summary ?? null;
    const studentNotes: string | null = details?.student_notes ?? null;

    if (lesson.tutor_id !== callerId) {
      return new Response(JSON.stringify({ error: "Only the lesson tutor can generate AI summary" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3b. Pro gate — AI конспект is free for hub tutors, Pro for independents.
    //     Enforced server-side so the paywall can't be bypassed by calling
    //     this function directly.
    if (!(await tutorAiAllowed(userClient, callerId))) {
      return new Response(
        JSON.stringify({ error: "AI-конспект доступний у Pro-плані." }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. «AI під наглядом» (27.09) — див. _shared/aiSummaryGuard.ts:
    //    замало даних → моделі не кличемо (жодних вигаданих конспектів);
    //    стеля на добу і кеш на 7 днів у базі; таймаут; перевірка відповіді;
    //    кожен виклик — у журнал ai_calls. Результат — ЧЕРНЕТКА для репетитора,
    //    учню нічого не йде, поки репетитор не натисне «Зберегти».
    const lessonDate = new Date(lesson.starts_at).toLocaleDateString("uk-UA", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const input: SummaryInput = {
      subject: String(lesson.subject ?? ""),
      dateLabel: lessonDate,
      durationMinutes: Number(lesson.duration_minutes ?? 0),
      summary,
      homework,
      studentNotes,
    };
    const hash = inputHash(input);
    const KIND = "lesson_summary";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = serviceKey ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } }) : null;
    const startedAt = Date.now();
    const log = async (status: string, extra: { ms?: number; output?: string | null; error?: string | null } = {}) => {
      if (!admin) return;
      try {
        // RPC з міграції 20260927160000 — до перегенерації types.ts кличемо через (rpc as any)
        await (admin.rpc as any)("ai_call_log", {
          _tutor: callerId, _lesson: body.lessonId, _kind: KIND, _input_hash: hash, _status: status,
          _ms: extra.ms ?? Date.now() - startedAt, _model: AI_SUMMARY_MODEL,
          _output: extra.output ?? null, _error: extra.error ?? null,
        });
      } catch (e) {
        console.error("ai_call_log failed:", (e as any)?.message ?? e);
      }
    };
    const fail = (status: number, message: string, code: string) =>
      new Response(JSON.stringify({ error: message, code }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    if (!hasEnoughInput(input)) {
      await log("too_little");
      return fail(422, "Замало даних для конспекту: напишіть кілька речень у чернетці або домашнє завдання — AI не вигадує зміст уроку.", "too_little");
    }

    // 4b. Стеля й кеш — у базі. Якщо база недоступна (SQL ще не вставлено),
    //     працюємо без стелі, але кажемо про це в error_log — не мовчки.
    let gateAllowed = true;
    let callsToday = 0;
    if (admin) {
      try {
        const { data: gate, error: gateErr } = await (admin.rpc as any)("ai_call_gate", {
          _tutor: callerId, _kind: KIND, _input_hash: hash, _max_per_day: AI_DAILY_LIMIT,
        });
        if (gateErr) throw gateErr;
        const cached = gate?.cached;
        if (typeof cached === "string" && cached.trim()) {
          await log("cached", { output: null });
          return new Response(JSON.stringify({ summary: cached, cached: true, ai: true }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        gateAllowed = gate?.allowed !== false;
        callsToday = Number(gate?.calls_today ?? 0);
      } catch (e) {
        const msg = String((e as any)?.message ?? e);
        console.error("ai_call_gate unavailable:", msg);
        try {
          await admin.from("error_log").insert({
            message: "ai_call_gate недоступна — AI-конспект без стелі й кешу",
            url: "edge:generate-lesson-summary",
            context: { error: msg.slice(0, 500) },
          });
        } catch { /* логування не ламає відповідь */ }
      }
    }
    if (!gateAllowed) {
      await log("limited");
      return fail(429, `Ліміт AI-конспектів на сьогодні вичерпано (${callsToday} із ${AI_DAILY_LIMIT}). Завтра лічильник оновиться.`, "limited");
    }

    // 5. Call Lovable AI Gateway — з таймаутом, щоб екран не чекав вічно.
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) {
      await log("error", { error: "LOVABLE_API_KEY missing" });
      return fail(500, "AI service not configured", "not_configured");
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
    let aiRes: Response;
    try {
      aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: AI_SUMMARY_MODEL,
          messages: buildMessages(input),
        }),
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const aborted = (e as any)?.name === "AbortError";
      await log("error", { error: aborted ? "timeout" : String((e as any)?.message ?? e) });
      return fail(
        aborted ? 504 : 502,
        aborted ? "Модель не відповіла за 25 секунд. Спробуйте ще раз за хвилину." : "AI service error",
        aborted ? "timeout" : "gateway",
      );
    }
    clearTimeout(timer);

    if (aiRes.status === 429) {
      await log("error", { error: "gateway 429" });
      return fail(429, "Перевищено ліміт запитів. Спробуйте за хвилину.", "gateway_rate_limited");
    }
    if (aiRes.status === 402) {
      await log("error", { error: "gateway 402" });
      return fail(402, "Недостатньо AI-кредитів. Поповніть баланс у Lovable Cloud.", "gateway_credits");
    }
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      console.error("AI Gateway error:", aiRes.status, txt);
      await log("error", { error: `gateway ${aiRes.status}: ${txt.slice(0, 300)}` });
      return fail(502, "AI service error", "gateway");
    }

    const aiData = await aiRes.json();
    const generated: string = aiData?.choices?.[0]?.message?.content ?? "";

    // 6. Перевірка відповіді — причина відмови йде репетитору словами.
    const verdict = validateAiSummary(generated, input);
    if (!verdict.ok) {
      await log("rejected", { error: verdict.reason, output: generated.slice(0, 2000) || null });
      return fail(502, explainRejection(verdict.reason), `rejected_${verdict.reason}`);
    }

    await log("ok", { output: verdict.summary });
    return new Response(JSON.stringify({ summary: verdict.summary, ai: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("generate-lesson-summary unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
