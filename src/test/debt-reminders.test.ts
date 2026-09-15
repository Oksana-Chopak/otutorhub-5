import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "glob";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEBT_INTERVAL_DAYS,
  DEBT_KINDS,
  DEBT_MAX_REMINDERS,
  decideDebtReminder,
} from "../../supabase/functions/_shared/debtCadence";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 15, 12, 0, 0);

/**
 * 15.09. Жива база сказала те, чого не сказав жоден зелений гейт: 69 боргів,
 * 68 старші за добу, і НУЛЬ автоматичних нагадувань за 30 днів — при тому, що
 * погодинний крон щоразу завершувався успішно. Два дефекти в одному механізмі,
 * і обидва мовчазні:
 *
 *  · крон писав у лог вид 'before_1d' / 'after_1d', якого CHECK таблиці не
 *    приймає. Вставка падала, помилку ніхто не читав, а дедуп читає САМЕ цей
 *    лог — тож поки урок був у своєму вікні, учень отримував нагадування
 *    ЩОГОДИНИ з 9 до 21;
 *  · саме вікно — 2 доби навколо строку оплати, і рівно один раз на урок.
 *    Борг же не застаріває, тож усе, що старше, не нагадувалось ніколи.
 */
describe("нагадування про борг (15.09)", () => {
  describe("частота: раз на 3 дні, максимум 4 (рішення власниці)", () => {
    it("перше нагадування не йде в першу добу — там ще працює режим репетитора", () => {
      const d = decideDebtReminder(NOW, NOW - 3 * 60 * 60 * 1000, []);
      expect(d).toEqual({ send: false, reason: "too-fresh" });
    });

    it("після доби борг нагадує про себе вперше", () => {
      const d = decideDebtReminder(NOW, NOW - 25 * 60 * 60 * 1000, []);
      expect(d).toEqual({ send: true, kind: "debt_1", index: 1 });
    });

    it("давній борг нагадує одразу — вікна більше немає", () => {
      const d = decideDebtReminder(NOW, NOW - 400 * DAY, []);
      expect(d.send).toBe(true);
    });

    it("раніше ніж через 3 дні після попереднього — мовчимо", () => {
      const d = decideDebtReminder(NOW, NOW - 30 * DAY, [NOW - 2 * DAY]);
      expect(d).toEqual({ send: false, reason: "too-soon" });
    });

    it("через 3 дні — наступне, з наступним номером", () => {
      const d = decideDebtReminder(NOW, NOW - 30 * DAY, [NOW - 3 * DAY - 1]);
      expect(d).toEqual({ send: true, kind: "debt_2", index: 2 });
    });

    it("після чотирьох разів замовкаємо назавжди, а не переходимо на пʼятий", () => {
      const sent = [NOW - 12 * DAY, NOW - 9 * DAY, NOW - 6 * DAY, NOW - 3 * DAY - 1];
      expect(sent.length).toBe(DEBT_MAX_REMINDERS);
      const d = decideDebtReminder(NOW, NOW - 30 * DAY, sent);
      expect(d).toEqual({ send: false, reason: "quota-spent" });
    });

    it("борг, закритий і набраний наново, починає відлік спочатку", () => {
      const old = [NOW - 60 * DAY, NOW - 57 * DAY, NOW - 54 * DAY, NOW - 51 * DAY];
      const d = decideDebtReminder(NOW, NOW - 10 * DAY, old);
      expect(d).toEqual({ send: true, kind: "debt_1", index: 1 });
    });

    it("уся послідовність укладається рівно в 4 повідомлення", () => {
      let now = NOW;
      const sent: number[] = [];
      for (let i = 0; i < 20; i++) {
        const d = decideDebtReminder(now, NOW - 10 * DAY, sent);
        if (d.send) sent.push(now);
        now += DEBT_INTERVAL_DAYS * DAY + 1;
      }
      expect(sent.length).toBe(DEBT_MAX_REMINDERS);
    });
  });

  describe("ворота: вид нагадування мусить бути дозволений базою", () => {
    /** Єдиний список, який приймає CHECK таблиці — беремо з НАЙСВІЖІШОЇ міграції,
     *  що його перевизначає, а не з памʼяті. */
    const allowedKinds = (): string[] => {
      const files = globSync("supabase/migrations/*.sql", { cwd: root }).sort();
      let list: string[] = [];
      for (const f of files) {
        const sql = read(f);
        const m = [...sql.matchAll(/reminder_kind_check[\s\S]{0,200}?CHECK\s*\(\s*reminder_kind\s+IN\s*\(([^)]*)\)/gi)];
        if (m.length) {
          list = [...(m[m.length - 1][1].match(/'([^']+)'/g) ?? [])].map((x) => x.replace(/'/g, ""));
        }
      }
      return list;
    };

    it("список дозволених видів у базі знайдено і він не порожній", () => {
      expect(allowedKinds().length).toBeGreaterThan(4);
    });

    it("КОЖЕН вид, який пише крон, дозволений базою", () => {
      const src = read("supabase/functions/payment-reminders/index.ts");
      const written = new Set<string>();
      for (const m of src.matchAll(/reminderKind\s*=\s*"([^"]+)"/g)) written.add(m[1]);
      for (const k of DEBT_KINDS) written.add(k);
      expect(written.size).toBeGreaterThan(2);
      const allowed = allowedKinds();
      for (const k of written) {
        expect(allowed, `вид «${k}» крон пише, а CHECK бази його не приймає`).toContain(k);
      }
    });

    it("шаблонні види з кількістю днів більше не пишуться", () => {
      const src = read("supabase/functions/payment-reminders/index.ts");
      expect(src, "`before_${days}d` не проходить CHECK — саме через це лог був порожній")
        .not.toMatch(/reminderKind\s*=\s*`(before|after)_\$\{days\}d`/);
    });

    it("помилку запису в лог не ковтаємо — на ньому тримається дедуп", () => {
      const src = read("supabase/functions/payment-reminders/index.ts");
      const inserts = src.match(/from\("lesson_payment_reminders"\)\.insert\(/g) ?? [];
      expect(inserts.length).toBeGreaterThanOrEqual(3);
      expect(src).toMatch(/if \(logErr\) console\.error/);
      expect(src).toMatch(/if \(gLogErr\) console\.error/);
      expect(src).toMatch(/if \(dLogErr\) console\.error/);
    });
  });

  describe("прохід про борг не має вікна і не пропускається", () => {
    const src = () => read("supabase/functions/payment-reminders/index.ts");

    it("борг шукається без нижньої межі дати — він не застаріває", () => {
      const s = src();
      const pass = s.slice(s.indexOf("ПРОХІД ПРО БОРГ"));
      expect(pass, "борг із датою у вікні — це знову той самий дефект").not.toMatch(/\.gte\("starts_at"/);
      expect(pass).toMatch(/\.in\("status", \["completed", "cancelled"\]\)/);
    });

    it("скасований урок входить у борг лише зі штрафом (модель боргу 04.09)", () => {
      expect(src()).toMatch(/l\.status === "cancelled" && d\.is_cancellation_fee !== true/);
    });

    it("одне повідомлення на пару, а не на кожен урок", () => {
      const s = src();
      expect(s).toMatch(/const pairs = new Map</);
      expect(s).toMatch(/decideDebtReminder\(nowMs, pair\.oldestAt/);
    });

    it("раннього виходу перед проходом про борг більше немає", () => {
      expect(src(), "порожнє вікно уроків не має ховати старі борги")
        .not.toMatch(/if \(lessons\.length === 0\) \{\s*\n\s*return new Response/);
    });

    it("прохід про борг вимикається тим самим перемикачем, що й решта", () => {
      const s = src();
      const pass = s.slice(s.indexOf("ПРОХІД ПРО БОРГ"));
      expect(pass).toMatch(/!settings\.payment_reminder_enabled/);
      expect(pass).toMatch(/isProActive\(settings\)/);
    });

    it("падіння проходу про борг не валить нагадування за строком оплати", () => {
      const s = src();
      const pass = s.slice(s.indexOf("ПРОХІД ПРО БОРГ"));
      expect(pass).toMatch(/} catch \(e\) \{/);
    });
  });
});
