// SINGLE SOURCE OF TRUTH for which ROLE sees which cross-cutting feature.
//
// The #1 source of bugs in this app has been role-visibility logic written for one
// tutor type (independent) and silently missing for the other (hub) — achievements,
// onboarding, notes, the create-lesson entry, etc. To stop that class of bug, gate
// cross-cutting features on `canSee(...)` here instead of on raw `isIndependent` /
// `isHubTutor` flags scattered across pages, and lock the matrix with
// `src/test/role-capabilities.test.ts`. Change who sees a feature in ONE place, and
// the test tells you exactly what shifted for every role.
//
// Role model (see CLAUDE.md):
//   • manager           — runs a hub; owns billing/pricing; not a teaching tutor.
//   • hub tutor         — teaches for a hub; paid BY the hub; no own billing.
//   • independent tutor — own workspace, own students/prices, Pro subscription.
//   • student           — takes lessons.

export interface RoleFlags {
  /** has the 'manager' role */
  isManager: boolean;
  /** has the 'tutor' role */
  isTutor: boolean;
  /** a tutor running their OWN workspace (subscription / own students) — false for hub tutors */
  isIndependent: boolean;
  /** has the 'student' role */
  isStudent: boolean;
}

export type Feature =
  // ── Independent-tutor-only (billing / Pro / own workspace) ──
  | "subscription"   // Pro billing — hub tutors are paid by the hub
  | "referrals"      // referral bonus is Pro months — useless to hub tutors
  | "paymentRules"   // cancellation / prepay policy — hub billing is the manager's job
  | "autoMark"       // auto-complete billing setting — manager's job for hub
  | "ownStudents"    // add / price own students — the manager assigns them for a hub
  // ── Every teaching tutor (independent AND hub) ──
  | "achievements"   // gamified level / streak / badges — every tutor teaches & earns
  | "setupGuide"     // onboarding guide — every tutor onboards (hub gets a lighter set)
  | "tutorNotes"     // private per-student notes — every tutor
  | "aiNotes";       // AI lesson summary — every tutor (independent additionally needs Pro)

/** A tutor who is NOT a manager and runs their own independent workspace. */
export const isIndependentTutor = (f: RoleFlags): boolean =>
  f.isTutor && !f.isManager && f.isIndependent;

/** A tutor who belongs to a hub (the manager owns billing / students). */
export const isHubTutor = (f: RoleFlags): boolean =>
  f.isTutor && !f.isManager && !f.isIndependent;

/** Any teaching tutor (independent or hub), excluding managers. */
export const isAnyTutor = (f: RoleFlags): boolean => f.isTutor && !f.isManager;

const INDEPENDENT_ONLY: ReadonlySet<Feature> = new Set<Feature>([
  "subscription",
  "referrals",
  "paymentRules",
  "autoMark",
  "ownStudents",
]);

const ANY_TUTOR: ReadonlySet<Feature> = new Set<Feature>([
  "achievements",
  "setupGuide",
  "tutorNotes",
  "aiNotes",
]);

/** Whether the given role (described by `flags`) should see `feature`. */
export function canSee(feature: Feature, flags: RoleFlags): boolean {
  if (INDEPENDENT_ONLY.has(feature)) return isIndependentTutor(flags);
  if (ANY_TUTOR.has(feature)) return isAnyTutor(flags);
  return false;
}
