import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

// Supabase's OAuth 2.1 authorization server sends users here to approve or deny
// an MCP client (ChatGPT, Claude, Cursor, etc.) connecting to their oTutorHub
// account. The full path (including query string) MUST be preserved into /auth
// via ?next=... so the user returns here after signing in, not to /.
type AuthOAuth = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: any }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: any }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: any }>;
};

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Missing authorization_id");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/auth?next=" + encodeURIComponent(next);
        return;
      }
      const authOAuth = (supabase.auth as any).oauth as AuthOAuth | undefined;
      if (!authOAuth?.getAuthorizationDetails) {
        setError("OAuth server not available on this client build.");
        return;
      }
      const { data, error } = await authOAuth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (error) {
        setError(error.message ?? "Failed to load authorization details.");
        return;
      }
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    try {
      const authOAuth = (supabase.auth as any).oauth as AuthOAuth | undefined;
      if (!authOAuth) {
        setBusy(false);
        setError("OAuth server not available on this client build.");
        return;
      }
      const { data, error } = approve
        ? await authOAuth.approveAuthorization(authorizationId)
        : await authOAuth.denyAuthorization(authorizationId);
      if (error) {
        setBusy(false);
        setError(error.message ?? "Authorization failed.");
        return;
      }
      const target = data?.redirect_url ?? data?.redirect_to;
      if (!target) {
        setBusy(false);
        setError("No redirect returned by the authorization server.");
        return;
      }
      window.location.href = target;
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8" style={{ background: "var(--ds-bg,#F5F4F0)" }}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <img src="/logo-96.webp" alt="oTutorHub" className="h-10 w-10" loading="lazy" />
          <span className="font-display text-lg font-bold text-foreground">oTutorHub</span>
        </div>

        {error && (
          <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {!error && !details && (
          <p className="text-sm text-muted-foreground">Loading authorization request…</p>
        )}

        {details && (
          <>
            <h1 className="mb-2 font-display text-xl font-bold text-foreground">
              Connect {details.client?.name ?? "this app"} to your oTutorHub account
            </h1>
            <p className="mb-6 text-sm text-muted-foreground">
              {details.client?.name ?? "The client"} will be able to use oTutorHub tools as you
              (see your lessons, students, and pending payments — scoped by your role).
            </p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => decide(true)}
                className="h-12 rounded-[14px] bg-primary text-[15.5px] font-bold text-primary-foreground shadow-[0_8px_20px_-8px_rgba(43,191,170,.6)] disabled:opacity-60"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => decide(false)}
                className="h-12 rounded-[14px] border border-border bg-background text-[15.5px] font-semibold text-foreground disabled:opacity-60"
              >
                Deny
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
