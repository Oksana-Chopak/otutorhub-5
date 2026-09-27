import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  mondayOf,
  weeklyStreak,
  streakState,
  daysLeftInWeek,
  weekGoal,
  scheduledLeftThisWeek,
} from "@/lib/studentGamification";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Локальна дата → ISO, щоб тижнева математика читалась у тій самій зоні. */
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();
/** 2026: 21.09 — понеділок, 27.09 — неділя. */
const MON_21_09 = new Date(2026, 8, 21, 9).getTime();
const WED_23_09 = new Date(2026, 8, 23, 9).getTime();
const SUN_27_09 = new Date(2026, 8, 27, 9).getTime();

describe("серія учня: тижнева математика (§4 аудиту шляхів)", () => {
  it("порожня історія — нуль без вигадок", () => {
    expect(weeklyStreak([], WED_23_09)).toEqual({ current: 0, longest: 0, thisWeekCount: 0 });
  });

  it("три тижні поспіль, останній — цей: серія 3", () => {
    const s = weeklyStreak([at(2026, 9, 8), at(2026, 9, 15), at(2026, 9, 22)], WED_23_09);
    expect(s.current).toBe(3);
    expect(s.longest).toBe(3);
    expect(s.thisWeekCount).toBe(1);
  });

  it("поки тиждень НЕ скінчився, серія ще не обірвана: останній урок минулого тижня — серія жива", () => {
    /* Якби ми обнуляли серію в понеділок, людина відкривала б застосунок у
       вівторок і бачила «0» саме тоді, коли її ще можна врятувати уроком. */
    const s = weeklyStreak([at(2026, 9, 8), at(2026, 9, 15)], WED_23_09);
    expect(s.current).toBe(2);
    expect(s.thisWeekCount).toBe(0);
  });

  it("пропущений тиждень обриває серію, але рекорд лишається", () => {
    /* Тижні 24.08 · 31.08 · 07.09 поспіль (три), потім тиждень 14.09 пропущено,
       і один урок цього тижня (21.09). */
    const s = weeklyStreak([at(2026, 8, 25), at(2026, 9, 1), at(2026, 9, 8), at(2026, 9, 23)], WED_23_09);
    expect(s.current, "серія рахується від цього тижня назад і впирається в пропуск").toBe(1);
    expect(s.longest, "рекорд бачить давніший відрізок").toBe(3);
  });

  it("кілька уроків на тижні — це ОДИН тиждень серії, не три", () => {
    const s = weeklyStreak([at(2026, 9, 21), at(2026, 9, 23), at(2026, 9, 25)], WED_23_09);
    expect(s.current).toBe(1);
    expect(s.thisWeekCount).toBe(3);
  });

  it("МАЙБУТНІ тижні в серію не входять: позначений наперед урок нічого не доводить", () => {
    const s = weeklyStreak([at(2026, 9, 23), at(2026, 10, 5)], WED_23_09);
    expect(s.current).toBe(1);
    expect(s.longest).toBe(1);
  });

  it("сміттєва дата не ламає підрахунок", () => {
    const s = weeklyStreak(["не дата", at(2026, 9, 23)], WED_23_09);
    expect(s.current).toBe(1);
  });

  it("понеділок тижня рахується від місцевої дати", () => {
    expect(mondayOf(new Date(2026, 8, 27, 23))).toBe(mondayOf(new Date(2026, 8, 21, 0)));
  });
});

