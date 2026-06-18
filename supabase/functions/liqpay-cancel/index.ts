// Cancel a recurring LiqPay subscription (stop auto-renew). The user keeps Pro
// until subscription_until; only future charges stop. Mirrors the signature
// scheme of liqpay-create-payment. verify_jwt=true.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function sha1Base64(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return encodeBase64(new Uint8Array(buf));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    const publicKey = Deno.env.get("LIQPAY_PUBLIC_KEY");
    const privateKey = Deno.env.get("LIQPAY_PRIVATE_KEY");
    if (!publicKey || !privateKey) return json({ error: "LiqPay not configured" }, 500);

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Find this tutor's active recurring subscription order.
    const { data: sub } = await admin
      .from("liqpay_payments")
      .select("order_id")
      .eq("tutor_id", userId)
      .eq("is_recurring", true)
      .in("status", ["success", "subscribed", "sandbox", "wait_accept"])
      .order("paid_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!sub?.order_id) {
      // Nothing to cancel on LiqPay's side — just clear the local flag.
      await admin
        .from("tutor_workspace_settings")
        .update({ liqpay_recurring_active: false })
        .eq("tutor_id", userId);
      return json({ ok: true, note: "no_active_subscription" });
    }

    const params = {
      version: "3",
      public_key: publicKey,
      action: "unsubscribe",
      order_id: sub.order_id,
    };
    const dataB64 = encodeBase64(new TextEncoder().encode(JSON.stringify(params)));
    const signature = await sha1Base64(privateKey + dataB64 + privateKey);

    const res = await fetch("https://www.liqpay.ua/api/request", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: dataB64, signature }),
    });
    const out = await res.json().catch(() => ({}));

    // LiqPay returns result:"ok" (status:"unsubscribed") on success. Treat an
    // already-unsubscribed order as success too.
    const success =
      out?.result === "ok" ||
      out?.status === "unsubscribed" ||
      /already/i.test(String(out?.err_description ?? ""));
    if (!success) {
      console.error("LiqPay unsubscribe failed:", JSON.stringify(out));
      return json({ error: out?.err_description || "Unsubscribe failed" }, 502);
    }

    // Stop auto-renew now; Pro stays until subscription_until (the expiry cron
    // downgrades it afterward). The callback will also confirm this.
    await admin
      .from("tutor_workspace_settings")
      .update({ liqpay_recurring_active: false })
      .eq("tutor_id", userId);

    return json({ ok: true });
  } catch (e) {
    console.error("liqpay-cancel error:", e);
    return json({ error: "Cancel failed" }, 500);
  }
});
