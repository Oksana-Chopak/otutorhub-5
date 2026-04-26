import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PLANS = {
  monthly: { amount: 129, description: "TutorHub Pro — місячна підписка" },
  yearly: { amount: 1188, description: "TutorHub Pro — річна підписка (99 грн/міс)" },
} as const;

type Plan = keyof typeof PLANS;

async function sha1Base64(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return encodeBase64(new Uint8Array(buf));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub;

    const body = await req.json().catch(() => ({}));
    const plan = body.plan as Plan;
    const recurring = body.recurring !== false; // default true

    if (!plan || !(plan in PLANS)) {
      return new Response(JSON.stringify({ error: "Invalid plan" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const publicKey = Deno.env.get("LIQPAY_PUBLIC_KEY");
    const privateKey = Deno.env.get("LIQPAY_PRIVATE_KEY");
    if (!publicKey || !privateKey) {
      return new Response(JSON.stringify({ error: "LiqPay not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const planConfig = PLANS[plan];
    const orderId = `tutorhub_${userId}_${Date.now()}`;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serverUrl = `${supabaseUrl}/functions/v1/liqpay-callback`;

    // Логую pending платіж через service role
    const adminClient = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { error: insertErr } = await adminClient.from("liqpay_payments").insert({
      tutor_id: userId,
      order_id: orderId,
      plan,
      amount: planConfig.amount,
      currency: "UAH",
      status: "pending",
      is_recurring: recurring,
      liqpay_action: recurring ? "subscribe" : "pay",
    });

    if (insertErr) {
      console.error("Insert payment error:", insertErr);
      return new Response(JSON.stringify({ error: "Failed to create payment" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Параметри для LiqPay Checkout
    const params: Record<string, unknown> = {
      version: "3",
      public_key: publicKey,
      action: recurring ? "subscribe" : "pay",
      amount: planConfig.amount,
      currency: "UAH",
      description: planConfig.description,
      order_id: orderId,
      language: "uk",
      server_url: serverUrl,
      result_url: body.result_url ?? undefined,
    };

    if (recurring) {
      params.subscribe = "1";
      params.subscribe_date_start = "now";
      params.subscribe_periodicity = plan === "yearly" ? "year" : "month";
    }

    // прибираємо undefined
    Object.keys(params).forEach((k) => params[k] === undefined && delete params[k]);

    const dataB64 = encodeBase64(new TextEncoder().encode(JSON.stringify(params)));
    const signature = await sha1Base64(privateKey + dataB64 + privateKey);

    return new Response(
      JSON.stringify({ data: dataB64, signature, order_id: orderId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("liqpay-create-payment error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
