// Edge function: confirm-pending-signup
// For students/tutors invited via a ghost profile (is_pending=true), this
// auto-confirms their email after sign-up so they can log in immediately
// without needing to click the verification link (which often expires or gets
// invalidated by repeated sign-up attempts).
//
// Public function (verify_jwt=false). Anyone can call it, but it only acts
// when (a) the email matches an existing pending profile AND (b) the auth
// user exists and is unconfirmed. No data is returned beyond ok/false.

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { email } = await req.json().catch(() => ({}))
    if (!email || typeof email !== 'string') {
      return json({ ok: false, reason: 'missing_email' }, 400)
    }
    const normalized = email.trim().toLowerCase()

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceKey)

    // 1. Must match a pending ghost profile
    const { data: isPending } = await admin.rpc('is_pending_email', {
      _email: normalized,
    })
    if (isPending !== true) {
      return json({ ok: false, reason: 'not_pending' })
    }

    // 2. Find the auth user by email
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    })
    if (listErr) {
      console.error('listUsers failed', listErr)
      return json({ ok: false, reason: 'lookup_failed' }, 500)
    }
    const user = list.users.find(
      (u) => (u.email ?? '').toLowerCase() === normalized,
    )
    if (!user) {
      return json({ ok: false, reason: 'no_auth_user' })
    }
    if (user.email_confirmed_at) {
      return json({ ok: true, already_confirmed: true })
    }

    // 3. Force-confirm
    const { error: updErr } = await admin.auth.admin.updateUserById(user.id, {
      email_confirm: true,
    })
    if (updErr) {
      console.error('updateUserById failed', updErr)
      return json({ ok: false, reason: 'confirm_failed' }, 500)
    }

    return json({ ok: true, confirmed: true })
  } catch (err) {
    console.error('confirm-pending-signup error', err)
    return json({ ok: false, reason: 'internal' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
