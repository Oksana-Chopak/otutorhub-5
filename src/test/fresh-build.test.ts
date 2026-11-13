import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isNewerBuild } from "@/lib/freshBuild";

describe("стара вкладка оновлюється сама (13.11)", () => {
  it("новішою вважається лише інша справжня збірка", () => {
    expect(isNewerBuild("aaaaaaaa", "bbbbbbbb")).toBe(true);
    expect(isNewerBuild("aaaaaaaa", "aaaaaaaa")).toBe(false);
    expect(isNewerBuild("dev", "bbbbbbbb")).toBe(false);
    expect(isNewerBuild("aaaaaaaa", null)).toBe(false);
    expect(isNewerBuild("aaaaaaaa", "")).toBe(false);
  });
  it("AppLayout звіряє збірку при переході й поверненні на вкладку", () => {
    const src = readFileSync("src/components/AppLayout.tsx", "utf8");
    expect(src).toMatch(/ensureFreshBuild\(\); \}, \[pathname\]\)/);
    expect(src).toMatch(/visibilitychange/);
  });
  it("перезавантаження — не посеред форми, не в нативному застосунку і без петлі", () => {
    const src = readFileSync("src/lib/freshBuild.ts", "utf8");
    expect(src).toMatch(/role="dialog"/);
    expect(src).toMatch(/isNativeApp\(\)/);
    expect(src).toMatch(/sessionStorage\.getItem\(TRIED_KEY\) === stamp/);
  });
});
