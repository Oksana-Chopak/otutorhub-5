// Edge function: notify-lesson-rules
// Client-invoked by the lesson's tutor right after a lesson is created.
// Delivers the tutor's cancellation/reschedule rules to the student via
// Telegram and/or email, depending on the tutor's workspace notify settings.
// tutor -> own-student delivery: no hub margin or other tutors' data involved.

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')

    // 1. Authenticate caller via their JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: 'Missing authorization' }, 401)
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) {
      return json({ error: 'Invalid auth token' }, 401)
    }

    let lessonId: string
    try {
      const body = await req.json()
      lessonId = body.lessonId || body.lesson_id
      if (!lessonId || typeof lessonId !== 'string') {
        return json({ error: 'lessonId is required' }, 400)
      }
    } catch {
      return json({ error: 'Invalid JSON body' }, 400)
    }

    // Service role for privileged reads
    const admin = createClient(supabaseUrl, supabaseServiceKey)

    // 2. Load the lesson and verify the caller is its tutor.
    const { data: lesson, error: lessonErr } = await admin
      .from('lessons')
      .select('id, tutor_id, student_id, subject, starts_at')
      .eq('id', lessonId)
      .maybeSingle()

    if (lessonErr || !lesson) {
      return json({ error: 'Lesson not found' }, 404)
    }

    if (lesson.tutor_id !== user.id) {
      return json({ error: 'Not authorized for this lesson' }, 403)
    }

    if (!lesson.student_id) {
      // Group lessons have no single student to notify.
      return json({ ok: true, skipped: 'no_student' })
    }

    const studentId = lesson.student_id as string

    // 3. Load the tutor's workspace settings (notify flags + cancel rules).
    const { data: ws } = await admin
      .from('tutor_workspace_settings')
      .select(
        'notify_telegram, notify_email, cancel_free_hours, cancel_fee_percent, noshow_charge, free_reschedules_per_month'
      )
      .eq('tutor_id', lesson.tutor_id)
      .maybeSingle()

    if (!ws || (!ws.notify_telegram && !ws.notify_email)) {
      return json({ ok: true, skipped: 'notify_off' })
    }

    const freeHours = Number(ws.cancel_free_hours ?? 24)
    const feePercent = Number(ws.cancel_fee_percent ?? 50)
    const noshow = Number(ws.noshow_charge ?? 100)
    const reschedules = Number(ws.free_reschedules_per_month ?? 0)

    // 4. Build the Ukrainian rules text (plain) + an HTML-escaped variant for Telegram.
    const rulesPlain =
      `📋 Правила скасування та перенесення\n` +
      `Безкоштовне скасування — не пізніше ніж за ${freeHours} год до уроку. ` +
      `Пізніше — ${feePercent}% вартості. ` +
      `Неявка — ${noshow}%. ` +
      `Безкоштовних перенесень на місяць: ${reschedules}.`

    const rulesHtml =
      `<b>📋 Правила скасування та перенесення</b>\n` +
      `Безкоштовне скасування — не пізніше ніж за <b>${escapeHtml(String(freeHours))}</b> год до уроку. ` +
      `Пізніше — <b>${escapeHtml(String(feePercent))}%</b> вартості. ` +
      `Неявка — <b>${escapeHtml(String(noshow))}%</b>. ` +
      `Безкоштовних перенесень на місяць: <b>${escapeHtml(String(reschedules))}</b>.`

    // Names for the email template.
    const { data: studentProfile } = await admin
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', studentId)
      .maybeSingle()
    const studentName =
      [studentProfile?.first_name, studentProfile?.last_name]
        .filter(Boolean)
        .join(' ')
        .trim() || undefined

    const { data: tutorProfile } = await admin
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', lesson.tutor_id)
      .maybeSingle()
    const tutorName =
      [tutorProfile?.first_name, tutorProfile?.last_name]
        .filter(Boolean)
        .join(' ')
        .trim() || undefined

    const channels: string[] = []

    // 5. Telegram channel.
    if (ws.notify_telegram && TELEGRAM_BOT_TOKEN) {
      const { data: link } = await admin
        .from('user_telegram_links')
        .select('chat_id')
        .eq('user_id', studentId)
        .not('chat_id', 'is', null)
        .maybeSingle()

      if (link?.chat_id) {
        const tg = await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: link.chat_id,
              text: rulesHtml,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
            }),
          }
        )
        if (tg.ok) {
          channels.push('telegram')
        } else {
          const data = await tg.json().catch(() => ({}))
          console.error('telegram failed', tg.status, data)
        }
      }
    }

    // 6. Email channel.
    if (ws.notify_email) {
      const { data: contact } = await admin
        .from('profile_contacts')
        .select('email')
        .eq('user_id', studentId)
        .maybeSingle()

      const email = contact?.email?.trim()
      if (email) {
        const sendRes = await fetch(
          `${supabaseUrl}/functions/v1/send-transactional-email`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${supabaseServiceKey}`,
              apikey: supabaseServiceKey,
            },
            body: JSON.stringify({
              templateName: 'cancellation-rules',
              recipientEmail: email,
              idempotencyKey: `cancellation-rules:${lessonId}`,
              templateData: {
                studentName,
                tutorName,
                subject: lesson.subject,
                rulesText: rulesPlain,
                appName: 'oTutorHub',
              },
            }),
          }
        )
        if (sendRes.ok) {
          channels.push('email')
        } else {
          const sendBody = await sendRes.json().catch(() => ({}))
          console.error('send-transactional-email failed', sendBody)
        }
      }
    }

    return json({ ok: true, channels })
  } catch (err) {
    console.error('notify-lesson-rules error', err)
    return json({ error: 'internal' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
