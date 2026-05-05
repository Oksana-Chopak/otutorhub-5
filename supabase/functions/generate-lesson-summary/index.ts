import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js";

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

    // 4. Build prompt
    const lessonDate = new Date(lesson.starts_at).toLocaleDateString("uk-UA", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    const userPrompt = `Створи структурований конспект уроку у форматі Markdown.

**Предмет:** ${lesson.subject}
**Дата:** ${lessonDate}
**Тривалість:** ${lesson.duration_minutes} хв

${lesson.summary ? `**Чорновий конспект від репетитора:**\n${lesson.summary}\n` : ""}
${lesson.homework ? `**Домашнє завдання:**\n${lesson.homework}\n` : ""}
${lesson.student_notes ? `**Нотатки учня:**\n${lesson.student_notes}\n` : ""}

Структуруй конспект так:
## Тема уроку
## Що пройшли (3-5 ключових пунктів)
## Що потрібно повторити
## Корисні матеріали (за потреби)

Пиши українською, лаконічно, для учня. Якщо вхідних даних замало — створи короткий шаблон конспекту для предмета "${lesson.subject}".`;

    // 5. Call Lovable AI Gateway
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) {
      return new Response(JSON.stringify({ error: "AI service not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "Ти асистент-педагог. Створюєш короткі, чіткі конспекти уроків для учнів українською мовою у форматі Markdown.",
          },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (aiRes.status === 429) {
      return new Response(
        JSON.stringify({ error: "Перевищено ліміт запитів. Спробуйте за хвилину." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (aiRes.status === 402) {
      return new Response(
        JSON.stringify({ error: "Недостатньо AI-кредитів. Поповніть баланс у Lovable Cloud." }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      console.error("AI Gateway error:", aiRes.status, txt);
      return new Response(
        JSON.stringify({ error: "AI service error" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiRes.json();
    const generated = aiData?.choices?.[0]?.message?.content?.trim() ?? "";

    if (!generated) {
      return new Response(JSON.stringify({ error: "Empty AI response" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ summary: generated }), {
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
