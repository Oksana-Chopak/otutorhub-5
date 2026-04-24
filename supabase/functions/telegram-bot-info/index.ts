// Returns Telegram bot username (so frontend can deep-link to t.me/<username>?start=<code>)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const lov = Deno.env.get('LOVABLE_API_KEY');
  const tg = Deno.env.get('TELEGRAM_API_KEY');
  if (!lov || !tg) {
    return new Response(JSON.stringify({ configured: false, username: null, name: null, error: 'telegram_not_configured' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const r = await fetch(`${GATEWAY_URL}/getMe`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${lov}`,
        'X-Connection-Api-Key': tg,
        'Content-Type': 'application/json',
      },
    });
    const data = await r.json();

    if (!r.ok) {
      const isMissingCredential = r.status === 401 && data?.error?.message === 'Credential not found';

      return new Response(JSON.stringify({
        configured: false,
        username: null,
        name: null,
        error: isMissingCredential ? 'telegram_credential_missing' : 'telegram_lookup_failed',
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
