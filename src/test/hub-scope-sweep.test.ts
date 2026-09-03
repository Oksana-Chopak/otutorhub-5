/**
 * HUB_ID етап B: кожне has_role(manager) у згенерованому свіпі мусить бути
 * одразу скоуплене на хаб. Один незакритий арм = один витік на другій школі.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const sweep = readFileSync(join(root, "supabase/migrations-deferred/20260903180000_hub_scope_policies.sql"), "utf8");
const model = readFileSync(join(root, "supabase/migrations-deferred/20260903170000_hub_id_model.sql"), "utf8");

describe("hub_id етап B — свіп політик", () => {
  it("кожен manager-арм у свіпі скоуплений на хаб", () => {
    const body = sweep.split("\n\nDROP POLICY")[1] ?? "";
    const total = (body.match(/'manager'::app_role\)/g) ?? []).length;
    const scoped = (body.match(/'manager'::app_role\) AND public\.is_hub_(scoped|member)\(/g) ?? []).length;
    expect(total).toBeGreaterThan(0);
    expect(scoped, "є manager-арм без is_hub_scoped/is_hub_member").toBe(total);
  });
  it("предикати, на які спирається свіп, визначені в етапі A", () => {
    expect(model).toMatch(/FUNCTION public\.is_hub_scoped\(_tutor uuid\)/);
    expect(model).toMatch(/FUNCTION public\.is_hub_member\(_user uuid\)/);
  });
  it("hub_id — привілейована колонка: гард згадує її; тьютор не може змінити свій хаб", () => {
    expect(model).toMatch(/NEW\.hub_id\s+IS DISTINCT FROM OLD\.hub_id/);
  });
  it("незалежний ніколи не в хабі: тригер обнуляє hub_id при independent_workspace=true", () => {
    expect(model).toMatch(/independent_workspace = true THEN\s+NEW\.hub_id := NULL/);
  });
  it("«хаб за замовчуванням» живе в ОДНІЙ функції — єдине місце для другої школи", () => {
    expect(model).toMatch(/FUNCTION public\.default_hub_id\(\)/);
    const code = model.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect((code.match(/ORDER BY user_id LIMIT 1/g) ?? []).length).toBe(1);
    expect(code).toMatch(/_manager := public\.default_hub_id\(\)/);
  });
});
