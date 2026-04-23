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
    return new Response(JSON.stringify({ error: 'no creds' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
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
    return new Response(JSON.stringify({ error: data, status: r.status }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  return new Response(
    JSON.stringify({ username: data.result?.username, name: data.result?.first_name }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
