import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { humanizeError } from "@/lib/humanErrors";

describe("сирий текст бази не доходить до людини (13.11)", () => {
  it("відомі технічні тексти замінюються словами", () => {
    for (const raw of [
      'duplicate key value violates unique constraint "lessons_unique_visible_slot_idx"',
      'new row violates row-level security policy for table "lessons"',
      'insert or update on table "student_rewards" violates foreign key constraint',
      'null value in column "rate_per_lesson" of relation "tutor_details" violates not-null constraint',
      "TypeError: Failed to fetch",
      "JWT expired",
    ]) {
      const out = String(humanizeError(raw));
      expect(out).not.toMatch(/violates|constraint|row-level|Failed to fetch|JWT/);
      expect(out.length).toBeGreaterThan(10);
    }
  });
  it("невідомий і людський текст лишається як є", () => {
    expect(humanizeError("Вкажіть хоча б ім'я або прізвище")).toBe("Вкажіть хоча б ім'я або прізвище");
    expect(humanizeError(undefined)).toBe(undefined);
  });
  it("сітка встановлена на старті й у shadcn-тості", () => {
    expect(readFileSync("src/main.tsx", "utf8")).toMatch(/installHumanErrors\(\)/);
    expect(readFileSync("src/hooks/use-toast.ts", "utf8")).toMatch(/humanizeError/);
  });
});
