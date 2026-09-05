import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Ціни закріплені в ГРИВНІ (рішення власниці 02.09): 299 / 1614 / 2988 грн.
// Мають збігатися з src/lib/pricing.ts — це та сама сітка, яку бачить користувач.
const PLANS = {
  monthly:  { uah: 299,  months: 1,  description: "oTutorHub Pro — 1 місяць (299 грн)" },
  // Light (05.09): план-рятівник із потоку скасування — пів ціни, ядро без AI.
  light:    { uah: 149,  months: 1,  description: "oTutorHub Light — 1 місяць (149 грн)" },
  halfyear: { uah: 1614, months: 6,  description: "oTutorHub Pro — 6 місяців (1614 грн, −10%)" },
  yearly:   { uah: 2988, months: 12, description: "oTutorHub Pro — 12 місяців (2988 грн, −17%)" },
} as const;

/* 02.09: курс НБУ прибрано. Ціна зафіксована в гривні — ст. 189 ГКУ: ціна є
   істотною умовою договору і для субʼєкта господарювання визначається в гривнях.
   Раніше сума списання = $7 × курс дня оплати, тобто плавала від дня до дня, а
   курсового застереження в оферті немає — тоді як міняти ціну після укладення
   можна лише на умовах, прописаних у договорі (ч. 2 ст. 632 ЦКУ). Тепер те, що
   написано на сторінці тарифів, дорівнює тому, що списується з картки. */

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

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

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

    // Validate result_url against an allowlist to prevent open redirect
    const ALLOWED_RESULT_ORIGINS = new Set([
      "https://otutorhub.com",
      "https://www.otutorhub.com",
      "https://otutorhub.lovable.app",
      "https://id-preview--0aa51a41-1c1e-499c-b511-ba5e0d425456.lovable.app",
      "https://0aa51a41-1c1e-499c-b511-ba5e0d425456.lovableproject.com",
      "https://id-preview--0aa51a41-1c1e-499c-b511-ba5e0d425456.lovableproject.com",
    ]);
    let safeResultUrl: string | undefined;
    if (body.result_url) {
      try {
        const u = new URL(String(body.result_url));
        if (ALLOWED_RESULT_ORIGINS.has(u.origin)) {
          safeResultUrl = u.toString();
        }
      } catch {
        // ignore invalid URL
      }
      if (!safeResultUrl) {
        return new Response(JSON.stringify({ error: "Invalid result_url" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const planConfig = PLANS[plan];
    /* Ціна фіксована в гривні (ст. 189 ГКУ). Конвертації за курсом на момент
       списання більше немає: вона означала, що клієнт щоразу платить іншу
       суму, ніж бачив на сторінці тарифів. */
    const amountUah = planConfig.uah;
    // LiqPay рекурент підтримує лише month/year — піврічний план завжди разовий.
    const rec = recurring && plan !== "halfyear";
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
      amount: amountUah,
      currency: "UAH",
      status: "pending",
      is_recurring: rec,
      liqpay_action: rec ? "subscribe" : "pay",
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
      action: rec ? "subscribe" : "pay",
      amount: amountUah,
      currency: "UAH",
      description: planConfig.description,
      order_id: orderId,
      language: "uk",
      server_url: serverUrl,
      result_url: safeResultUrl,
    };

    if (rec) {
      params.subscribe = "1";
      params.subscribe_date_start = "now";
      params.subscribe_periodicity = plan === "yearly" ? "year" : "month";
    }

    // прибираємо undefined
    Object.keys(params).forEach((k) => params[k] === undefined && delete params[k]);

    const dataB64 = encodeBase64(new TextEncoder().encode(JSON.stringify(params)));
    const signature = await sha1Base64(privateKey + dataB64 + privateKey);

    return new Response(
      /* `amount` повертаємо окремо, щоб клієнт міг звірити суму з
         src/lib/pricing.ts і не відкривати LiqPay, якщо ця функція
         задеплоєна старою версією (перевірка 02.09: саме так на сторінці
         оплати опинилась ціна за старим тарифом). */
      JSON.stringify({ data: dataB64, signature, order_id: orderId, amount: amountUah }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("liqpay-create-payment error:", e);
    return new Response(
      JSON.stringify({ error: "Payment creation failed. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
