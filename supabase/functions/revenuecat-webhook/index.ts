// RevenueCat → Supabase міст для IAP-підписок (iOS StoreKit).
// RevenueCat шле подію після кожної зміни статусу; ми відображаємо її в
// tutor_workspace_settings.subscription_status — те саме джерело істини, що й
// LiqPay-вебхук, тож клієнтський isPro нічого не знає про спосіб оплати.
//
// app_user_id у подіях == Supabase user.id (ми передаємо його при configure()).
// Авторизація: заголовок Authorization має дорівнювати REVENUECAT_WEBHOOK_SECRET.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  try {
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const secret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET');
    if (!serviceKey || !supabaseUrl || !secret) {
      return new Response(JSON.stringify({ error: 'Missing env' }), { status: 500 });
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    if (authHeader !== `Bearer ${secret}`) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    const payload = await req.json();
    const event = payload?.event ?? {};
    const type: string = event.type ?? '';
    const appUserId: string | undefined = event.app_user_id;
    if (!appUserId) {
      return new Response(JSON.stringify({ error: 'No app_user_id' }), { status: 400 });
    }

    // Маппінг подій RevenueCat → наш статус.
    const ACTIVE = ['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE'];
    const ENDED = ['EXPIRATION'];
    // CANCELLATION/PAUSED = лише вимкнене автопоновлення: доступ ДІЄ до кінця
    // сплаченого періоду; фіксуємо subscription_until, статус не чіпаємо —
    // добовий expire_lapsed_subscriptions зніме Pro рівно в expiration_at_ms.
    const KEEP_ACCESS = ['CANCELLATION', 'SUBSCRIPTION_PAUSED'];
    const PAST_DUE = ['BILLING_ISSUE'];

    let status: string | null = null;
    if (ACTIVE.includes(type)) status = 'active';
    else if (PAST_DUE.includes(type)) status = 'past_due';
    else if (ENDED.includes(type)) status = 'cancelled';
    else if (KEEP_ACCESS.includes(type)) status = 'keep';

    // Події без зміни статусу (TEST, TRANSFER тощо) — підтверджуємо й виходимо.
    if (!status) {
      return new Response(JSON.stringify({ ok: true, ignored: type }), { status: 200 });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    // tutor_workspace_settings is keyed by tutor_id (== the tutor's auth user id ==
    // RevenueCat app_user_id). There is NO user_id column, so the old .eq('user_id')
    // filter matched zero rows and silently failed to revoke — keeping users Pro after
    // a cancellation/expiration. Mirror the LiqPay callback, which uses tutor_id.
    const update: Record<string, unknown> =
      status === 'keep' ? {} : { subscription_status: status };
    if (status === 'keep') {
      const expMs: unknown = event.expiration_at_ms;
      if (typeof expMs === 'number' && expMs > 0) {
        update.subscription_until = new Date(expMs).toISOString();
      } else {
        // Немає дати кінця — нема чого фіксувати; підтверджуємо і виходимо.
        return new Response(JSON.stringify({ ok: true, noted: type }), { status: 200 });
      }
    }
    if (status === 'active') {
      // CRITICAL: persist an expiry so the daily expire_lapsed_subscriptions cron is a
      // real safety net for IAP too. Without subscription_until, an 'active' row is
      // treated as open-ended Pro and can NEVER be downgraded if a later
      // cancellation/expiration webhook is missed → permanent unrevocable Pro.
      const expMs: unknown = event.expiration_at_ms;
      if (typeof expMs === 'number' && expMs > 0) {
        update.subscription_until = new Date(expMs).toISOString();
      } else {
        console.warn('RC active event without expiration_at_ms', { appUserId, type });
      }
      const plan: unknown = event.product_id
        ?? (Array.isArray(event.entitlement_ids) ? event.entitlement_ids[0] : undefined);
      if (typeof plan === 'string' && plan) update.current_plan = plan;
    }

    const { error, count } = await admin
      .from('tutor_workspace_settings')
      .update(update, { count: 'exact' })
      .eq('tutor_id', appUserId);

    if (error) {
      console.error('RC webhook update failed', error, { appUserId, type });
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
    if (count === 0) {
      // No workspace row for this app_user_id — surfaces a config drift between
      // RevenueCat's app_user_id and the tutor's auth id instead of failing silently.
      console.warn('RC webhook matched no tutor', { appUserId, type, status });
    }

    // Reward the referrer if this tutor was referred (one-time), mirroring the LiqPay
    // callback — otherwise native IAP purchases never trigger the referral Pro bonus.
    if (status === 'active') {
      try {
        await admin.rpc('mark_referral_pro_upgrade', { _tutor_id: appUserId });
      } catch (refErr) {
        console.error('mark_referral_pro_upgrade failed:', refErr);
      }
    }

    return new Response(JSON.stringify({ ok: true, status, updated: count ?? 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('revenuecat-webhook error', e);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
  }
});
