/**
 * СЕКРЕТИ В РЕПОЗИТОРІЇ (17.11). Репозиторій публічний, а в ньому лежали: пароль живого
 * рецензентського акаунта (`docs/APP-REVIEW-NOTES.md`), пароль трьох демо-учнів (скрипт і SQL
 * посіву) і пароль keystore (`docs/RUNBOOK.md`). Будь-хто міг увійти на прод тими акаунтами.
 * З файлів прибрано; ці розтяжки не дають покласти нове.
 */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const tracked = execSync("git ls-files", { encoding: "utf8", maxBuffer: 1 << 26 }).split("\n").filter(Boolean);
const textual = (f: string) => /\.(md|sql|mjs|js|ts|tsx|json|yml|yaml|sh|toml|txt|env|example)$/.test(f) || /(^|\/)\.env/.test(f);
const read = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : "");

describe("у репозиторії немає облікових даних", () => {
  it("git бачить файли (інакше тест нічого не перевіряє)", () => {
    expect(tracked.length).toBeGreaterThan(500);
  });

  it("у доках немає рядка «Password: <значення>» / «Пароль: <значення>»", () => {
    const bad: string[] = [];
    for (const f of tracked.filter((x) => x.startsWith("docs/") || /\.md$/.test(x))) {
      read(f).split("\n").forEach((line, i) => {
        const m = /^\s*(?:[-*]\s*)?(?:password|пароль)\s*:\s*(\S.*)$/i.exec(line);
        if (!m) return;
        const v = m[1].trim();
        // дозволено: підказка в кутових дужках, посилання на секрет, порожньо
        if (/^[<(`{$]/.test(v) || /secret|секрет|\.env|зберігається|власниц/i.test(v)) return;
        bad.push(`${f}:${i + 1}`);
      });
    }
    expect(bad, "пароль живе у власниці або в секретах GitHub / Lovable, не у файлі").toEqual([]);
  });

  it("скрипти й SQL не створюють акаунт із вшитим паролем", () => {
    const bad: string[] = [];
    for (const f of tracked.filter((x) => textual(x) && !x.startsWith("src/test/") && !x.startsWith("tests/") && !x.startsWith("scripts/local-stack/") && !x.startsWith("scripts/db-replay/") && !x.startsWith("src/i18n/"))) {
      read(f).split("\n").forEach((line, i) => {
        if (/\bpassword\s*:\s*["'][^"'${}]{6,}["']/.test(line)) bad.push(`${f}:${i + 1}`);
        if (/crypt\(\s*'[^']{6,}'\s*,/.test(line)) bad.push(`${f}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it("відомі розкриті значення не повертаються у файли", () => {
    // значення зібрані з частин, щоб цей файл сам не став місцем, де вони лежать
    const leaked = ["Demo" + "Stud" + "2026!", "Fedor1" + "_" + "Nazar2"];
    const hits = tracked.filter((f) => textual(f)).filter((f) => { const s = read(f); return leaked.some((v) => s.includes(v)); });
    expect(hits).toEqual([]);
  });

  it("у .env лише публічні значення (ключ anon публічний за задумом)", () => {
    const env = read(".env");
    const names = env.split("\n").map((l) => l.split("=")[0].trim()).filter(Boolean);
    for (const n of names) expect(n, "приватний ключ у .env").toMatch(/^VITE_/);
    expect(env).not.toMatch(/service_role/i);
  });

  it("жодного файла ключів чи сховища підписів у репозиторії", () => {
    expect(tracked.filter((f) => /\.(jks|keystore|p12|pem|p8|mobileprovision)$/.test(f) || /google-services\.json$|GoogleService-Info\.plist$/.test(f))).toEqual([]);
  });
});
