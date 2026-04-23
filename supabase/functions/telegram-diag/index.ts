// Diag function — checks gateway access from edge runtime
Deno.serve(async () => {
  const lov = Deno.env.get('LOVABLE_API_KEY');
  const tg = Deno.env.get('TELEGRAM_API_KEY');
  const out: any = { has_lovable: !!lov, has_telegram: !!tg, lovable_len: lov?.length, telegram_len: tg?.length };
  if (lov && tg) {
    const r = await fetch('https://connector-gateway.lovable.dev/telegram/getMe', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lov}`,
        'X-Connection-Api-Key': tg,
        'Content-Type': 'application/json',
      },
    });
    out.status = r.status;
    out.body = await r.text();
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { 'Content-Type': 'application/json' } });
});
