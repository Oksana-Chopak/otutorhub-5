// Manager "повне видалення" користувача — на відміну від manager_purge_user
// (DB-функція, що зачищає дані, але НЕ може видалити з auth.users), ця
// Edge-функція з service role ще й знімає логін через Admin API, тож пошта
// вивільняється. Модель — за delete-account.
//
// Порядок: (1) перевірити, що викликач — менеджер; (2) захист (не себе,
// не іншого менеджера); (3) виконати наявну зачистку даних
// (manager_purge_user, від імені менеджера — він пише manager_audit_log);
// (4) admin.auth.admin.deleteUser(targetId); (5) дописати в аудит.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json({ error: 'Missing env' }, 500);
    }

    const { targetId } = await req.json().catch(() => ({}));
    if (!targetId || typeof targetId !== 'string') {
      return json({ error: 'targetId is required' }, 400);
    }

    // 1. Identify the caller — ONLY from their own JWT.
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // 2. Caller must be a manager.
    const { data: callerRoles } = await admin
      .from('user_roles').select('role').eq('user_id', user.id);
    if (!(callerRoles ?? []).some((r: { role: string }) => r.role === 'manager')) {
      return json({ error: 'Only managers can delete users' }, 403);
    }

    // 3. Guards: never yourself, never another manager.
    if (targetId === user.id) {
      return json({ error: 'Cannot delete your own account' }, 400);
    }
    const { data: targetRoles } = await admin
      .from('user_roles').select('role').eq('user_id', targetId);
    if ((targetRoles ?? []).some((r: { role: string }) => r.role === 'manager')) {
      return json({ error: 'Cannot delete another manager' }, 403);
    }

    // 4. Run the existing data purge AS the manager so manager_purge_user's
    //    own auth.uid()=manager / not-self checks + audit write all apply.
    const { error: purgeErr } = await userClient.rpc('manager_purge_user', { _user_id: targetId });
    if (purgeErr) {
      console.error('manager_purge_user failed', purgeErr);
      return json({ error: purgeErr.message }, 500);
    }

    // 5. Delete the auth login (frees the email). Profile/roles already gone.
    const { error: delErr } = await admin.auth.admin.deleteUser(targetId);
    if (delErr) {
      console.error('deleteUser failed', delErr);
      // Data was purged but the login remains — surface so the manager can retry.
      return json({ error: `Data purged, but auth deletion failed: ${delErr.message}`, partial: true }, 500);
    }

    // 6. Audit the auth removal (manager_purge_user already logged 'profile.purged').
    try {
      await admin.from('manager_audit_log').insert({
        actor_id: user.id,
        action: 'auth.user_deleted',
        entity_type: 'auth_user',
        entity_id: targetId,
      });
    } catch (_) { /* non-blocking */ }

    return json({ ok: true });
  } catch (e) {
    console.error('manager-delete-user error', e);
    return json({ error: 'Internal error' }, 500);
  }
});
