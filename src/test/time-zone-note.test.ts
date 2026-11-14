import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gmtOffsetLabel, zoneCity, zoneLabel, toInstant } from "@/lib/timeZone";

/* 14.11, питання власниці: «не дуже зрозуміло, по якому часовому поясу я назначаю урок.
   Я в Стокгольмі, репетитор у Києві, учень у Берліні. Додай позначку часового поясу всюди,
   де є встановлення часу». */
describe("часовий пояс — словами, всюди, де встановлюють час (14.11)", () => {
  it("зсув рахується на ДАТУ уроку: Стокгольм узимку GMT+1, улітку GMT+2", () => {
    expect(gmtOffsetLabel("Europe/Stockholm", new Date("2026-11-14T12:00:00Z"))).toBe("GMT+1");
    expect(gmtOffsetLabel("Europe/Stockholm", new Date("2026-07-14T12:00:00Z"))).toBe("GMT+2");
    expect(gmtOffsetLabel("Europe/Kyiv", new Date("2026-11-14T12:00:00Z"))).toBe("GMT+2");
    expect(gmtOffsetLabel("Europe/Kyiv", new Date("2026-07-14T12:00:00Z"))).toBe("GMT+3");
    expect(gmtOffsetLabel("America/Toronto", new Date("2026-11-14T12:00:00Z"))).toBe("GMT-5");
    expect(gmtOffsetLabel("Asia/Kolkata", new Date("2026-11-14T12:00:00Z"))).toBe("GMT+5:30");
    expect(gmtOffsetLabel("UTC", new Date("2026-11-14T12:00:00Z"))).toBe("GMT");
  });
  it("місто — мовою застосунку; стара назва Kiev = Київ; невідоме місто — як є, без підкреслень", () => {
    expect(zoneCity("Europe/Stockholm")).toBe("Стокгольм");
    expect(zoneCity("Europe/Kyiv")).toBe("Київ");
    expect(zoneCity("Europe/Kiev")).toBe("Київ");
    expect(zoneCity("Europe/Berlin")).toBe("Берлін");
    expect(zoneCity("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(zoneCity("UTC")).toBe("");
    expect(zoneLabel("Europe/Stockholm", new Date("2026-11-14T12:00:00Z"))).toBe("Стокгольм (GMT+1)");
    expect(zoneLabel("UTC", new Date("2026-11-14T12:00:00Z"))).toBe("GMT");
  });
  it("порожнє чи зіпсоване значення форми не ламає позначку — береться «зараз»", () => {
    expect(toInstant("2026-07-14T15:00").getMonth()).toBe(6);
    expect(Number.isNaN(toInstant("").getTime())).toBe(false);
    expect(Number.isNaN(toInstant("T").getTime())).toBe(false);
    expect(Number.isNaN(toInstant(undefined).getTime())).toBe(false);
  });

  /* Розтяжка: нове місце, де встановлюють час, не може зʼявитись без позначки. */
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? (f === "test" || f === "ui" ? [] : walk(p)) : /\.tsx$/.test(f) ? [p] : [];
  });
  const files = walk("src").filter((p) => !p.endsWith("DateTimeField.tsx"));
  it("кожне поле «дата + час» несе позначку: саме (типово) або поруч, якщо вимкнуло свою", () => {
    const canon = readFileSync("src/components/DateTimeField.tsx", "utf8");
    expect(canon).toMatch(/zoneNote = "self"/);
    expect(canon).toMatch(/\{zoneNote && <TimeZoneNote at=\{value\}/);
    let fields = 0;
    for (const p of files) {
      const src = readFileSync(p, "utf8");
      const uses = src.match(/<DateTimeField\b[^>]*>/gs) ?? [];
      fields += uses.length;
      for (const u of uses) {
        if (/zoneNote=\{false\}/.test(u)) expect(src, `${p}: поле вимкнуло позначку і не показало її поруч`).toMatch(/<TimeZoneNote\b/);
      }
    }
    expect(fields).toBeGreaterThanOrEqual(7);
  });
  it("кожен файл із полем «лише час» або власним вибором годин показує позначку", () => {
    for (const p of files) {
      const src = readFileSync(p, "utf8");
      if (/<TimeField\b/.test(src)) expect(src, `${p}: є поле часу без позначки поясу`).toMatch(/<TimeZoneNote\b/);
    }
    // форма уроку: позначка в темній картці часу, видно без розкривання «Змінити»
    const form = readFileSync("src/components/QuickLessonDialog.tsx", "utf8");
    expect(form).toMatch(/<TimeZoneNote at=\{`\$\{ymd\}T\$\{hm\}`\} others[^>]*tone="onDark"/);
    // імпорт розкладу зі списку
    expect(readFileSync("src/components/ImportStudentsSheet.tsx", "utf8")).toMatch(/scheduleOf\(r\)\.length > 0\) && <TimeZoneNote others/);
  });
  it("шрифт позначки не менший за 13px і вона має мітку для роботів", () => {
    const note = readFileSync("src/components/TimeZoneNote.tsx", "utf8");
    expect(note).toMatch(/text-\[13px\]/);
    expect(note).toMatch(/data-tz-note/);
  });
});
