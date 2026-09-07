/**
 * ХАБ (модель «школа = сутність», 07.09) — три етапи міграцій тримаються
 * тестами, бо жоден скан RLS не бачить SECURITY DEFINER-функцій та в'ю:
 *
 *   A (20260907100000) — сутності, предикати, тригери належності, гард;
 *   B (20260907110000) — 78 manager-політик + 3 DEFINER-в'ю скоуплено;
 *   C (20260907120000) — SECURITY DEFINER-RPC перевіряють школу, не лише роль.
 *
 * Один незакритий арм = один витік на другій школі.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const mig = (f: string) => readFileSync(join(root, "supabase/migrations", f), "utf8");
const model = mig("20260907100000_hub_entity_model.sql");
const sweep = mig("20260907110000_hub_scope_policies.sql");
const rpcs = mig("20260907120000_hub_scope_rpcs.sql");
const code = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("хаб · етап A — модель «школа = сутність»", () => {
  it("школа — сутність: hubs, hub_managers (один менеджер = одна школа), hub_members, settings.hub_id", () => {
    expect(model).toMatch(/CREATE TABLE IF NOT EXISTS public\.hubs \(/);
    expect(model).toMatch(/CREATE TABLE IF NOT EXISTS public\.hub_managers \(/);
    expect(model).toMatch(/CONSTRAINT hub_managers_user_unique UNIQUE \(user_id\)/);
    expect(model).toMatch(/CREATE TABLE IF NOT EXISTS public\.hub_members \(/);
    expect(model).toMatch(/ADD COLUMN IF NOT EXISTS hub_id uuid REFERENCES public\.hubs\(id\)/);
  });
  it("предикати визначені й включають суперадміна; серверні двійники — лише service_role", () => {
    for (const fn of ["is_hub_scoped(_tutor uuid)", "is_hub_member(_user uuid)", "hub_of_user(_user uuid)", "caller_hub_id()", "default_hub_id()"]) {
      expect(model, fn).toContain(`FUNCTION public.${fn}`);
    }
    const scoped = model.slice(model.indexOf("FUNCTION public.is_hub_scoped"), model.indexOf("FUNCTION public.is_hub_member"));
    expect(scoped).toMatch(/public\.is_superadmin\(\)/);
    expect(model).toMatch(/REVOKE EXECUTE ON FUNCTION public\.is_manager_of_tutor\(uuid, uuid\)\s+FROM PUBLIC, anon, authenticated/);
    expect(model).toMatch(/REVOKE EXECUTE ON FUNCTION public\.is_manager_of_user\(uuid, uuid\)\s+FROM PUBLIC, anon, authenticated/);
  });
  it("hub_id — привілейована колонка: колонковий замок + гард; репетитор не змінює свою школу", () => {
    expect(model).toMatch(/REVOKE UPDATE \(hub_id\) ON public\.tutor_workspace_settings FROM authenticated, anon, PUBLIC/);
    expect(model).toMatch(/NEW\.hub_id\s+IS DISTINCT FROM OLD\.hub_id/);
    expect(model).toMatch(/A manager can only attach tutors to their own school/);
  });
  it("незалежний ніколи не в школі: тригер обнуляє hub_id; вихід у незалежні = NULL", () => {
    expect(model).toMatch(/independent_workspace = true THEN\s+NEW\.hub_id := NULL/);
    expect(model).toMatch(/NEW\.hub_id := NULL;\s+-- перехід у незалежні/);
  });
  it("«школа за замовчуванням» — лише поки школа одна; жодного ORDER BY user_id LIMIT 1 у логіці", () => {
    expect(model).toMatch(/count\(\*\) FROM public\.hubs\) = 1/);
    const c = code(model);
    // єдиний дозволений — вибір created_by для засіву першої школи
    expect((c.match(/ORDER BY user_id LIMIT 1/g) ?? []).length).toBe(1);
    expect(c).toMatch(/_hub := public\.default_hub_id\(\)/);
  });
  it("належність ставиться тригерами: pending-профіль, роль, ставка source=hub; хвости чистяться", () => {
    expect(model).toMatch(/CREATE TRIGGER attach_hub_member_on_profile\s+AFTER INSERT ON public\.profiles/);
    expect(model).toMatch(/CREATE TRIGGER ensure_hub_tutor_workspace\s+AFTER INSERT ON public\.user_roles/);
    expect(model).toMatch(/CREATE TRIGGER attach_hub_member_on_rate\s+AFTER INSERT OR UPDATE OF source, tutor_id, student_id ON public\.student_rates/);
    expect(model).toMatch(/CREATE TRIGGER sync_hub_member_on_tutor_hub_change\s+AFTER UPDATE OF hub_id ON public\.tutor_workspace_settings/);
  });
  it("реєстрація запрошеного переносить settings (з hub_id) і членство з pending-профілю", () => {
    const merge = model.slice(model.indexOf("FUNCTION public.merge_pending_profile"));
    expect(merge).toMatch(/UPDATE public\.tutor_workspace_settings SET tutor_id = _real_id/);
    expect(merge).toMatch(/INSERT INTO public\.hub_members \(hub_id, user_id\)\s+SELECT hub_id, _real_id FROM public\.hub_members WHERE user_id = _ghost_id/);
    // порядок: перенесення ДО видалення pending-профілю (каскад зʼїв би рядки)
    expect(merge.indexOf("SET tutor_id = _real_id")).toBeLessThan(merge.indexOf("DELETE FROM public.profiles WHERE id = _ghost_id"));
  });
  it("роль manager видає лише суперадмін (create_hub); менеджер школи не «підвищує» людей", () => {
    expect(model).toMatch(/Only the platform admin can grant the manager role/);
    expect(model).toMatch(/set_config\('app\.allow_manager_role', '1', true\)/);
    expect(model).toMatch(/IF NOT public\.is_superadmin\(\) THEN\s+RAISE EXCEPTION 'Superadmin only'/);
  });
  it("start_manager_chat / notify_managers — через школу, не «перший менеджер платформи»", () => {
    for (const fn of ["start_manager_chat", "notify_managers"]) {
      const body = model.slice(model.indexOf(`FUNCTION public.${fn}`));
      expect(body.slice(0, 2500), fn).toMatch(/public\.hub_of_user\(/);
      expect(body.slice(0, 2500), fn).toMatch(/FROM public\.hub_managers hm/);
    }
  });
});

describe("хаб · етап B — свіп політик і в'ю", () => {
  const policies = [...code(sweep).matchAll(/CREATE POLICY "([^"]+)" ON (\S+)[\s\S]*?;\n/g)];
  it("≥ 78 політик, і КОЖЕН manager-арм скоуплений (is_hub_* / is_superadmin / caller_hub_id)", () => {
    expect(policies.length).toBeGreaterThanOrEqual(78);
    const bare: string[] = [];
    for (const m of policies) {
      const block = m[0];
      for (const arm of block.matchAll(/has_role\s*\(\s*auth\.uid\(\)\s*,\s*'manager'(?:::(?:public\.)?app_role)?\s*\)/g)) {
        const tail = block.slice(arm.index! + arm[0].length, arm.index! + arm[0].length + 400);
        if (!/is_hub_(scoped|member)|is_superadmin|caller_hub_id/.test(tail)) bare.push(`${m[2]}::${m[1]}`);
      }
    }
    expect(bare, "manager-арми без скоупу").toEqual([]);
  });
  it("«Люди» не ламаються: менеджер створює pending-профіль (членство ставить тригер етапу A)", () => {
    expect(sweep).toMatch(/"Manager inserts profiles"[\s\S]*?\(public\.is_hub_member\(id\) OR is_pending = true\)/);
  });
  it("три DEFINER-в'ю перевипущено з is_hub_scoped(репетитор уроку)", () => {
    for (const v of ["lessons_visible", "lesson_participants_visible", "group_enrollments_visible"]) {
      const i = sweep.indexOf(`CREATE VIEW public.${v}`);
      expect(i, v).toBeGreaterThan(-1);
      const body = sweep.slice(i, sweep.indexOf(`GRANT SELECT ON public.${v}`));
      expect(body, v).toMatch(/is_hub_scoped\((l|g)\.tutor_id\)/);
      // жодного голого manager-арму у в'ю
      const bare = [...body.matchAll(/(c\.is_manager|has_role\(auth\.uid\(\), 'manager'::app_role\))(?![\s\S]{0,80}is_hub_scoped)/g)];
      expect(bare.map((b) => b[0]), v).toEqual([]);
    }
  });
  it("платформенне (бот, розсилки, реферали) — лише суперадмін, не менеджер школи", () => {
    for (const p of ["Manager views bot state", "Manager manages referrals", "Managers manage campaigns", "Managers view unsubscribes"]) {
      const m = policies.find((x) => x[1] === p);
      expect(m, p).toBeTruthy();
      expect(m![0], p).toMatch(/public\.is_superadmin\(\)/);
    }
  });
});

describe("хаб · етап C — SECURITY DEFINER-функції", () => {
  const SCOPED = [
    "update_lesson_details_safe", "mark_tutor_payouts_paid", "set_lesson_tutor_payout_status",
    "set_lesson_tutor_payout_status_bulk", "set_tutor_payout_schedule", "backfill_tutor_payouts_for_tutor",
    "get_wallet_balance", "wallet_topup", "wallet_adjust", "wallet_delete_transaction",
    "manager_debts_summary", "manager_debts_by_currency", "get_tutor_level", "get_tutor_monthly_summary",
    "generate_referral_code", "get_referral_savings_uah", "get_tutor_independent_student_count",
    "get_or_create_chat_thread", "manager_purge_user", "purge_user_data", "get_marketing_recipients",
  ];
  it.each(SCOPED)("%s перевипущено і перевіряє школу, не лише роль", (fn) => {
    const i = rpcs.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
    expect(i, `${fn} відсутня в етапі C`).toBeGreaterThan(-1);
    const body = rpcs.slice(i, rpcs.indexOf("$$;", rpcs.indexOf("$$", i + 10) + 2) + 3);
    expect(body, fn).toMatch(/is_hub_manager_of\(|is_hub_scoped\(|is_hub_member\(|is_superadmin\(\)/);
  });
  it("мертві get_lesson_financials / list_lesson_financials (гроші давно не в lessons) — прибрано, не «скоуплено»", () => {
    expect(rpcs).toMatch(/DROP FUNCTION IF EXISTS public\.get_lesson_financials\(uuid\)/);
    expect(rpcs).toMatch(/DROP FUNCTION IF EXISTS public\.list_lesson_financials\(\)/);
    expect(rpcs).not.toMatch(/CREATE OR REPLACE FUNCTION public\.(get|list)_lesson_financials/);
  });
  it("bulk-виплати мовчки пропускають чужі уроки (скоуп у WHERE, не лише на вході)", () => {
    const i = rpcs.indexOf("FUNCTION public.set_lesson_tutor_payout_status_bulk");
    expect(rpcs.slice(i, i + 1200)).toMatch(/AND public\.is_hub_scoped\(l\.tutor_id\)/);
  });
});

describe("хаб · edge-функції під service role перевіряють школу самі", () => {
  const edge = (f: string) => readFileSync(join(root, "supabase/functions", f, "index.ts"), "utf8");
  it("remind-payment / notify-lesson-update / sync-google-calendar — is_manager_of_tutor", () => {
    for (const f of ["remind-payment", "notify-lesson-update", "sync-google-calendar"]) {
      expect(edge(f), f).toMatch(/rpc\("is_manager_of_tutor"/);
    }
  });
  it("send-student-invite — is_manager_of_user; розсилка — лише platform_admins", () => {
    expect(edge("send-student-invite")).toMatch(/rpc\('is_manager_of_user'/);
    expect(edge("send-marketing-campaign")).toMatch(/from\("platform_admins"\)/);
  });
  it("дайджести й нагадування про виплати фільтрують уроки школою менеджера", () => {
    for (const f of ["tutor-daily-digest", "tutor-weekly-digest", "payout-reminders"]) {
      const src = edge(f);
      expect(src, f).toMatch(/from\("hub_managers"\)/);
      expect(src, f).toMatch(/hubOfTutor\.get\(/);
    }
    expect(edge("telegram-poll")).toMatch(/from\('hub_managers'\)/);
  });
});
