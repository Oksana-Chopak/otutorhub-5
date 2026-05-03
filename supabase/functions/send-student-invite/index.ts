// Edge function: send-student-invite
// Triggered by tutor or manager after creating a ghost student profile.
// Validates permissions, fetches data, and invokes send-transactional-email.

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

const RATE_LIMIT_HOURS = 24

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Authenticate caller via their JWT
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

  let studentId: string
  try {
    const body = await req.json()
    studentId = body.studentId || body.student_id
    if (!studentId || typeof studentId !== 'string') {
      return json({ error: 'studentId is required' }, 400)
    }
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  // Service role for safe lookups
  const admin = createClient(supabaseUrl, supabaseServiceKey)

  // 1. Verify the student exists and is a pending ghost
  const { data: student, error: studentErr } = await admin
    .from('profiles')
    .select('id, first_name, last_name, is_pending')
    .eq('id', studentId)
    .maybeSingle()

  if (studentErr || !student) {
    return json({ error: 'Student not found' }, 404)
  }

  if (!student.is_pending) {
    return json({ error: 'Student is already registered', code: 'already_registered' }, 409)
  }

  // 2. Verify caller has permission (manager OR tutor with student_rates link)
  const { data: isManagerData } = await admin.rpc('check_user_role', {
    _user_id: user.id,
    _role: 'manager',
  })
  const isManager = isManagerData === true

  let isLinkedTutor = false
  let subjects: string[] = []
  if (!isManager) {
    const { data: rates } = await admin
      .from('student_rates')
      .select('subject')
      .eq('tutor_id', user.id)
      .eq('student_id', studentId)
    if (rates && rates.length > 0) {
      isLinkedTutor = true
      subjects = Array.from(new Set(rates.map((r: any) => r.subject).filter(Boolean)))
    }
  } else {
    // For manager, gather subjects from any tutor's rates
    const { data: rates } = await admin
      .from('student_rates')
      .select('subject')
      .eq('student_id', studentId)
    subjects = Array.from(
      new Set((rates ?? []).map((r: any) => r.subject).filter(Boolean))
    )
  }

  if (!isManager && !isLinkedTutor) {
    return json({ error: 'Not authorized to invite this student' }, 403)
  }

  // 3. Get student's email from contacts
  const { data: contact } = await admin
    .from('profile_contacts')
    .select('email')
    .eq('user_id', studentId)
    .maybeSingle()

  const email = contact?.email?.trim()
  if (!email) {
    return json({ error: 'Student has no email on file', code: 'no_email' }, 400)
  }

  // 4. Rate limit: don't resend within last 24h
  const since = new Date(Date.now() - RATE_LIMIT_HOURS * 3600 * 1000).toISOString()
  const { data: recentLogs } = await admin
    .from('email_send_log')
    .select('id, created_at, status')
    .eq('recipient_email', email.toLowerCase())
    .eq('template_name', 'student-invite')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)

  if (recentLogs && recentLogs.length > 0 && recentLogs[0].status !== 'failed') {
    return json({
      success: false,
      reason: 'rate_limited',
      message: `Already sent within last ${RATE_LIMIT_HOURS}h`,
    }, 200)
  }

  // 5. Inviter name
  const { data: inviter } = await admin
    .from('profiles')
    .select('first_name, last_name')
    .eq('id', user.id)
    .maybeSingle()
  const inviterName = inviter
    ? [inviter.first_name, inviter.last_name].filter(Boolean).join(' ').trim() || undefined
    : undefined
  const studentName =
    [student.first_name, student.last_name].filter(Boolean).join(' ').trim() || undefined

  // 6. Build invite URL — use server-side constant to prevent phishing via
  // attacker-controlled Origin header.
  const APP_BASE_URL = Deno.env.get('APP_BASE_URL') ?? 'https://otutorhub.com'
  const inviteUrl = `${APP_BASE_URL}/auth?signup=1&email=${encodeURIComponent(email)}&role=student`

  // 7. Invoke send-transactional-email forwarding the caller's JWT
  // (send-transactional-email has verify_jwt=true and requires a valid user JWT,
  // not the service-role key)
  const sendRes = await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify({
      templateName: 'student-invite',
      recipientEmail: email,
      idempotencyKey: `student-invite:${studentId}:${new Date().toISOString().slice(0, 10)}`,
      templateData: {
        studentName,
        inviterName,
        subjects,
        inviteUrl,
        appName: 'oTutorHub',
      },
    }),
  })

  const sendBody = await sendRes.json().catch(() => ({}))
  if (!sendRes.ok) {
    console.error('send-transactional-email failed', sendBody)
    return json({ error: 'Failed to send invite', detail: sendBody }, 502)
  }

  return json({ success: true, queued: true, email })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
