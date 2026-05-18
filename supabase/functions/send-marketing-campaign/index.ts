// Send marketing campaign to independent tutors via Brevo
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY")!;
const GATEWAY = "https://connector-gateway.lovable.dev/brevo";

const SENDER_EMAIL = "hello@otutorhub.com";
const SENDER_NAME = "TutorHub";
const APP_URL = "https://otutorhub.com";

function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function buildEmail(opts: {
  subject: string;
  bodyHtml: string;
  firstName: string | null;
  unsubscribeUrl: string;
}) {
  const greeting = opts.firstName
    ? `Привіт, ${escapeHtml(opts.firstName)}!`
    : "Привіт!";
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;">
<div style="max-width:600px;margin:0 auto;background:#ffffff;padding:32px 28px;">
  <p style="font-size:16px;margin:0 0 16px;">${greeting}</p>
  <div style="font-size:15px;line-height:1.6;">${opts.bodyHtml}</div>
  <hr style="border:none;border-top:1px solid #e5e5e5;margin:32px 0 16px;">
  <p style="font-size:12px;color:#888;line-height:1.5;margin:0;">
    Ви отримали цей лист, тому що зареєстровані як репетитор в TutorHub.<br>
    <a href="${opts.unsubscribeUrl}" style="color:#888;">Відписатися від розсилок</a>
  </p>
</div></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth: verify manager
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roleCheck } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "manager")
      .maybeSingle();
    if (!roleCheck) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { subject, htmlBody, segment, dryRun } = body ?? {};
    if (typeof subject !== "string" || subject.length < 1 || subject.length > 200) {
      return new Response(JSON.stringify({ error: "Invalid subject" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (typeof htmlBody !== "string" || htmlBody.length < 1 || htmlBody.length > 100000) {
      return new Response(JSON.stringify({ error: "Invalid htmlBody" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const allowedSegments = ["all_independent", "trial", "trial_ending_soon", "pro_active", "expired"];
    if (!allowedSegments.includes(segment)) {
      return new Response(JSON.stringify({ error: "Invalid segment" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get recipients
    const { data: recipients, error: recErr } = await admin
      .rpc("get_marketing_recipients", { _segment: segment });
    if (recErr) throw recErr;
    const list = (recipients ?? []) as Array<{ user_id: string; email: string; first_name: string | null; last_name: string | null }>;

    if (dryRun) {
      return new Response(JSON.stringify({ count: list.length, sample: list.slice(0, 5).map(r => r.email) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create campaign record
    const { data: campaign, error: campErr } = await admin
      .from("marketing_campaigns")
      .insert({
        created_by: userData.user.id,
        subject, html_body: htmlBody, segment,
        recipients_total: list.length,
        status: "sending",
        started_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (campErr) throw campErr;

    // Fire-and-forget background send
    const sendAll = async () => {
      let sent = 0, failed = 0;
      for (const r of list) {
        try {
          // Get or create unsub token
          let token: string;
          const { data: existing } = await admin
            .from("marketing_unsubscribe_tokens")
            .select("token")
            .eq("email", r.email)
            .maybeSingle();
          if (existing) {
            token = existing.token;
          } else {
            token = randomToken();
            const { error: tokErr } = await admin
              .from("marketing_unsubscribe_tokens")
              .insert({ token, email: r.email });
            if (tokErr) {
              // Fallback: race condition, re-read
              const { data: again } = await admin
                .from("marketing_unsubscribe_tokens")
                .select("token").eq("email", r.email).maybeSingle();
              token = again?.token ?? token;
            }
          }
          const unsubUrl = `${APP_URL}/marketing-unsubscribe?token=${token}`;
          const html = buildEmail({ subject, bodyHtml: htmlBody, firstName: r.first_name, unsubscribeUrl: unsubUrl });

          const resp = await fetch(`${GATEWAY}/smtp/email`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${LOVABLE_API_KEY}`,
              "X-Connection-Api-Key": BREVO_API_KEY,
            },
            body: JSON.stringify({
              sender: { name: SENDER_NAME, email: SENDER_EMAIL },
              to: [{ email: r.email, name: [r.first_name, r.last_name].filter(Boolean).join(" ") || undefined }],
              subject,
              htmlContent: html,
              headers: { "List-Unsubscribe": `<${unsubUrl}>` },
            }),
          });
          if (resp.ok) sent++;
          else {
            failed++;
            const txt = await resp.text().catch(() => "");
            console.error(`Send failed to ${r.email} [${resp.status}]: ${txt}`);
          }
          // Throttle: ~5 emails/sec to be safe
          await new Promise((r) => setTimeout(r, 200));
        } catch (e) {
          failed++;
          console.error("Send error:", e);
        }
      }
      await admin.from("marketing_campaigns").update({
        recipients_sent: sent,
        recipients_failed: failed,
        status: failed > 0 && sent === 0 ? "failed" : "completed",
        completed_at: new Date().toISOString(),
      }).eq("id", campaign.id);
    };

    // @ts-ignore EdgeRuntime exists at runtime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(sendAll());
    } else {
      sendAll();
    }

    return new Response(JSON.stringify({ campaignId: campaign.id, count: list.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-marketing-campaign error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
