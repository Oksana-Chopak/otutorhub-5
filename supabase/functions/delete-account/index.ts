// Self-service видалення акаунта (вимога App Store 5.1.1(v) та Google Play).
// Викликається залогіненим користувачем; ПОВНІСТЮ чистить ЙОГО персональні дані
// через RPC purge_user_data (FK-каскаду на auth.users НЕМА — його давно прибрали,
// тож профіль/контакти/ролі/ставки треба видаляти явно), а тоді зносить auth-юзера.
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

    // 2. FULL personal-data purge. The profiles / profile_contacts / user_roles /
    //    student_rates FK CASCADE on auth.users was DROPPED long ago, so deleting the auth
    //    user alone left every personal row behind — the orphan profile_contacts (unique
    //    email) then blocked re-registration / re-adding that email, and orphan profiles
    //    were the "ghosts". purge_user_data wipes all personal tables for this user.
    const uid = user.id;
    const { error: purgeErr } = await admin.rpc('purge_user_data', { _user_id: uid });
    if (purgeErr) {
      console.error('purge_user_data failed', purgeErr);
      return new Response(JSON.stringify({ error: purgeErr.message }), { status: 500, headers: corsHeaders });
    }

    // 3. Delete the auth user so the email is freed for future re-registration.
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
