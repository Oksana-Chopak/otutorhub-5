/**
 * 22.09 — скан Lovable «пуші тихо вимикаються після тимчасового збою».
 * Сервер тепер НЕ видаляє підписку на 401/403 (це може бути наша помилка ключа,
 * і тоді стерлись би підписки всім). Ціна цього рішення — підписка зі СТАРИМ
 * ключем більше не прибирається сервером, тож її мусить полагодити сам браузер
 * при відкритті застосунку. Ці тести тримають обидві половини разом.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ops: string[] = [];
const upsertErr: { v: null | { message: string } } = { v: null };
vi.mock("@/integrations/supabase/client", () => {
  const q = (table: string) => {
    const chain: any = {
      delete: () => { ops.push(`delete:${table}`); return chain; },
      eq: (k: string, v: string) => { ops.push(`eq:${k}=${v}`); return chain; },
      upsert: (row: any) => { ops.push(`upsert:${table}:${row.endpoint}`); return Promise.resolve({ error: upsertErr.v }); },
      then: (r: (x: unknown) => unknown) => Promise.resolve({ error: null }).then(r),
    };
    return chain;
  };
  return { supabase: { from: q } };
});
vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

import { healPushSubscription } from "@/hooks/usePushNotifications";
import { subscriptionKeyMatches, urlBase64ToUint8Array, VAPID_PUBLIC_KEY } from "@/lib/pushConfig";

const CURRENT = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
const OLD = new Uint8Array(CURRENT.length).fill(7);

function install(opts: { key: Uint8Array | null; permission?: NotificationPermission; subscribeThrows?: boolean }) {
  const oldSub = {
    endpoint: "https://push.example/old",
    options: { applicationServerKey: opts.key ? opts.key.buffer.slice(0) : null },
    unsubscribe: vi.fn(async () => { ops.push("unsubscribe"); return true; }),
  };
  const fresh = {
    endpoint: "https://push.example/new",
    toJSON: () => ({ keys: { p256dh: "P", auth: "A" } }),
  };
  const reg = {
    pushManager: {
      getSubscription: vi.fn(async () => oldSub),
      subscribe: vi.fn(async () => { if (opts.subscribeThrows) throw new Error("gesture required"); ops.push("subscribe"); return fresh; }),
    },
  };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: vi.fn(async () => reg), register: vi.fn() },
  });
  (window as any).PushManager = function PushManager() {};
  (globalThis as any).Notification = { permission: opts.permission ?? "granted" };
  return { reg, oldSub };
}

beforeEach(() => { ops.length = 0; upsertErr.v = null; });
afterEach(() => { delete (navigator as any).serviceWorker; });

describe("пуші: браузер зі старим ключем лагодить себе сам", () => {
  it("ключ збігається → нічого не чіпаємо (ні бази, ні підписки)", async () => {
    const { reg } = install({ key: CURRENT });
    expect(await healPushSubscription("u1")).toBe("ok");
    expect(ops).toEqual([]);
    expect(reg.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("браузер не показує ключ → теж не чіпаємо, інакше перепідписка на кожному відкритті", async () => {
    const { reg } = install({ key: null });
    expect(await healPushSubscription("u1")).toBe("ok");
    expect(ops).toEqual([]);
    expect(reg.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("старий ключ → старий рядок геть, перепідписка новим ключем, новий рядок у базі", async () => {
    install({ key: OLD });
    expect(await healPushSubscription("u1")).toBe("healed");
    expect(ops[0]).toBe("delete:push_subscriptions");
    expect(ops).toContain("eq:endpoint=https://push.example/old");
    expect(ops.indexOf("unsubscribe")).toBeLessThan(ops.indexOf("subscribe"));
    expect(ops).toContain("upsert:push_subscriptions:https://push.example/new");
  });

  it("дозволу вже нема → чесне «вимкнено», без спроби підписатись", async () => {
    const { reg } = install({ key: OLD, permission: "default" });
    expect(await healPushSubscription("u1")).toBe("off");
    expect(ops).toContain("delete:push_subscriptions");
    expect(reg.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("браузер не дає перепідписатись без дотику → «вимкнено», а не вічне «увімкнено»", async () => {
    install({ key: OLD, subscribeThrows: true });
    expect(await healPushSubscription("u1")).toBe("off");
    expect(ops).toContain("delete:push_subscriptions");
  });

  it("новий рядок не записався → «вимкнено», а не фальшиве «полагоджено»", async () => {
    install({ key: OLD });
    upsertErr.v = { message: "rls" };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await healPushSubscription("u1")).toBe("off");
    spy.mockRestore();
  });

  it("два одночасні виклики (AppLayout + тогл) лікують один раз", async () => {
    const { reg } = install({ key: OLD });
    const [a, b] = await Promise.all([healPushSubscription("u1"), healPushSubscription("u1")]);
    expect(a).toBe("healed");
    expect(b).toBe("healed");
    expect(reg.pushManager.subscribe).toHaveBeenCalledTimes(1);
  });

  it("порівняння ключів: true / false / null", () => {
    expect(subscriptionKeyMatches((CURRENT.buffer as ArrayBuffer).slice(0), CURRENT)).toBe(true);
    expect(subscriptionKeyMatches((OLD.buffer as ArrayBuffer).slice(0), CURRENT)).toBe(false);
    expect(subscriptionKeyMatches(null, CURRENT)).toBeNull();
  });

  it("сервер і клієнт — одна угода: сервер лишає 401/403, застосунок лікує при відкритті", () => {
    const fn = readFileSync(resolve(process.cwd(), "supabase/functions/send-push/index.ts"), "utf8");
    expect(fn).toMatch(/if \(res\.status === 401 \|\| res\.status === 403\) \{[\s\S]{0,160}return "retry";/);
    const layout = readFileSync(resolve(process.cwd(), "src/components/AppLayout.tsx"), "utf8");
    expect(layout).toMatch(/if \(user\) void healPushSubscription\(user\.id\)/);
    expect(fn, "нативний токен — лише на UNREGISTERED, не на голий 404").toMatch(/if \(txt\.includes\("UNREGISTERED"\)\) \{/);
    expect(fn).not.toMatch(/res\.status === 404 \|\| txt\.includes\("UNREGISTERED"\)/);
  });
});
