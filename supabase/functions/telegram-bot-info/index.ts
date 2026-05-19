// Returns Telegram bot username (so frontend can deep-link to t.me/<username>?start=<code>)
// Requires an authenticated Supabase user — prevents anonymous abuse / Telegram
// API rate-limit exhaustion via unbounded outbound `getMe` calls.

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Require authenticated user (verify JWT in code; do not trust unverified claims).
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!jwt) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const supabase = createClient(supabaseUrl, anonKey);
  const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(jwt);
  if (claimsErr || !claimsData?.claims?.sub) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!token) {
    return new Response(JSON.stringify({ configured: false, username: null, name: null, error: 'telegram_not_configured' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await r.json();

    if (!r.ok || !data.ok) {
      return new Response(JSON.stringify({
        configured: false,
        username: null,
        name: null,
        error: 'telegram_lookup_failed',
        status: r.status,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({ configured: true, username: data.result?.username ?? null, name: data.result?.first_name ?? null }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('telegram-bot-info failed:', error);

    return new Response(JSON.stringify({ configured: false, username: null, name: null, error: 'telegram_request_failed' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