describe("стан серії: попередження лише коли є що робити", () => {
  const base = { current: 4, thisWeekCount: 0, scheduledLeftThisWeek: 0 };

  it("без серії — жодного попередження", () => {
    expect(streakState({ ...base, current: 0 })).toBe("none");
  });

  it("урок цього тижня вже був — усе гаразд", () => {
    expect(streakState({ ...base, thisWeekCount: 1 })).toBe("alive");
  });

  it("урок ще стоїть у розкладі — НЕ попереджаємо: робити нічого не треба", () => {
    /* Попередження без дії вчить ігнорувати попередження. Це головна межа
       важеля: тривога лише там, де людина справді може врятувати серію. */
    expect(streakState({ ...base, scheduledLeftThisWeek: 1 })).toBe("alive");
  });

  it("уроку не було і жодного не заплановано — ось тут попереджаємо", () => {
    expect(streakState(base)).toBe("atRisk");
  });

  it("днів до кінця тижня: неділя — один, понеділок — сім", () => {
    expect(daysLeftInWeek(SUN_27_09)).toBe(1);
    expect(daysLeftInWeek(MON_21_09)).toBe(7);
    expect(daysLeftInWeek(WED_23_09)).toBe(5);
  });
});

describe("ціль тижня: жодного вигаданого числа", () => {
  const lessons = [
    { id: "a", starts_at: at(2026, 9, 22), status: "completed" },
    { id: "b", starts_at: at(2026, 9, 25), status: "scheduled" },
    { id: "c", starts_at: at(2026, 9, 15), status: "completed" }, // минулий тиждень
    { id: "d", starts_at: at(2026, 9, 24), status: "cancelled" },
  ];

  it("ціль по уроках = те, що СПРАВДІ у розкладі цього тижня", () => {
    const g = weekGoal({ lessons, homeworkLessonIds: new Set(), homeworkDoneIds: new Set(), now: WED_23_09 });
    expect(g.lessonsDone).toBe(1);
    expect(g.lessonsTarget, "проведений + запланований; скасований і минулий не входять").toBe(2);
  });

  it("порожній тиждень дає ціль 0 — поверхня скаже словами, а не «0 з 1»", () => {
    const g = weekGoal({ lessons: [], homeworkLessonIds: new Set(), homeworkDoneIds: new Set(), now: WED_23_09 });
    expect(g.lessonsTarget).toBe(0);
    expect(read("src/components/student/StudentStreakCard.tsx"))
      .toMatch(/goal\.lessonsTarget === 0 \?[\s\S]{0,200}noLessonsThisWeek/);
  });

  it("домашка рахується лише там, де репетитор її задав", () => {
    const g = weekGoal({
      lessons,
      homeworkLessonIds: new Set(["a", "b", "c"]),
      homeworkDoneIds: new Set(["a", "c"]),
      now: WED_23_09,
    });
    expect(g.homeworkTarget, "лише уроки ЦЬОГО тижня з домашкою").toBe(2);
    expect(g.homeworkDone).toBe(1);
  });

  it("запланованим до кінця тижня вважається лише те, що ще НЕ минуло", () => {
    expect(scheduledLeftThisWeek(lessons, WED_23_09)).toBe(1);
    // у неділю 27.09 урок 25.09 уже позаду
    expect(scheduledLeftThisWeek(lessons, SUN_27_09)).toBe(0);
  });
});

describe("одна система замість трьох (§4 аудиту)", () => {
  it("третьої копії полиці нагород більше немає", () => {
    expect(existsSync(join(ROOT, "src/components/StudentRewardsShelf.tsx")),
      "StudentRewardsShelf був четвертим джерелом правди про нагороди").toBe(false);
    expect(read("src/pages/AchievementsPage.tsx"), "чистий учень іде на свою сторінку")
      .toMatch(/if \(isPureStudent\) return <Navigate to="\/student\/achievements" replace \/>;/);
  });

  it("хук гейміфікації учня один — старої назви в репо немає", () => {
    expect(existsSync(join(ROOT, "src/hooks/useStudentRewards.ts"))).toBe(false);
    for (const f of [
      "src/pages/student/StudentDashboardPage.tsx",
      "src/pages/student/StudentAchievementsPage.tsx",
    ]) expect(read(f)).toMatch(/useStudentGamification\(\)/);
  });

  it("серія й ціль рахуються з УЖЕ прочитаних уроків — без другого запиту", () => {
    const h = read("src/hooks/useStudentGamification.ts");
    expect(h, "уроки читаються один раз і віддають і ачівки, і серію")
      .toMatch(/\.from\("lessons"\)\.select\("id, starts_at, status"\)/);
    expect((h.match(/\.from\("lessons"\)/g) ?? []).length).toBe(1);
    expect(h, "позначки домашки — тим самим каноном, що на сторінці домашки")
      .toMatch(/fetchHomeworkDone\(user\.id\)/);
    expect(h).not.toMatch(/\.from\("homework_done"\)/);
  });

  it("дашборд показує число досягнень поруч із нагородами — дві системи зустрічаються", () => {
    expect(read("src/pages/student/StudentDashboardPage.tsx")).toMatch(/earnedAchievements=\{earnedAchievements\}/);
    expect(read("src/components/student/RewardCollection.tsx")).toMatch(/rewardCollection\.achievementsCount/);
  });

  it("тижнева математика не дублюється: картка бере готове з модуля", () => {
    const c = read("src/components/student/StudentStreakCard.tsx");
    expect(c).toMatch(/from "@\/lib\/studentGamification"/);
    expect(c, "жодного власного підрахунку тижнів у компоненті").not.toMatch(/86_?400_?000|getDay\(\)/);
  });
});

