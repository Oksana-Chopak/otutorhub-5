/**
 * Ратчети пакета «повторний аудит усіх ролей, 01.10». Усе тут — про edge-функції,
 * які неможливо виконати в пісочниці (вони імпортують із esm.sh), тож інваріант
 * тримається читанням джерела. Кожен блок пояснює, ЩО зламалось у проді.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf-8");
const noComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("нагадування про уроки: груповий урок — це теж урок", () => {
  const f = () => noComments(read("supabase/functions/lesson-reminders/index.ts"));

  it("учасники групових уроків читаються, і їхні id входять у чати й імена", () => {
    const s = f();
    expect(s, "група звʼязана через lesson_participants, бо lessons.student_id = NULL")
      .toMatch(/\.from\("lesson_participants"\)\s*\.select\("lesson_id, student_id"\)/);
    expect(s, "збій читання учасників мусить казати про себе")
      .toMatch(/учасників груп не прочитано/);
    expect(s, "без цього у них немає ні чату, ні імені")
      .toMatch(/\.\.\.Array\.from\(participantsByLesson\.values\(\)\)\.flat\(\)/);
  });

  it("нагадування учневі йде КОЖНОМУ учаснику, а не в null", () => {
    const s = f();
    // Доти обидві «учнівські» гілки адресувались lesson.student_id, тобто для
    // групового уроку — в нікуди: учні шкіл не отримували нагадувань узагалі.
    expect(s).not.toMatch(/chatByUser\.get\(lesson\.student_id\)/);
    expect(s).not.toMatch(/userId: lesson\.student_id/);
    expect((s.match(/for \(const sid of studentsOf\(lesson\)\)/g) ?? []).length,
      "дві гілки: нагадування перед уроком і прохання про відгук").toBe(2);
  });

  it("журнал дедупу завжди має student_id — інакше нагадування щоп'ять хвилин", () => {
    const s = f();
    /* `lesson_reminders.student_id` оголошений NOT NULL, а дедуп тримає
       UNIQUE(lesson_id, recipient_id, reminder_kind). Для групового уроку
       вставка падала, провал лише логувався — і репетитор отримував те саме
       нагадування кожні 5 хв до кінця вікна (до ~72 разів на добовому). */
    expect((s.match(/student_id: lesson\.student_id/g) ?? []).length,
      "жодна вставка в журнал більше не пише NULL").toBe(0);
    expect(s).toMatch(/const logStudentOf = \(l: any\): string \| null =>/);
    expect((s.match(/student_id: (?:preLogSid|logSid|sid)/g) ?? []).length,
      "чотири вставки в журнал").toBe(4);
    // Нема чим дедупити → не надсилаємо. Мовчання краще за спам.
    expect((s.match(/if \(!(?:preLogSid|logSid)\) continue;/g) ?? []).length).toBe(2);
  });
});

describe("нагадування про виплати: та сама сума, що в застосунку", () => {
  it("рахується лише ПРОВЕДЕНЕ з виплатою > 0 — канон isPayoutDueLesson", () => {
    const s = noComments(read("supabase/functions/payout-reminders/index.ts"));
    /* Стояв лише `.neq("status", "cancelled")`, тож у суму потрапляли заявки й
       майбутні уроки: Telegram казав менеджеру одне число, застосунок і кнопка
       «Виплатив(ла)» — інше, а платить він по тому, що прийшло першим. */
    expect(s).toMatch(/\.neq\("status", "pending"\)/);
    expect(s).toMatch(/l\.status === "completed" \|\| new Date\(l\.starts_at\)\.getTime\(\) <= nowMs/);
    expect(s, "виплата 0 = «ставку не задано», а не «нуль гривень»")
      .toMatch(/if \(payout <= 0\) continue;/);
  });
});

describe("Telegram: кнопка виплати не святкує раніше за базу", () => {
  it("гілка «Виплатив(ла)» доводить запис, як і сусідня гілка боргів", () => {
    const s = noComments(read("supabase/functions/telegram-poll/index.ts"));
    // Гілку боргів полагодили 18.09, а виплатну (13.09) не зачепили: менеджер
    // бачив зелене «Застосунок уже знає», репетитор лишався невиплаченим.
    expect((s.match(/if \(!wrote\) \{ await answerCb\(base, cqId, L\.writeFailed\); return; \}/g) ?? []).length,
      "обидві гілки, що пишуть гроші").toBe(3);
    expect(s).toMatch(/telegram-poll tpaid lesson_details/);
  });
});

