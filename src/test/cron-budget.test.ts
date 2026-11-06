/**
 * Бюджет кронів — ворота, яких бракувало 25.10 (06.11).
 *
 * `telegram-poll` стояв на «кожну хвилину»: 1440 запусків на добу, журнал
 * pg_cron виріс до 4.3 ГБ — 96 % усієї бази — і рахунок ріс місяцями. Ніхто
 * не помітив, бо розклад крона ніхто не РАХУВАВ: він лежав у міграції рядком,
 * і жоден гейт на нього не дивився.
 *
 * Сам підрахунок живе в сценарії прогону бази (там є справжня cron.job після
 * усієї історії міграцій). Тут — тримаємо сценарій на місці й стежимо, щоб
 * стелю не підняли мовчки: підняти її можна, але це видно в дифі.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const SC = "scripts/db-replay/scenarios/75-cron-budget.sql";

describe("ворота бюджету кронів", () => {
  it("сценарій на місці — інакше клас помилки 25.10 знову нічим не ловити", () => {
    expect(existsSync(SC), `${SC} зник`).toBe(true);
  });

  const sql = () => readFileSync(SC, "utf8");

  it("стелі названі числами, а не «на око»", () => {
    expect(sql()).toMatch(/per_job_cap\s+constant numeric := 288/);   // кожні 5 хвилин
    expect(sql()).toMatch(/total_cap\s+constant numeric := 1200/);
  });

  it("нерозпізнаний розклад — провал, а не нуль", () => {
    // Мовчазний нуль — це саме те, через що «5 seconds» міг би пройти повз.
    expect(sql()).toMatch(/ПРОВАЛ \(1\)/);
    expect(sql()).toMatch(/second\|minute\|hour\|day/);
  });

  it("лічилка перевіряє сама себе на відомих випадках", () => {
    const s = sql();
    for (const [sched, perDay] of [["* * * * *", "1440"], ["*/5 * * * *", "288"], ["5 seconds", "17280"]] as const) {
      expect(s, `${sched} → ${perDay}`).toContain(`cron_runs_per_day('${sched}')`);
      expect(s).toContain(perDay);
    }
  });

  it("винятки — поіменно, і зараз їх немає", () => {
    expect(sql()).toMatch(/allowed\s+constant text\[\] := ARRAY\[\]::text\[\]/);
  });
});
