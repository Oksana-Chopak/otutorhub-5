import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listUpcomingLessons from "./tools/list-upcoming-lessons";
import listStudents from "./tools/list-students";
import listPendingPayments from "./tools/list-pending-payments";

// Build the Supabase Auth issuer from the project ref (import.meta.env is inlined
// by Vite at build time, so this stays import-safe). The direct supabase.co host
// is required — mcp-js rejects tokens if the configured issuer doesn't match the
// discovery document's issuer.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "otutorhub-mcp",
  title: "oTutorHub MCP",
  version: "0.1.0",
  instructions:
    "Tools for oTutorHub: an online school management app. Use `list_upcoming_lessons` to see scheduled lessons, `list_students` to see the tutor/manager's student roster with rates, and `list_pending_payments` to see unpaid lessons. All tools act as the signed-in user (RLS-scoped).",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listUpcomingLessons, listStudents, listPendingPayments],
});
