/**
 * Картка серії учня — РЕНДЕР, не лише джерело.
 *
 * Джерельні ратчети ловлять відкат логіки, але не ловлять картки, яка впала в
 * ErrorBoundary через забутий імпорт або показує «0 з 1» там, де уроків немає.
 * Тут вона справді малюється в чотирьох станах — саме тих, у яких її побачить
 * живий учень.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StudentStreakCard } from "@/components/student/StudentStreakCard";
import type { StreakState, WeekGoal, WeeklyStreak } from "@/lib/studentGamification";

const at = (y: number, m: number, d: number, h = 9) => new Date(y, m - 1, d, h);

const show = (streak: WeeklyStreak, state: StreakState, goal: WeekGoal) =>
  render(
    <MemoryRouter>
      <StudentStreakCard streak={streak} state={state} goal={goal} />
    </MemoryRouter>,
  );

const goal = (o: Partial<WeekGoal> = {}): WeekGoal => ({
  lessonsDone: 1, lessonsTarget: 2, homeworkDone: 0, homeworkTarget: 0, ...o,
});

afterEach(() => { vi.useRealTimers(); });

describe("картка серії учня: рендер", () => {
  it("жива серія: число тижнів, ціль тижня і ЖОДНОЇ тривоги", () => {
    show({ current: 5, longest: 7, thisWeekCount: 1 }, "alive", goal());
    expect(screen.getByText("5 тижнів поспіль")).toBeInTheDocument();
    expect(screen.getByText(/рекорд 7/)).toBeInTheDocument();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(screen.queryByText(/згорить/), "тривоги там, де все гаразд, бути не може").toBeNull();
    expect(screen.queryByRole("link", { name: /Написати репетитору/ })).toBeNull();
  });

  it("серія під загрозою в середу: «згорить у неділю» + дія до репетитора", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at(2026, 9, 23)); // середа
    show({ current: 4, longest: 4, thisWeekCount: 0 }, "atRisk", goal({ lessonsDone: 0, lessonsTarget: 0 }));
    expect(screen.getByText("Серія згорить у неділю")).toBeInTheDocument();
    expect(screen.getByText(/Лишилось 5 днів/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Написати репетитору/ });
    expect(link).toHaveAttribute("href", "/chats");
  });

  it("у неділю текст інший — «згорить сьогодні»", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at(2026, 9, 27)); // неділя
    show({ current: 4, longest: 4, thisWeekCount: 0 }, "atRisk", goal({ lessonsDone: 0, lessonsTarget: 0 }));
    expect(screen.getByText("Серія згорить сьогодні")).toBeInTheDocument();
  });

  it("порожній тиждень каже словами, а не малює «0 з 1»", () => {
    show({ current: 2, longest: 2, thisWeekCount: 0 }, "atRisk", goal({ lessonsDone: 0, lessonsTarget: 0 }));
    expect(screen.getByText(/Цього тижня уроків ще немає/)).toBeInTheDocument();
    expect(screen.queryByText("0 / 1"), "вигаданої норми бути не може").toBeNull();
  });

  it("домашка показується лише коли репетитор її задав", () => {
    const { unmount } = show({ current: 1, longest: 1, thisWeekCount: 1 }, "alive", goal());
    expect(screen.queryByText("Домашка")).toBeNull();
    unmount();
    show({ current: 1, longest: 1, thisWeekCount: 1 }, "alive", goal({ homeworkTarget: 2, homeworkDone: 1 }));
    expect(screen.getByText("Домашка")).toBeInTheDocument();
  });

  it("без жодного проведеного уроку картки немає зовсім", () => {
    const { container } = show({ current: 0, longest: 0, thisWeekCount: 0 }, "none", goal({ lessonsDone: 0, lessonsTarget: 0 }));
    expect(container).toBeEmptyDOMElement();
  });
});
