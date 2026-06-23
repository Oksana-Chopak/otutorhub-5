/**
 * The Role × Feature matrix — single source of truth for cross-cutting visibility.
 *
 * This is the test that breaks the manual-testing cycle for the most common bug
 * class in this app: a feature shown to one tutor type but silently missing for the
 * other. If anyone changes who sees a feature, this matrix tells them exactly what
 * shifted for manager / hub-tutor / independent-tutor / student.
 *
 * When you add a cross-cutting feature, add a row here AND gate the UI on
 * `canSee(...)` from src/lib/roleCapabilities.ts.
 */
import { describe, it, expect } from "vitest";
import {
  canSee,
  isAnyTutor,
  isHubTutor,
  isIndependentTutor,
  type Feature,
  type RoleFlags,
} from "@/lib/roleCapabilities";

const manager: RoleFlags = { isManager: true, isTutor: false, isIndependent: false, isStudent: false };
const hubTutor: RoleFlags = { isManager: false, isTutor: true, isIndependent: false, isStudent: false };
const indTutor: RoleFlags = { isManager: false, isTutor: true, isIndependent: true, isStudent: false };
const student: RoleFlags = { isManager: false, isTutor: false, isIndependent: false, isStudent: true };

// feature → which of the 4 roles SHOULD see it. Edit this when intent changes.
const MATRIX: Record<Feature, { manager: boolean; hub: boolean; independent: boolean; student: boolean }> = {
  // Independent-only (billing / Pro / own workspace):
  subscription: { manager: false, hub: false, independent: true, student: false },
  referrals:    { manager: false, hub: false, independent: true, student: false },
  paymentRules: { manager: false, hub: false, independent: true, student: false },
  autoMark:     { manager: false, hub: false, independent: true, student: false },
  ownStudents:  { manager: false, hub: false, independent: true, student: false },
  // Every tutor (independent AND hub) — the parity that kept regressing:
  achievements: { manager: false, hub: true,  independent: true, student: false },
  setupGuide:   { manager: false, hub: true,  independent: true, student: false },
  tutorNotes:   { manager: false, hub: true,  independent: true, student: false },
  aiNotes:      { manager: false, hub: true,  independent: true, student: false },
};

describe("role capabilities — Role × Feature matrix", () => {
  for (const [feature, exp] of Object.entries(MATRIX) as [Feature, (typeof MATRIX)[Feature]][]) {
    it(`${feature} → manager:${exp.manager} hub:${exp.hub} independent:${exp.independent} student:${exp.student}`, () => {
      expect(canSee(feature, manager)).toBe(exp.manager);
      expect(canSee(feature, hubTutor)).toBe(exp.hub);
      expect(canSee(feature, indTutor)).toBe(exp.independent);
      expect(canSee(feature, student)).toBe(exp.student);
    });
  }

  it("HUB tutor sees achievements + setupGuide (the exact regressions we just fixed)", () => {
    expect(canSee("achievements", hubTutor)).toBe(true);
    expect(canSee("setupGuide", hubTutor)).toBe(true);
    expect(canSee("tutorNotes", hubTutor)).toBe(true);
    expect(canSee("aiNotes", hubTutor)).toBe(true);
  });

  it("HUB tutor never sees independent billing features (manager owns billing)", () => {
    expect(canSee("subscription", hubTutor)).toBe(false);
    expect(canSee("referrals", hubTutor)).toBe(false);
    expect(canSee("paymentRules", hubTutor)).toBe(false);
    expect(canSee("autoMark", hubTutor)).toBe(false);
  });

  it("a manager is never treated as a teaching tutor", () => {
    expect(isAnyTutor(manager)).toBe(false);
    expect(isHubTutor(manager)).toBe(false);
    expect(isIndependentTutor(manager)).toBe(false);
  });

  it("role predicates are internally consistent", () => {
    expect(isHubTutor(hubTutor)).toBe(true);
    expect(isIndependentTutor(hubTutor)).toBe(false);
    expect(isIndependentTutor(indTutor)).toBe(true);
    expect(isHubTutor(indTutor)).toBe(false);
    expect(isAnyTutor(hubTutor) && isAnyTutor(indTutor)).toBe(true);
  });
});
