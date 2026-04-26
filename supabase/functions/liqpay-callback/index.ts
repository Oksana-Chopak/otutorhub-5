import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {
  decodeBase64,
  encodeBase64,
} from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function sha1Base64(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return encodeBase64(new Uint8Array(buf));
}

const SUCCESS_STATUSES = new Set([
  "success",
  "wait_accept",
  "subscribed",
  "sandbox",
]);

function planToInterval(plan: string): { months: number } {
  return plan === "yearly" ? { months: 12 } : { months: 1 };
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // LiqPay шле POST form-data: data + signature
  try {
    const privateKey = Deno.env.get("LIQPAY_PRIVATE_KEY");
    if (!privateKey) {
      return new Response("Server not configured", { status: 500, headers: corsHeaders });
    }

    const form = await req.formData();
    const data = form.get("data")?.toString();
    const signature = form.get("signature")?.toString();

    if (!data || !signature) {
      console.error("Missing data or signature");
      return new Response("Bad request", { status: 400, headers: corsHeaders });
    }

    const expectedSig = await sha1Base64(privateKey + data + privateKey);
    if (expectedSig !== signature) {
      console.error("Invalid signature");
      return new Response("Invalid signature", { status: 403, headers: corsHeaders });
    }

    const decodedJson = new TextDecoder().decode(decodeBase64(data));
    const payload = JSON.parse(decodedJson);
    console.log("LiqPay callback:", JSON.stringify(payload));

    const orderId = payload.order_id as string;
    const status = payload.status as string;
    const cardToken = payload.card_token as string | undefined;
    const liqpayPaymentId = payload.payment_id?.toString();
    const action = payload.action as string;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: paymentRow, error: fetchErr } = await admin
      .from("liqpay_payments")
      .select("*")
      .eq("order_id", orderId)
      .maybeSingle();

    if (fetchErr || !paymentRow) {
      console.error("Payment not found for order:", orderId);
      return new Response("Payment not found", { status: 404, headers: corsHeaders });
    }

    const isSuccess = SUCCESS_STATUSES.has(status);
    const now = new Date();
    const periodEnd = isSuccess
      ? addMonths(now, planToInterval(paymentRow.plan).months)
      : null;

    // Оновлюємо платіж
    await admin
      .from("liqpay_payments")
      .update({
        status,
        liqpay_payment_id: liqpayPaymentId,
        liqpay_action: action,
        card_token: cardToken ?? paymentRow.card_token,
        raw_callback: payload,
        paid_at: isSuccess ? now.toISOString() : paymentRow.paid_at,
        period_start: isSuccess ? now.toISOString() : paymentRow.period_start,
        period_end: periodEnd?.toISOString() ?? paymentRow.period_end,
      })
      .eq("order_id", orderId);

    // Активуємо підписку
    if (isSuccess) {
      const update: Record<string, unknown> = {
        tutor_id: paymentRow.tutor_id,
        subscription_status: "active",
        subscription_until: periodEnd!.toISOString(),
        current_plan: paymentRow.plan,
      };
      if (paymentRow.is_recurring) {
        update.liqpay_recurring_active = true;
        if (cardToken) update.liqpay_card_token = cardToken;
      }
      await admin
        .from("tutor_workspace_settings")
        .upsert(update, { onConflict: "tutor_id" });
    }

    // Обробка скасування підписки
    if (status === "unsubscribed" || action === "unsubscribe") {
      await admin
        .from("tutor_workspace_settings")
        .update({ liqpay_recurring_active: false })
        .eq("tutor_id", paymentRow.tutor_id);
    }

    return new Response("OK", { headers: corsHeaders });
  } catch (e) {
    console.error("liqpay-callback error:", e);
    return new Response(`Error: ${String(e)}`, { status: 500, headers: corsHeaders });
  }
});
