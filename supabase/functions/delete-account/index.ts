// Self-service видалення акаунта (вимога App Store 5.1.1(v) та Google Play).
// Викликається залогіненим користувачем; видаляє ЙОГО auth-користувача через
// service role. Персональні таблиці (profiles, profile_contacts, user_roles,
// push-токени тощо) мають ON DELETE CASCADE на auth.users, тож підуть разом.
// Бізнес-записи іншої сторони (уроки, оплати) лишаються — це транзакційна
// історія контрагента, сторами дозволено.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return new Response(JSON.stringify({ error: 'Missing env' }), { status: 500, headers: corsHeaders });
    }

    // 1. Ідентифікуємо того, хто просить — лише за його власним JWT.
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // 2. Best-effort зачистка таблиць без FK-каскаду на auth.users.
    //    Помилки тут не блокують видалення (таблиці може не бути).
    const uid = user.id;
    const cleanup: Array<{ table: string; col: string }> = [
      { table: 'tutor_student_notes', col: 'tutor_id' },
      { table: 'lesson_tutor_notes', col: 'tutor_id' },
      { table: 'notifications', col: 'user_id' },
    ];
    for (const c of cleanup) {
      try { await admin.from(c.table).delete().eq(c.col, uid); } catch (_) { /* ignore */ }
    }

    // 3. Видаляємо auth-користувача — каскад зносить профіль/контакти/ролі.
    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) {
      console.error('deleteUser failed', delErr);
      return new Response(JSON.stringify({ error: delErr.message }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('delete-account error', e);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500, headers: corsHeaders });
  }
});
