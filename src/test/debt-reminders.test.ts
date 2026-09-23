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
  buildDebtPairs,
  splitOtherHistory,
  PAIR_WIDE_KINDS,
  PER_LESSON_KINDS,
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

    it("22.09: учора пішло «після уроку» про ЄДИНИЙ борг — сьогодні про борг МОВЧИМО", () => {
      // Скан Lovable 22.09: учень отримував «час оплатити заняття» і одразу «є
      // неоплачені уроки» про той самий урок. Урок, про який щойно писали,
      // з проходу про борг виключається — а іншого боргу тут немає.
      const { noticedLessons, lastPairWideByPair } = splitOtherHistory([
        { lesson_id: "L2", tutor_id: "T", student_id: "S", sent_at: new Date(NOW - 1 * DAY).toISOString(), reminder_kind: "after_lesson" },
      ]);
      const pairs = buildDebtPairs([{ tutor_id: "T", student_id: "S", lessonId: "L2", at: NOW - 2 * DAY, price: 500 }], noticedLessons);
      expect(pairs.get("T:S")?.chaseable).toBe(0);
      expect(lastPairWideByPair.size, "«після уроку» не глушить пару — лише свій урок").toBe(0);
    });

    it("23.09 (скан Lovable): учень із двома уроками на тиждень — СТАРИЙ борг усе одно нагадує про себе", () => {
      // Регресія правки 22.09: «після уроку» кожні 3–4 дні глушило прохід про
      // борг назавжди, і про старі неоплачені уроки не нагадали б ніколи.
      const { noticedLessons, lastPairWideByPair } = splitOtherHistory([
        { lesson_id: "L2", tutor_id: "T", student_id: "S", sent_at: new Date(NOW - 1 * DAY).toISOString(), reminder_kind: "after_lesson" },
      ]);
      const pairs = buildDebtPairs([
        { tutor_id: "T", student_id: "S", lessonId: "L1", at: NOW - 10 * DAY, price: 500 }, // старий, ніхто не згадував
        { tutor_id: "T", student_id: "S", lessonId: "L2", at: NOW - 2 * DAY, price: 500 },  // учора про нього писали
      ], noticedLessons);
      const pair = pairs.get("T:S")!;
      expect(pair.chaseable).toBe(1);
      expect(pair.count, "баланс чесний — усі неоплачені уроки").toBe(2);
      expect(pair.total).toBe(1000);
      const d = decideDebtReminder(NOW, pair.oldestAt, [], lastPairWideByPair.get("T:S") ?? null);
      expect(d).toEqual({ send: true, kind: "debt_1", index: 1 });
    });

    it("23.09: ручне «Нагадати» / кнопка Telegram — розмова про ВЕСЬ борг, вона глушить пару на 3 дні", () => {
      const { noticedLessons, lastPairWideByPair } = splitOtherHistory([
        { lesson_id: "L1", tutor_id: "T", student_id: "S", sent_at: new Date(NOW - 1 * DAY).toISOString(), reminder_kind: "manual" },
      ]);
      expect(noticedLessons.size).toBe(0);
      const pairs = buildDebtPairs([{ tutor_id: "T", student_id: "S", lessonId: "L1", at: NOW - 10 * DAY, price: 500 }], noticedLessons);
      const d = decideDebtReminder(NOW, pairs.get("T:S")!.oldestAt, [], lastPairWideByPair.get("T:S") ?? null);
      expect(d).toEqual({ send: false, reason: "too-soon" });
      expect([...PAIR_WIDE_KINDS]).toEqual(["manual", "telegram_button"]);
      expect([...PER_LESSON_KINDS]).toEqual(["before_lesson", "after_lesson", "prepaid"]);
    });

    it("22.09: вчора написав сам репетитор («Нагадати») — помічник теж мовчить", () => {
      const d = decideDebtReminder(NOW, NOW - 20 * DAY, [], NOW - 12 * 60 * 60 * 1000);
      expect(d.send).toBe(false);
    });

    it("22.09: після тиші в 3 дні від БУДЬ-ЯКОГО нагадування — перше про борг", () => {
      const d = decideDebtReminder(NOW, NOW - 20 * DAY, [], NOW - 3 * DAY - 1);
      expect(d).toEqual({ send: true, kind: "debt_1", index: 1 });
    });

    it("22.09: стеля «4 рази» рахує лише нагадування про борг", () => {
      const debt = [NOW - 20 * DAY, NOW - 17 * DAY, NOW - 14 * DAY];
      const d = decideDebtReminder(NOW, NOW - 30 * DAY, debt, NOW - 10 * DAY);
      expect(d).toEqual({ send: true, kind: "debt_4", index: 4 });
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
      // пари збирає buildDebtPairs (23.09), рішення — по парі
      expect(s).toMatch(/const pairs = buildDebtPairs\(/);
      expect(s).toMatch(/decideDebtReminder\(nowMs, pair\.oldestAt/);
    });

    it("раннього виходу перед проходом про борг більше немає", () => {
      expect(src(), "порожнє вікно уроків не має ховати старі борги")
        .not.toMatch(/if \(lessons\.length === 0\) \{\s*\n\s*return new Response/);
    });

    it("22.09/23.09: прохід про борг читає «інші» нагадування з lesson_id, ділить їх правильно і виключає згадані уроки", () => {
      const s = src();
      const pass = s.slice(s.indexOf("ПРОХІД ПРО БОРГ"));
      expect(pass).toMatch(/\.select\("lesson_id, tutor_id, student_id, sent_at, reminder_kind"\)/);
      expect(pass).toMatch(/\.not\("reminder_kind", "like", "debt%"\)\s*\n\s*\.gte\("sent_at", new Date\(now\.getTime\(\) - DEBT_INTERVAL_DAYS \* DAY_MS\)/);
      expect(pass).toMatch(/splitOtherHistory\(\(oHist \?\? \[\]\) as any\[\]\)/);
      expect(pass).toMatch(/buildDebtPairs\(debtRows as DebtRow\[\], noticedLessons\)/);
      expect(pass).toMatch(/if \(pair\.chaseable === 0\) \{ skipped\+\+; continue; \}/);
      expect(pass).toMatch(/lastPairWideByPair\.get\(key\) \?\? null/);
      expect(pass, "старий підхід «будь-яке нагадування глушить пару» не повертається").not.toMatch(/lastOtherByPair/);
      expect(pass, "без історії не можна чесно вирішити «чи не зарано»").toMatch(/if \(dHistErr\) throw/);
      expect(pass).toMatch(/if \(oHistErr\) throw/);
    });

    it("22.09: історія ПРО БОРГ — від найстарішого боргу, а не фіксоване вікно", () => {
      // Перша версія правки читала «усе за 60 днів». Борг не застаріває, тож
      // через два місяці вже надіслані 4 нагадування «забувались» — і помічник
      // починав коло наново (а коли лог упирався в UNIQUE — щогодини).
      const s = src();
      const pass = s.slice(s.indexOf("ПРОХІД ПРО БОРГ"));
      expect(pass).toMatch(/const minOldestAt = Math\.min\(\.\.\.\[\.\.\.pairs\.values\(\)\]\.map\(\(v\) => v\.oldestAt\)\)/);
      expect(pass).toMatch(/\.like\("reminder_kind", "debt%"\)\s*\n\s*\.gte\("sent_at", new Date\(minOldestAt\)\.toISOString\(\)\)/);
      expect(pass, "фіксоване вікно забуває стелю «4 рази»").not.toMatch(/60 \* DAY_MS/);
      expect(pass, "історія може бути довгою — сторінками").toMatch(/const \{ data: dHist, error: dHistErr \} = await fetchAllRows<any>\(/);
    });

    it("чому це важливо: без старих нагадувань стеля «4 рази» обнуляється", () => {
      const oldest = NOW - 100 * DAY;
      const sent = [oldest + 1 * DAY, oldest + 4 * DAY, oldest + 7 * DAY, oldest + 10 * DAY];
      expect(decideDebtReminder(NOW, oldest, sent)).toEqual({ send: false, reason: "quota-spent" });
      // те саме, але історія «за 60 днів» — порожня: помічник почав би спочатку
      const window60 = sent.filter((t) => t >= NOW - 60 * DAY);
      expect(decideDebtReminder(NOW, oldest, window60).send).toBe(true);
    });

    it("22.09: «після уроку» мовчить, якщо цій парі щойно писали про борг", () => {
      const s = src();
      expect(s).toMatch(/reminderKind === "after_lesson" && debtJustSent\(lesson\.tutor_id, lesson\.student_id\)/);
      expect(s).toMatch(/reminderKind === "after_lesson" && debtJustSent\(lesson\.tutor_id, p\.student_id\)/);
      // учасники груп відомі пізніше — для них історію треба дочитати, інакше
      // перевірка для групових уроків мовчки не діяла б
      expect(s).toMatch(/await loadRecentDebt\(lessons\.map\(\(l: any\) => l\.student_id\)\)/);
      const gi = s.indexOf("await loadRecentDebt(parts.map((p: any) => p.student_id));");
      expect(gi).toBeGreaterThan(0);
      expect(gi, "до циклу по учасниках").toBeLessThan(s.indexOf("for (const p of parts) {"));
    });

    it("22.09: ручне «Нагадати» пише лог із тим самим ключем, що й унікальний індекс", () => {
      // Міграція 20260915100000 додала student_id у ключ логу. Upsert зі старим
      // onConflict Postgres відхиляє (42P10) — із 16.09 жодне ручне нагадування
      // не потрапляло в лог (перевірено на репліці бази 22.09).
      const mig = readFileSync(join(root, "supabase/migrations/20260915100000_payment_reminder_kinds.sql"), "utf8");
      expect(mig).toMatch(/ON public\.lesson_payment_reminders \(lesson_id, student_id, reminder_kind, channel\)/);
      const shared = readFileSync(join(root, "supabase/functions/_shared/paymentReminder.ts"), "utf8");
      const targets = [...shared.matchAll(/onConflict: "([^"]+)"/g)].map((m) => m[1]);
      expect(targets.length).toBeGreaterThan(0);
      for (const t of targets) {
        expect(new Set(t.split(","))).toEqual(new Set(["lesson_id", "student_id", "reminder_kind", "channel"]));
      }
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