describe("публічні двері: одна адреса не вимикає сервіс для всіх", () => {
  it("ліміти перевіряються послідовно — спільний лічильник останнім", () => {
    /* `rate_limit_check` записує спробу ДО вердикту, тож при паралельній
       перевірці вже заблокована адреса далі нарощувала платформений лічильник:
       501 дешевий запит з однієї машини вимикав читання Google Таблиці для всіх
       відвідувачів до кінця добового вікна. */
    for (const p of [
      "supabase/functions/import-sheet-fetch/index.ts",
      "supabase/functions/landing-find-tutor-quiz/index.ts",
    ]) {
      const s = noComments(read(p));
      expect(s, `${p}: паралельна перевірка лімітів`).not.toMatch(/await Promise\.all\(\[\s*\n?\s*rateLimit\(/);
      expect(s, `${p}: вердикти більше не збираються разом`).not.toMatch(/verdicts\.includes\("limit"\)/);
    }
  });
});

describe("учень може написати репетиторові навіть без жодного уроку", () => {
  it("пара не вгадується з чужих ролей — її підтверджує сервер", () => {
    const s = noComments(read("src/pages/ChatsPage.tsx"));
    /* Політики `user_roles` пускають лише свій рядок і менеджера, тож читання
       ролей співрозмовника ЗАВЖДИ віддавало порожньо: гілка не спрацьовувала,
       і функція тихо виходила без тосту. Для учня групового уроку це означало
       повну неможливість написати репетиторові (груповий урок має
       `student_id = NULL`, а рядка `student_rates` може не бути). */
    const nonManager = s.slice(s.indexOf("const myIsTutor = roles.includes"));
    expect(nonManager, "ролі співрозмовника тут не читаються")
      .not.toMatch(/from\("user_roles"\)/);
    expect(s).toMatch(/const tutorId = myIsTutor \? myId : withId;/);
    expect(s).toMatch(/const studentId = myIsTutor \? withId : myId;/);
    expect(s, "мовчазний вихід читався як «кнопка не працює»")
      .toMatch(/if \(match\) \{ setSelectedId\(match\.id\); return; \}/);
  });
});

describe("канонічна форма уроку не пише урок із невідомою персоною", () => {
  it("workspaceUnknown → відмова, бо source уроку НЕЗМІННИЙ", () => {
    const s = noComments(read("src/components/QuickLessonDialog.tsx"));
    /* `variant` сюди передає сторінка через `isHubTutor`, який при збої читання
       налаштувань вмикається для САМОСТІЙНОГО — і груповий урок писався з
       `source: "hub"`. Виправити такий урок уже неможливо (20260902170000). */
    expect(s).toMatch(/if \(workspaceUnknown\) \{ toast\.error\(t\("common\.workspaceUnknown"\)\); return; \}/);
    // Той самий охоронець давно стоїть у двох інших місцях запису.
    for (const p of ["src/pages/SchedulePage.tsx", "src/pages/GroupsPage.tsx"]) {
      expect(noComments(read(p)), `${p}`).toMatch(/if \(workspaceUnknown\)/);
    }
  });
});

describe("AI-конспект лишається чернеткою і після «закрив — відкрив»", () => {
  it("позначка відновлюється зі збереженого AI-тексту, а не з памʼяті вкладки", () => {
    const s = noComments(read("src/components/LessonWorkspace.tsx"));
    /* Текст від моделі переживав перемонтування через `useLocalDraft`, а
       прапорець `aiSuggested` — ні. Після повторного відкриття плашка «Створено
       AI — перевірте» зникала, охоронець у flush нічого не тримав, і «Готово»
       надсилало учневі неперечитаний текст моделі. */
    expect(s).toMatch(/const aiKey = lessonId \? `otutorhub\.aiDraft\.lesson\.\$\{lessonId\}\.summary` : null;/);
    expect(s, "позначка ставиться лише якщо чернетка ДОСЛІВНО дорівнює AI-тексту")
      .toMatch(/if \(saved && saved\.trim\(\) && summaryDraft === saved\) setAiSuggested\(true\);/);
    expect(s, "правка і явне збереження забувають AI-текст")
      .toMatch(/setAiSuggested\(false\); rememberAiText\(null\);/);
    expect(s, "охоронець у flush лишається на місці")
      .toMatch(/if \(!aiSuggested && summaryDraft !== \(summary \?\? ""\)\)/);
  });
});

describe("ворота db-sync читають власний журнал, а не розмітку таблиці", () => {
  /* 02.10: `main` став червоним не через продукт, а через `|` ВСЕРЕДИНІ лапок у
     журналі. Ворота різали рядок на клітинки як `[^|]*`, тож перевірка прав,
     написана як «→ `t | t`», зсувала статус у пʼяту клітинку, і ✅ не знаходився.
     Поки файл стояв вище водяного знаку, це нічого не ламало; коли знак переїхав
     через нього — ворота оголосили червоне на повністю живій базі. Саме той клас
     червоного, що вчить ігнорувати червоне. */
  const ledger = read("docs/PROD-DB-SYNC.md");
  const mask = (l: string) => l.replace(/`[^`]*`/g, (m) => "`" + "·".repeat(Math.max(0, m.length - 2)) + "`");

  it("кожен рядок таблиці журналу має рівно чотири колонки", () => {
    const rows = ledger.split("\n").filter((l) => /^\|/.test(l));
    expect(rows.length, "журнал не порожній").toBeGreaterThan(30);
    const bad = rows.filter((l) => mask(l).split("|").length !== 6);
    expect(bad.map((l) => l.slice(0, 60)), "незбалансована кількість | у рядку").toEqual([]);
  });

  it("скрипт маскує лапки перед розрізанням — інакше `t | t` знову зламає ворота", () => {
    const g = noComments(read("scripts/check-db-sync.mjs"));
    expect(g).toMatch(/const maskBackticks = \(line\) =>/);
    expect(g, "старої регулярки «четверта клітинка як \\[^|\\]*» більше нема")
      .not.toMatch(/\|\[\^\|\]\*\\\|\[\^\|\]\*/);
    expect(g).toMatch(/const rowIsLive = \(cells\) => \(cells\[4\] \?\? ""\)\.startsWith\("✅"\)/);
  });
});
