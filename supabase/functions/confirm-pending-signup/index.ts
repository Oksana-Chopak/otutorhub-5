// Edge function: confirm-pending-signup
// For students/tutors invited via a ghost profile (is_pending=true), this
// auto-confirms their email after sign-up so they can log in immediately
// without needing to click the verification link (which often expires or gets
// invalidated by repeated sign-up attempts).
//
// Public function (verify_jwt=false). Anyone can call it, but it only acts when
// (a) the email matches an existing pending profile AND (b) the auth user exists
// and is unconfirmed.
//
// SECURITY: the response is intentionally just { ok: true|false } for EVERY
// branch — we must not leak whether an email is registered/pending/unconfirmed
// (email enumeration). Real reasons go only to console.error for our logs.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { rateLimit, clientIp } from '../_shared/rateLimit.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

// Ліміти (27.09) — у базі, не в памʼяті ізолята (_shared/rateLimit.ts):
//   • 5 спроб за хвилину на пару «адреса + пошта» (як і було задумано);
//   • 60 спроб за годину з однієї адреси — щоб з однієї машини не перебирати
//     сотні адрес, з'ясовуючи, кого запрошено.
const PER_IP_EMAIL_MIN = 5
const PER_IP_HOUR = 60

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { email } = await req.json().catch(() => ({}))
    if (!email || typeof email !== 'string') {
      return ok(false)
    }
    const normalized = email.trim().toLowerCase()

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceKey)

    const ip = clientIp(req)
    const verdicts = await Promise.all([
      rateLimit(admin, 'confirm_signup_pair', `${ip}|${normalized}`, PER_IP_EMAIL_MIN, 60),
      rateLimit(admin, 'confirm_signup_ip', ip, PER_IP_HOUR, 3600),
    ])
    if (verdicts.includes('limit')) {
      console.error('confirm-pending-signup rate-limited', { ip })
      return ok(false)
    }

    // 1. Must match a pending ghost profile
    const { data: isPending, error: pendingErr } = await admin.rpc('is_pending_email', {
      _email: normalized,
    })
    // 13.09/23.09: технічний збій бази (наприклад, «permission denied for
    // function is_pending_email» у service_role) — це НЕ «not pending». Раніше
    // помилка ковталась, функція відповідала ok:false, і запрошений учень
    // застрягав на підтвердженні без жодного сліду. Тепер це 500 без деталей
    // про пошту (перебору адрес не додає) — клієнт запише збій в error_log.
    if (pendingErr) {
      console.error('confirm-pending-signup: is_pending_email failed', pendingErr.message)
      return new Response(JSON.stringify({ ok: false, error: 'db' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (isPending !== true) {
      console.error('confirm-pending-signup: not pending', { email: normalized })
      return ok(false)
    }

    // 2. Акаунт за поштою — з бази (user_id_by_email, міграція 20260927150000):
    //    без listUsers по 200 сторінок і без залежності від версії SDK.
    let authUser: { id: string; email?: string; email_confirmed_at?: string | null } | null = null
    const { data: foundId, error: lookupErr } = await (admin.rpc as any)('user_id_by_email', { _email: normalized })
    if (lookupErr) {
      console.error('confirm-pending-signup: user_id_by_email failed', lookupErr.message)
      return new Response(JSON.stringify({ ok: false, error: 'db' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (typeof foundId === 'string' && foundId) {
      const { data: byId, error: byIdErr } = await admin.auth.admin.getUserById(foundId)
      if (byIdErr) {
        console.error('confirm-pending-signup: getUserById failed', byIdErr.message)
        return ok(false)
      }
      authUser = byId?.user ?? null
    }

    if (!authUser) {
      console.error('confirm-pending-signup: no auth user', { email: normalized })
      return ok(false)
    }
    if (authUser.email_confirmed_at) {
      return ok(true) // already confirmed — they can sign in
    }

    // 3. Force-confirm
    const { error: updErr } = await admin.auth.admin.updateUserById(authUser.id, {
      email_confirm: true,
    })
    if (updErr) {
      console.error('updateUserById failed', updErr)
      return ok(false)
    }

    return ok(true)
  } catch (err) {
    console.error('confirm-pending-signup error', err)
    return ok(false)
  }
})

function ok(value: boolean) {
  return new Response(JSON.stringify({ ok: value }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
