// Triggered after chat_messages INSERT (via DB trigger) to push Telegram notification
// to the recipient. Uses service role key for auth instead of webhook secret.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  try {
    const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!TELEGRAM_BOT_TOKEN || !supabaseUrl || !serviceKey) {
      console.error('Missing env: TELEGRAM_BOT_TOKEN, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY');
      return new Response(JSON.stringify({ error: 'Missing env' }), { status: 500 });
    }

    // Auth: only accept calls with the service role key (set by DB trigger)
    const authHeader = req.headers.get('Authorization') ?? '';
    if (authHeader !== `Bearer ${serviceKey}`) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    const body = await req.json();
    const { message_id } = body ?? {};
    if (!message_id) {
      return new Response(JSON.stringify({ error: 'message_id required' }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Fetch message
    const { data: msg, error: msgErr } = await supabase
      .from('chat_messages')
      .select('id, body, sender_id, thread_id, created_at')
      .eq('id', message_id)
      .maybeSingle();
    if (msgErr || !msg) {
      return new Response(JSON.stringify({ error: 'Message not found' }), { status: 404 });
    }

    // Fetch thread to find recipient
    const { data: thread } = await supabase
      .from('chat_threads')
      .select('tutor_id, student_id')
      .eq('id', msg.thread_id)
      .maybeSingle();
    if (!thread) return new Response(JSON.stringify({ ok: true, skipped: 'no thread' }));

    const recipientId = msg.sender_id === thread.tutor_id ? thread.student_id : thread.tutor_id;
    if (!recipientId) return new Response(JSON.stringify({ ok: true, skipped: 'no recipient' }));

    // Check if recipient has Telegram linked
    const { data: link } = await supabase
      .from('user_telegram_links')
      .select('chat_id')
      .eq('user_id', recipientId)
      .not('chat_id', 'is', null)
      .maybeSingle();
    if (!link?.chat_id) {
      return new Response(JSON.stringify({ ok: true, skipped: 'no telegram link for recipient' }));
    }

    // Fetch sender name
    const { data: senderProfile } = await supabase
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', msg.sender_id)
      .maybeSingle();
    const senderName = [senderProfile?.first_name, senderProfile?.last_name]
      .filter(Boolean).join(' ') || 'Хтось';

    // Build Telegram message
    const preview = (msg.body ?? '').length > 300
      ? (msg.body ?? '').slice(0, 300) + '…'
      : (msg.body ?? '📎 вкладення');

    const text = [
      `💬 <b>${escapeHtml(senderName)}</b>`,
      '',
      escapeHtml(preview),
      '',
      `<a href="https://otutorhub.com/chats">Відкрити чат →</a>`,
    ].join('\n');

    const tgResp = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: link.chat_id,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      }
    );

    const tgData = await tgResp.json();
    if (!tgResp.ok) {
      console.error('Telegram sendMessage failed', tgResp.status, JSON.stringify(tgData));
      return new Response(JSON.stringify({ error: tgData }), { status: 502 });
    }

    return new Response(JSON.stringify({ ok: true, sent_to: recipientId }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    console.error('notify-chat-message error:', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
