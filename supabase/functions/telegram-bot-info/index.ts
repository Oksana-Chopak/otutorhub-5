// Returns Telegram bot username (so frontend can deep-link to t.me/<username>?start=<code>)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

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
