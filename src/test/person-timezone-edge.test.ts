import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_TZ, loadTimeZones, readerZone, zoneNeeded, zoneTail, zoneLineIfNeeded, zoneLabel, zoneCity, safeTz, tzFor,
} from "../../supabase/functions/_shared/personTime.ts";

/* 14.11: серверні повідомлення кажуть час за поясом того, хто їх читає. Доти — київський час
   усім і без позначки (учень у Берліні читав «о 16:00» як свої 16:00). */
describe("час у серверних повідомленнях — на годиннику читача (14.11)", () => {
  const at = new Date("2026-11-16T14:00:00Z");
  const zones = new Map([["kyiv", "Europe/Kyiv"], ["berlin", "Europe/Berlin"], ["chisinau", "Europe/Chisinau"], ["toronto", "America/Toronto"]]);

  it("читач: перший, чий пояс відомий; нікого — київський і «невідомо»", () => {
    expect(readerZone(zones, "berlin")).toEqual({ tz: "Europe/Berlin", known: true });
    expect(readerZone(zones, "ghost", "berlin")).toEqual({ tz: "Europe/Berlin", known: true });   // учень без акаунта → пояс репетиторки
    expect(readerZone(zones, "ghost", null)).toEqual({ tz: DEFAULT_TZ, known: false });
    expect(tzFor(zones, "ghost")).toBe(DEFAULT_TZ);
  });
  it("позначка — лише там, де можна помилитись: не Київ або невідомо", () => {
    expect(zoneNeeded(readerZone(zones, "kyiv"), at)).toBe(false);
    expect(zoneNeeded(readerZone(zones, "chisinau"), at)).toBe(false);      // той самий годинник, що в Києві
    expect(zoneNeeded(readerZone(zones, "berlin"), at)).toBe(true);
    expect(zoneNeeded(readerZone(zones, "ghost"), at)).toBe(true);          // час київський — і це треба сказати
    expect(zoneTail(readerZone(zones, "kyiv"), at, "uk")).toBe("");
    expect(zoneTail(readerZone(zones, "berlin"), at, "uk")).toBe(" (Берлін, GMT+1)");
    expect(zoneTail(readerZone(zones, "ghost"), at, "uk")).toBe(" (Київ, GMT+2)");
    expect(zoneTail(readerZone(zones, "toronto"), at, "en")).toBe(" (Toronto, GMT-5)");
    expect(zoneLineIfNeeded(readerZone(zones, "kyiv"), at, "uk")).toBeNull();
    expect(zoneLineIfNeeded(readerZone(zones, "berlin"), at, "sv")).toBe("🌍 Tid: Berlin (GMT+1)");
  });
  it("літній час: Берлін улітку GMT+2; невідомий пояс не валить повідомлення", () => {
    expect(zoneLabel("Europe/Berlin", new Date("2026-07-16T14:00:00Z"), "uk")).toBe("Берлін (GMT+2)");
    expect(safeTz("No/Such_Zone")).toBe(DEFAULT_TZ);
    expect(safeTz(null)).toBe(DEFAULT_TZ);
    expect(zoneCity("Europe/Kiev", "uk")).toBe("Київ");
    expect(zoneCity("America/Argentina/Buenos_Aires", "uk")).toBe("Buenos Aires");
  });
  it("читання поясів терпляче: функції ще немає в базі → порожньо, і всі отримують київський час", async () => {
    const calls: string[][] = [];
    const ok = { rpc: async (_fn: string, a: { _ids: string[] }) => { calls.push(a._ids); return { data: [{ user_id: "a", timezone: "Europe/Berlin" }, { user_id: "b", timezone: "Нісенітниця/Пояс" }, { user_id: "c", timezone: null }], error: null }; } };
    const m = await loadTimeZones(ok, ["a", "b", "c", "a", null, undefined]);
    expect(calls).toEqual([["a", "b", "c"]]);
    expect(m.get("a")).toBe("Europe/Berlin");
    expect(m.get("b")).toBe(DEFAULT_TZ);            // сміття в базі не ламає форматування
    expect(m.has("c")).toBe(false);
    const missing = { rpc: async () => ({ data: null, error: { message: "function public.people_timezones does not exist" } }) };
    expect((await loadTimeZones(missing, ["a"])).size).toBe(0);
    const broken = { rpc: async () => { throw new Error("network"); } };
    expect((await loadTimeZones(broken, ["a"])).size).toBe(0);
  });
  it("назви міст у повідомленнях — ті самі, що в застосунку (uk / en / sv)", () => {
    const edge = readFileSync("supabase/functions/_shared/personTime.ts", "utf8");
    const rows = [...edge.matchAll(/^ {2}(\w+): \{ uk: "([^"]+)", en: "([^"]+)", sv: "([^"]+)" \},$/gm)];
    expect(rows.length).toBeGreaterThanOrEqual(36);
    for (const lang of ["uk", "en", "sv"] as const) {
      const app = readFileSync(`src/i18n/locales/${lang}.ts`, "utf8");
      const block = app.slice(app.indexOf("  timeZone: {"));
      for (const r of rows) {
        const want = lang === "uk" ? r[2] : lang === "en" ? r[3] : r[4];
        expect(block, `${lang}: ${r[1]}`).toContain(`      ${r[1]}: "${want}",`);
      }
    }
  });
  it("жодне повідомлення про урок чи оплату більше не форматує час «за Києвом» напряму", () => {
    const rd = (f: string) => readFileSync(`supabase/functions/${f}`, "utf8");
    const formatsKyiv = (src: string) => /toLocale(String|TimeString)\([^)]*\{[^}]*timeZone: ("Europe\/Kyiv"|TZ)\b/s.test(src);
    expect(formatsKyiv(rd("lesson-reminders/index.ts"))).toBe(false);
    expect(formatsKyiv(rd("payment-reminders/index.ts"))).toBe(false);
    expect(formatsKyiv(rd("_shared/paymentReminder.ts"))).toBe(false);
    expect(formatsKyiv(rd("notify-cancellation-fee/index.ts"))).toBe(false);
    expect(formatsKyiv(rd("tutor-daily-digest/index.ts"))).toBe(false);
    // і кожна з них питає пояси людей
    for (const f of ["lesson-reminders/index.ts", "payment-reminders/index.ts", "_shared/paymentReminder.ts", "notify-cancellation-fee/index.ts", "tutor-daily-digest/index.ts"]) {
      expect(rd(f), f).toMatch(/loadTimeZones\(/);
    }
    // нагадування учневі — за поясом УЧНЯ, не репетитора
    expect(rd("lesson-reminders/index.ts")).toMatch(/const dateStr = whenFor\(lesson\.starts_at, sid\);/);
  });
});
