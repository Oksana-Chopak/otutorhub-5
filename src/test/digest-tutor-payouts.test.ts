/**
 * 13.09, запит власниці: «мені, менеджеру з трьома репетиторами, не прийшло
 * ЖОДНОГО сповіщення в Telegram, що я з ними не розрахувалася… я сліпа, коли
 * йдеться про борги репетиторам. Додай у те саме одне ранкове повідомлення».
 *
 * Що стережемо:
 *  1. у дайджесті менеджера є секція «Ви винні репетиторам» — по репетиторах,
 *     з кількістю уроків, «⏰ сьогодні день виплати» за графіком і кнопкою
 *     «Виплатив(ла)» (tpaid:) — ті самі уроки, що й RPC mark_tutor_payouts_paid;
 *  2. проведені уроки БЕЗ ставки виплати показуються окремо — це невидимий
 *     борг школи (tutor_payout = null → у підсумку його не було взагалі);
 *  3. telegram-poll обробляє tpaid: лише для менеджера СВОЄЇ школи і лише по
 *     рядках зі ставкою > 0 (NULL-статус = unpaid, як COALESCE у RPC);
 *  4. графік виплат у edge — та сама логіка, що в застосунку.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isPayoutDueToday as edgeDue } from "../../supabase/functions/_shared/payoutSchedule";
import { isPayoutDueToday as appDue } from "@/lib/payoutSchedule";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const src = (f: string) => readFileSync(join(root, f), "utf8");

describe("дайджест менеджера: борги репетиторам у тому самому повідомленні", () => {
  const digest = src("supabase/functions/tutor-daily-digest/index.ts");

  it("секція «Ви винні репетиторам» — по репетиторах, з кнопкою «Виплатив(ла)»", () => {
    for (const lang of ["Ви винні репетиторам", "You owe your tutors", "Du är skyldig dina lärare"]) {
      expect(digest).toContain(lang);
    }
    expect(digest).toMatch(/for \(const l of payoutDueLessons\.filter\(mine\)\)/);
    expect(digest).toMatch(/callback_data: `tpaid:\$\{tid\}`/);
    expect(digest).toMatch(/D\.payoutToday/);
    // голого підсумку «до виплати» без імен більше немає
    expect(digest).not.toMatch(/D\.payout\(/);
  });

  it("проведені уроки без ставки виплати — окремий рядок і кнопка в картку репетитора", () => {
    const pred = digest.slice(digest.indexOf("const isConductedUnrated"), digest.indexOf("const unratedLessons"));
    expect(pred).toMatch(/if \(l\.group_id \|\| l\.status === "cancelled"\) return false/);
    expect(pred).toMatch(/if \(d\.tutor_payout_status === "paid"\) return false/);
    expect(pred).toMatch(/if \(Number\(d\.tutor_payout \?\? 0\) > 0\) return false/);
    expect(pred).toMatch(/l\.status === "completed" \|\| new Date\(l\.starts_at\)\.getTime\(\) <= nowMs/);
    expect(digest).toMatch(/unratedLessons\.filter\(mine\)/);
    // 21.09: кнопка веде ПРЯМО у форму ставки (&rate=1), з предметом, коли він один
    expect(digest).toMatch(/url: `\$\{APP_URL\}\/people\?open=\$\{tid\}&rate=1\$\{subj\}`/);
  });

  it("графік виплат береться з tutor_details через спільний модуль", () => {
    expect(digest).toMatch(/from "\.\.\/_shared\/payoutSchedule\.ts"/);
    expect(digest).toMatch(/from\("tutor_details"\)\.select\("user_id, payout_frequency, payout_weekday, payout_monthday, payout_anchor"\)/);
  });
});

describe("telegram-poll: кнопка «Виплатив(ла)» (tpaid:)", () => {
  const poll = src("supabase/functions/telegram-poll/index.ts");
  const branch = poll.slice(poll.indexOf("if (action === 'tpaid')"), poll.indexOf("// Борги цієї пари"));

  it("приймає tpaid і перевіряє: менеджер → своя школа → репетитор у ній", () => {
    expect(poll).toMatch(/\^\(rem\|paid\|hpaid\|tpaid\):/);
    expect(branch).toMatch(/\.eq\('role', 'manager'\)/);
    expect(branch).toMatch(/from\('hub_managers'\)\.select\('hub_id'\)/);
    expect(branch).toMatch(/from\('tutor_workspace_settings'\)\.select\('tutor_id'\)\.eq\('tutor_id', targetTutorId\)\.eq\('hub_id', hm\.hub_id\)/);
  });

  it("чіпає лише проведені неоплачені рядки зі ставкою > 0; NULL-статус = unpaid; пише аудит", () => {
    expect(branch).toMatch(/if \(Number\(d\.tutor_payout \?\? 0\) <= 0\) return false/);
    expect(branch).toMatch(/l\.status === 'completed' \|\| new Date\(l\.starts_at\)\.getTime\(\) <= nowMs/);
    expect(branch).toMatch(/\.or\('tutor_payout_status\.is\.null,tutor_payout_status\.neq\.paid'\)/);
    expect(branch).toMatch(/payout_last_marked_at: now/);
    expect(branch).toMatch(/action: 'mark_payout_paid_via_telegram'/);
    expect(branch).toMatch(/\.is\('group_id', null\)/);
  });
});

describe("графік виплат: edge-копія = логіка застосунку", () => {
  const cases = [
    { payout_frequency: "weekly", payout_weekday: 5, payout_monthday: null, payout_anchor: null },
    { payout_frequency: "biweekly", payout_weekday: 1, payout_monthday: null, payout_anchor: "2026-09-07" },
    { payout_frequency: "monthly", payout_weekday: null, payout_monthday: 15, payout_anchor: null },
    { payout_frequency: null, payout_weekday: null, payout_monthday: null, payout_anchor: null },
  ];
  it("однакова відповідь на 40 днях поспіль для чотирьох графіків", () => {
    const start = new Date(2026, 8, 1, 9, 0, 0);
    for (const s of cases) {
      for (let i = 0; i < 40; i++) {
        const d = new Date(start.getTime() + i * 86_400_000);
        expect(edgeDue(s, d), `${s.payout_frequency} ${d.toDateString()}`).toBe(appDue(s, d));
      }
    }
    // і хоч раз «так» для кожного графіка з періодичністю
    for (const s of cases.slice(0, 3)) {
      const hits = Array.from({ length: 40 }, (_, i) => edgeDue(s, new Date(start.getTime() + i * 86_400_000))).filter(Boolean).length;
      expect(hits).toBeGreaterThan(0);
    }
  });
});
