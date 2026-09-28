import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Замок на сервері (27.09). Клієнтський coreLocked лишається як був (пейвол
 * ДО дії); сервер повторює той самий предикат тригером — щоб обхід браузера
 * не відчиняв платний продукт. Поведінку доводить сценарій 60b-server-core-lock.sql.
 */

describe("міграція 20260927190000_server_core_lock", () => {
  const MIG = "supabase/migrations/20260927190000_server_core_lock.sql";
  it("тригер стоїть на lessons і на student_wallet_transactions, той самий предикат, що в імпорту", () => {
    expect(existsSync(join(ROOT, MIG))).toBe(true);
    expect(existsSync(join(ROOT, "scripts/db-replay/scenarios/60b-server-core-lock.sql"))).toBe(true);
    const m = read(MIG);
    expect(m).toMatch(/CREATE TRIGGER trg_00_core_lock\s+BEFORE INSERT ON public\.lessons/);
    expect(m).toMatch(/CREATE TRIGGER trg_00_core_lock\s+BEFORE INSERT ON public\.student_wallet_transactions/);
    expect(m).toMatch(/public\.is_independent_tutor\(NEW\.tutor_id\) AND NOT public\.is_tutor_pro\(NEW\.tutor_id\)/);
    expect(m).toMatch(/RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED/);
  });
  it("не чіпає менеджера, учня, службові записи, хабові уроки і списання", () => {
    const m = read(MIG);
    expect(m).toMatch(/IF auth\.uid\(\) IS NULL OR auth\.uid\(\) <> NEW\.tutor_id THEN\s*RETURN NEW;/);
    expect(m).toMatch(/to_jsonb\(NEW\)->>'source', ''\) <> 'independent' THEN RETURN NEW;/);
    expect(m).toMatch(/to_jsonb\(NEW\)->>'kind', ''\) <> 'topup' THEN RETURN NEW;/);
  });
});

describe("клієнт: відповідь SUBSCRIPTION_REQUIRED стає пейволом, а не кодом у тості", () => {
  it("помічник isSubscriptionRequiredError живе поруч із замком", () => {
    expect(noComments(read("src/hooks/useCoreLock.tsx"))).toMatch(/export const isSubscriptionRequiredError = \(e: unknown\): boolean =>/);
  });
  for (const f of ["src/components/QuickLessonDialog.tsx", "src/components/RecordPaymentSheet.tsx", "src/components/WalletDialog.tsx", "src/components/ImportStudentsSheet.tsx"]) {
    it(`${f}: серверна відмова веде в пейвол`, () => {
      const s = noComments(read(f));
      expect(s).toMatch(/isSubscriptionRequiredError\(error\)\) \{ lock\.openPaywall\(\); return; \}|\/SUBSCRIPTION_REQUIRED\/\.test\(msg\)\) \{[^}]*lock\.openPaywall\(\); return; \}/);
    });
  }
});