describe("свято за розблокування досягнення (§4 аудиту)", () => {
  const hook = () => read("src/hooks/useStudentAchievementCelebration.ts");

  it("святкуємо і тостом, і конфеті — тим самим каноном, що решта свят", () => {
    expect(hook()).toMatch(/burstConfetti\(\)/);
    expect(hook()).toMatch(/toast\.success\(/);
  });

  it("перший запуск на пристрої СИНХРОНІЗУЄТЬСЯ тихо — давні ачівки не спамлять", () => {
    expect(hook()).toMatch(/if \(!initialized\.current\) \{[\s\S]{0,400}return;/);
  });

  it("пачка від трьох згортається в одне повідомлення", () => {
    expect(hook()).toMatch(/fresh\.length >= 3/);
  });

  it("не святкуємо, поки читання не завершилось або впало: святкуємо лише збережене", () => {
    expect(hook()).toMatch(/if \(loading \|\| loadError \|\| achievements\.length === 0\) return;/);
  });

  it("ключ «побачених» — на КОРИСТУВАЧА, інакше другий акаунт на телефоні успадкує чужі", () => {
    expect(hook()).toMatch(/seen_student_achievements_v1\.\$\{userId \?\? "anon"\}/);
  });

  it("у дзвіночок тип несе КЛЮЧ ачівки — інакше дедуп на 24 години зʼїсть решту", () => {
    expect(hook()).toMatch(/type: `student_achievement_\$\{a\.def\.key\}`/);
  });

  it("святкують ОБИДВІ поверхні — дашборд і сторінка досягнень", () => {
    for (const f of [
      "src/pages/student/StudentDashboardPage.tsx",
      "src/pages/student/StudentAchievementsPage.tsx",
    ]) expect(read(f)).toMatch(/useStudentAchievementCelebration\(achievements,/);
  });
});

describe("картка серії: доступність і честність", () => {
  const card = () => read("src/components/student/StudentStreakCard.tsx");

  it("без жодного проведеного уроку картки немає — там веде перший урок, не гра", () => {
    expect(card()).toMatch(/if \(streak\.longest === 0\) return null;/);
  });

  it("дія «написати репетитору» — справжнє посилання і 44px висоти", () => {
    expect(card()).toMatch(/<Link\s*\n?\s*to="\/chats"/);
    expect(card()).toMatch(/h-11/);
  });

  it("жодного шрифту нижче 13px (інваріант ТЗ)", () => {
    const sizes = Array.from(card().matchAll(/fontSize: (\d+(?:\.\d+)?)/g)).map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(13);
    expect(card()).not.toMatch(/text-xs|text-\[1[0-2]px\]/);
  });

  it("«згорить сьогодні» — окремий стан, не той самий текст, що «у неділю»", () => {
    expect(card()).toMatch(/daysLeft <= 1 \? t\("studentStreak\.atRiskToday"\) : t\("studentStreak\.atRiskSunday"\)/);
  });
});
