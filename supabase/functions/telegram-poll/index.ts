// Polls Telegram getUpdates and links app users via /start <code>
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';
const MAX_RUNTIME_MS = 55_000;
const MIN_REMAINING_MS = 5_000;

Deno.serve(async () => {
  const startTime = Date.now();
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  const TELEGRAM_API_KEY = Deno.env.get('TELEGRAM_API_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY || !supabaseUrl || !supabaseServiceKey) {
    return new Response(JSON.stringify({ error: 'Missing env' }), { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: state, error: stateErr } = await supabase
    .from('telegram_bot_state')
    .select('update_offset')
    .eq('id', 1)
    .single();

  if (stateErr) return new Response(JSON.stringify({ error: stateErr.message }), { status: 500 });

  let currentOffset = state.update_offset as number;
  let processed = 0;

  while (true) {
    const elapsed = Date.now() - startTime;
    const remainingMs = MAX_RUNTIME_MS - elapsed;
    if (remainingMs < MIN_REMAINING_MS) break;
    const timeout = Math.min(50, Math.floor(remainingMs / 1000) - 5);
    if (timeout < 1) break;

    const resp = await fetch(`${GATEWAY_URL}/getUpdates`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'X-Connection-Api-Key': TELEGRAM_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ offset: currentOffset, timeout, allowed_updates: ['message'] }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: data }), { status: 502 });
    }
    const updates = data.result ?? [];
    if (updates.length === 0) continue;

    for (const u of updates) {
      const msg = u.message;
      if (!msg) continue;
      const text: string = msg.text ?? '';
      const chatId: number = msg.chat.id;
      const fromName = msg.from?.first_name ?? 'друже';

      const startMatch = text.match(/^\/start(?:\s+(\S+))?/);
      if (startMatch) {
        const code = startMatch[1];
        if (!code) {
          await sendTg(chatId, `Привіт, ${fromName}! 👋\n\nЩоб отримувати сповіщення з oTutorHub, відкрийте розділ <b>Налаштування → Telegram</b> в апці й натисніть "Підключити Telegram". Скопіюйте отриманий код і надішліть мені:\n\n<code>/start ВАШ_КОД</code>`, LOVABLE_API_KEY, TELEGRAM_API_KEY);
        } else {
          const codeUp = code.trim().toUpperCase();
          const { data: link } = await supabase
            .from('user_telegram_links')
            .select('user_id, link_code_expires_at')
            .eq('link_code', codeUp)
            .maybeSingle();

          if (!link) {
            await sendTg(chatId, '❌ Код не знайдено. Згенеруйте новий у застосунку.', LOVABLE_API_KEY, TELEGRAM_API_KEY);
          } else if (link.link_code_expires_at && new Date(link.link_code_expires_at) < new Date()) {
            await sendTg(chatId, '⌛ Код прострочений. Згенеруйте новий у застосунку.', LOVABLE_API_KEY, TELEGRAM_API_KEY);
          } else {
            await supabase
              .from('user_telegram_links')
              .update({
                chat_id: chatId,
                linked_at: new Date().toISOString(),
                link_code: null,
                link_code_expires_at: null,
              })
              .eq('user_id', link.user_id);
            await sendTg(chatId, '✅ Готово! Я надсилатиму вам сповіщення про нові повідомлення в чатах oTutorHub.', LOVABLE_API_KEY, TELEGRAM_API_KEY);
          }
        }
      } else if (text === '/stop' || text === '/unlink') {
        await supabase.from('user_telegram_links').delete().eq('chat_id', chatId);
        await sendTg(chatId, 'Сповіщення вимкнено. Щоб увімкнути знову — згенеруйте новий код у застосунку.', LOVABLE_API_KEY, TELEGRAM_API_KEY);
      }

      processed++;
    }

    const newOffset = Math.max(...updates.map((u: any) => u.update_id)) + 1;
    await supabase
      .from('telegram_bot_state')
      .update({ update_offset: newOffset, updated_at: new Date().toISOString() })
      .eq('id', 1);
    currentOffset = newOffset;
  }

  return new Response(JSON.stringify({ ok: true, processed, finalOffset: currentOffset }));
});

async function sendTg(chatId: number, text: string, lovableKey: string, tgKey: string) {
  await fetch(`${GATEWAY_URL}/sendMessage`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      'X-Connection-Api-Key': tgKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
}
