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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

// Very small in-memory rate limiter (best-effort, per-isolate). Keyed by IP+email
// so a single caller can't hammer the endpoint to probe many addresses.
const RL_MAX = 5
const RL_WINDOW_MS = 60_000
const rlHits = new Map<string, number[]>()
function rateLimited(key: string): boolean {
  const now = Date.now()
  const arr = (rlHits.get(key) ?? []).filter((t) => now - t < RL_WINDOW_MS)
  arr.push(now)
  rlHits.set(key, arr)
  // opportunistic cleanup to bound memory
  if (rlHits.size > 5000) {
    for (const [k, v] of rlHits) {
      if (v.every((t) => now - t >= RL_WINDOW_MS)) rlHits.delete(k)
    }
  }
  return arr.length > RL_MAX
}

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

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('cf-connecting-ip') ||
      'unknown'
    if (rateLimited(`${ip}:${normalized}`)) {
      console.error('confirm-pending-signup rate-limited', { ip })
      return ok(false)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceKey)

    // 1. Must match a pending ghost profile
    const { data: isPending } = await admin.rpc('is_pending_email', {
      _email: normalized,
    })
    if (isPending !== true) {
      console.error('confirm-pending-signup: not pending', { email: normalized })
      return ok(false)
    }

    // 2. Find the auth user by email.
    // Prefer a direct lookup; fall back to paginating listUsers so this keeps
    // working past 200 users (the old perPage:200 silently missed users beyond
    // the first page).
    let authUser:
      | { id: string; email?: string; email_confirmed_at?: string | null }
      | null = null

    const adminApi = admin.auth.admin as unknown as {
      getUserByEmail?: (
        e: string,
      ) => Promise<{ data: { user: typeof authUser } | null; error: unknown }>
      listUsers: (args: { page: number; perPage: number }) => Promise<{
        data: { users: NonNullable<typeof authUser>[] } | null
        error: unknown
      }>
    }

    if (typeof adminApi.getUserByEmail === 'function') {
      const { data, error } = await adminApi.getUserByEmail(normalized)
      if (error) {
        console.error('getUserByEmail failed', error)
        return ok(false)
      }
      authUser = data?.user ?? null
    } else {
      const perPage = 200
      for (let page = 1; page <= 50 && !authUser; page++) {
        const { data, error } = await adminApi.listUsers({ page, perPage })
        if (error) {
          console.error('listUsers failed', error)
          return ok(false)
        }
        const users = data?.users ?? []
        authUser =
          users.find(
            (u) => (u.email ?? '').toLowerCase() === normalized,
          ) ?? null
        if (users.length < perPage) break // last page reached
      }
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
