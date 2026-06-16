// Server-side mirror of the client's `aiAllowed = !isIndependent || isPro`
// (src/hooks/useWorkspaceSettings.tsx). AI конспект is free for hub tutors and
// Pro-gated for independent tutors. Enforced here so the paywall can't be
// bypassed by calling the edge functions directly (devtools / curl / cron).
//
// `client` is any Supabase client that can read the tutor's own
// tutor_workspace_settings row (a user-scoped client via RLS, or a service
// client). Returns false when settings are missing — fail closed.
//
// deno-lint-ignore-file no-explicit-any
export async function tutorAiAllowed(client: any, tutorId: string): Promise<boolean> {
  const { data } = await client
    .from("tutor_workspace_settings")
    .select("independent_workspace, subscription_status, trial_until")
    .eq("tutor_id", tutorId)
    .maybeSingle();

  if (!data) return false;
  if (!data.independent_workspace) return true; // hub tutor — free

  const active = data.subscription_status === "active";
  const trial =
    data.subscription_status === "trial" &&
    !!data.trial_until &&
    new Date(data.trial_until).getTime() > Date.now();
  return active || trial;
}
