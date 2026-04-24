// Triggered after a chat_messages insert (via pg_net) to push a Telegram notification
// to the recipient if they have linked their Telegram account.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  try {
    const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const webhookSecret = Deno.env.get('NOTIFY_CHAT_WEBHOOK_SECRET');
    if (!TELEGRAM_BOT_TOKEN || !supabaseUrl || !serviceKey || !webhookSecret) {
      return new Response(JSON.stringify({ error: 'Missing env' }), { status: 500 });
    }

    // Require shared-secret header — only the database trigger knows this value.
    const provided = req.headers.get('x-webhook-secret');
    if (!provided || provided !== webhookSecret) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    const body = await req.json();
    const { message_id } = body ?? {};
    if (!message_id) return new Response(JSON.stringify({ error: 'message_id required' }), { status: 400 });

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: msg, error: msgErr } = await supabase
      .from('chat_messages')
      .select('id, body, sender_id, thread_id, created_at')
      .eq('id', message_id)
      .maybeSingle();
    if (msgErr || !msg) {
      return new Response(JSON.stringify({ error: 'Message not found' }), { status: 404 });
    }

    const { data: thread } = await supabase
      .from('chat_threads')
      .select('tutor_id, student_id')
      .eq('id', msg.thread_id)
      .maybeSingle();
    if (!thread) return new Response(JSON.stringify({ ok: true, skipped: 'no thread' }));

    const recipientId = msg.sender_id === thread.tutor_id ? thread.student_id : thread.tutor_id;
    if (!recipientId) return new Response(JSON.stringify({ ok: true, skipped: 'no recipient' }));

    const { data: link } = await supabase
      .from('user_telegram_links')
      .select('chat_id')
      .eq('user_id', recipientId)
      .not('chat_id', 'is', null)
      .maybeSingle();
    if (!link?.chat_id) {
      return new Response(JSON.stringify({ ok: true, skipped: 'no telegram link' }));
    }

    const { data: senderProfile } = await supabase
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', msg.sender_id)
      .maybeSingle();

    const senderName = [senderProfile?.first_name, senderProfile?.last_name].filter(Boolean).join(' ') || 'Хтось';
    const preview = (msg.body ?? '').length > 300 ? (msg.body ?? '').slice(0, 300) + '…' : msg.body ?? '';

    const text = `💬 <b>${escapeHtml(senderName)}</b>\n\n${escapeHtml(preview)}\n\n<a href="https://otutorhub.lovable.app/chats">Відкрити чат</a>`;

    const tgResp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: link.chat_id,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    const tgData = await tgResp.json();
    if (!tgResp.ok) {
      console.error('Telegram send failed', tgResp.status, tgData);
      return new Response(JSON.stringify({ error: tgData }), { status: 502 });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
