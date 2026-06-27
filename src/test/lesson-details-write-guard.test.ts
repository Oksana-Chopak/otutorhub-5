/**
 * GUARD: all writes to `lesson_details` MUST go through the SECURITY DEFINER RPCs
 * (update_lesson_details_safe / set_lesson_tutor_payout_status[_bulk]) — never a direct
 * `.from("lesson_details").update()/.upsert()` from a client key.
 *
 * Why this test exists: the payout columns (tutor_payout_status / tutor_paid_at) are
 * column-locked at the GRANT level, so a direct write of them from a manager key fails
 * with "permission denied for column …" — a silent, critical blocker (a manager couldn't
 * mark a tutor payout from the Schedule). Reads (.select) are fine. This test fails the
 * build the moment a direct lesson_details write reappears anywhere in the app.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (["node_modules", ".git", "dist"].includes(entry)) continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("lesson_details write guard", () => {
  it("has no direct .update()/.upsert() on lesson_details (must use the safe RPCs)", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const code = readFileSync(file, "utf8");
      let idx = code.indexOf('from("lesson_details")');
      while (idx !== -1) {
        // Look at the chained call right after `from("lesson_details")`.
        const window = code.slice(idx, idx + 160);
        if (/\.(update|upsert)\s*\(/.test(window)) {
          const line = code.slice(0, idx).split("\n").length;
          offenders.push(`${file.replace(SRC, "src")}:${line}`);
        }
        idx = code.indexOf('from("lesson_details")', idx + 1);
      }
    }
    expect(
      offenders,
      `Direct lesson_details writes found (route them through updateLessonDetailsSafe / ` +
        `set_lesson_tutor_payout_status RPC instead):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
