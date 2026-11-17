/**
 * ВНУТРІШНІЙ ШЛЯХ (17.11). Знайдено на стенді: сповіщення з посиланням `/\example.com`
 * виводило людину на чужий сайт (браузер читає зворотну риску як пряму), а та сама адреса
 * в `?next=` валила екран входу. Сповіщення іншій людині може створити будь-хто з акаунтом.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isSafeInternalPath, safeInternalPath } from "@/lib/safePath";

const read = (p: string) => readFileSync(p, "utf8");

describe("isSafeInternalPath", () => {
  it("звичайні шляхи застосунку проходять", () => {
    for (const p of [
      "/", "/schedule", "/schedule?lesson=7b0c1c1e-0000-4000-8000-000000000001",
      "/finances?tab=debts&remind=abc", "/people?open=abc&rate=1&subject=%D0%90", "/p/abcd2345", "/chats#last",
      "/.lovable/oauth/consent?authorization_id=1",
    ]) expect(isSafeInternalPath(p), p).toBe(true);
  });

  it("усе, що браузер прочитає як чужий сайт, — ні", () => {
    for (const p of [
      "/\\example.com", "/\\\\example.com", "//example.com", "/\t/example.com", "/\n/example.com", "/\r/example.com",
      "https://example.com/login", "javascript:alert(1)", "example.com", "/schedule\\..\\x", "", " /schedule",
    ]) expect(isSafeInternalPath(p), JSON.stringify(p)).toBe(false);
  });

  it("не рядок — ні (посилання зі сповіщення може бути null)", () => {
    for (const p of [null, undefined, 0, {}, ["/x"]]) expect(isSafeInternalPath(p)).toBe(false);
  });

  it("safeInternalPath дає запасний шлях", () => {
    expect(safeInternalPath("/\\example.com")).toBe("/");
    expect(safeInternalPath(null, "/dashboard")).toBe("/dashboard");
    expect(safeInternalPath("/schedule")).toBe("/schedule");
  });
});

describe("кожне місце, що переходить за адресою ззовні, питає одну перевірку", () => {
  it("дзвіночок, вхід (?next=), памʼять «куди йшла», посилання з пушу в застосунку", () => {
    expect(read("src/components/NotificationBell.tsx")).toMatch(/if \(isSafeInternalPath\(n\.link\)\) navigate\(linkForReader\(n\.link, pureStudent\)\)/);
    expect(read("src/pages/AuthPage.tsx")).toMatch(/const nextPath = safeInternalPath\(nextParam\)/);
    expect(read("src/lib/returnTo.ts")).toMatch(/from "@\/lib\/safePath"/);
    const deep = read("src/components/DeepLinkListener.tsx");
    expect(deep).toMatch(/if \(isSafeInternalPath\(target\)\) navigate\(target\)/);
    expect(deep).toMatch(/if \(isSafeInternalPath\(path\)\) navigate\(path\)/);
  });

  it("власної копії перевірки «починається з / і не з //» ніде не лишилось", () => {
    for (const f of ["src/pages/AuthPage.tsx", "src/lib/returnTo.ts", "src/components/NotificationBell.tsx"]) {
      expect(read(f), f).not.toMatch(/startsWith\("\/\/"\)/);
    }
  });

  it("база тримає те саме правило на самій таблиці сповіщень", () => {
    const m = read("supabase/migrations/20261117120000_quiet_and_fast.sql");
    expect(m).toMatch(/CREATE TRIGGER trg_notifications_safe_link\s+BEFORE INSERT OR UPDATE OF link ON public\.notifications/);
    expect(m).toMatch(/position\(E'\\\\' IN _link\) = 0/);
  });
});
