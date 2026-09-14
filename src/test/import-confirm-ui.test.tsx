/**
 * 13.09 — екран підтвердження імпорту наживо (jsdom + справжні uk-тексти):
 * людина вставляє три реальні рядки, бачить, що впізнано, і за три дотики
 * доводить гроші до правильних — без правки тексту.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ insert: () => Promise.resolve({ error: null }), upsert: () => Promise.resolve({ error: null }) }),
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "tutor-1" } }) }));
vi.mock("@/hooks/useCoreLock", () => ({ useCoreLock: () => ({ locked: false, openPaywall: vi.fn() }) }));
vi.mock("@/lib/analytics", () => ({ logEvent: vi.fn() }));

import { ImportStudentsSheet } from "@/components/ImportStudentsSheet";

const TEXT = "Маша — 600 — за минулий місяць 800\nСоня — борг 2 уроки\nДаша не оплатила вересень";

function setup() {
  render(<ImportStudentsSheet open onOpenChange={() => {}} />);
  const ta = screen.getByRole("textbox", { name: /Перенести все, що є/ });
  fireEvent.change(ta, { target: { value: TEXT } });
  return ta;
}

describe("екран підтвердження імпорту — інтерактивно", () => {
  it("показує, що впізнано, і питає про число, якого не зрозумів", () => {
    setup();
    expect(screen.getByText(/Перевірте — розпізнано: 3/)).toBeInTheDocument();
    expect(screen.getByText(/не впізнав: 1/)).toBeInTheDocument();
    expect(screen.getByText(/«минулий місяць 800» — що це\?/)).toBeInTheDocument();
    // варіанти відповіді — з числом із рядка, не вигаданим
    expect(screen.getByRole("button", { name: "борг 800 ₴" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ціна 800 ₴" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "просто нотатка" })).toBeInTheDocument();
  });

  it("три дотики: «це борг» · ціна для боргу уроками · сума для «не оплатила»", () => {
    setup();
    // 1) Маша: «за минулий місяць 800» — це борг
    fireEvent.click(screen.getByRole("button", { name: "борг 800 ₴" }));
    expect(screen.queryByText(/що це\?/)).toBeNull();
    // (Даша теж має чип «борг · сума?» з тим самим підписом — шукаємо за текстом)
    expect(screen.getAllByRole("button", { name: /Змінити: борг$/ }).some((b) => b.textContent?.includes("борг 800 ₴"))).toBe(true);

    // 2) Соня: борг 2 уроки без ціни → попередження; дотик на «без ціни» → 450
    expect(screen.getByText(/Борг уроками без ціни/)).toBeInTheDocument();
    const priceChips = screen.getAllByRole("button", { name: "Змінити: ціна" });
    const sonyaPrice = priceChips.find((b) => b.textContent?.includes("без ціни"))!;
    fireEvent.click(sonyaPrice);
    const input = screen.getByRole("textbox", { name: "Змінити: ціна" });
    fireEvent.change(input, { target: { value: "450" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByText(/Борг уроками без ціни/)).toBeNull();
    expect(screen.getAllByRole("button", { name: "Змінити: ціна" }).some((b) => b.textContent?.includes("ціна 450 ₴"))).toBe(true);

    // 3) Даша: «борг · сума?» → 1200
    const dashaChip = screen.getAllByRole("button", { name: /Змінити: борг$/ }).find((b) => b.textContent?.includes("сума?"))!;
    fireEvent.click(dashaChip);
    const dInput = screen.getByRole("textbox", { name: "Змінити: борг" });
    fireEvent.change(dInput, { target: { value: "1200" } });
    fireEvent.keyDown(dInput, { key: "Enter" });
    expect(screen.queryByText(/сума\?/)).toBeNull();

    // Підсумок під кнопкою: 800 + 2×450 + 1200 = 2 900
    expect(screen.getByText(/Борги: 2\s?900 ₴/)).toBeInTheDocument();
    expect(screen.queryByText(/не впізнав/)).toBeNull();
  });

  it("14.09: «математика на середу о 18:00» — урок без учня: питає, чий він, і доклеює слот до учня", () => {
    render(<ImportStudentsSheet open onOpenChange={() => {}} />);
    const ta = screen.getByRole("textbox", { name: /Перенести все, що є/ });
    fireEvent.change(ta, { target: { value: "тимур 2 передоплати\nтаня 500 грн борг\nматематика на середу о 18:00\nукраїнська у вівторок 10 ранку" } });
    // учнів — 2 (предмети не стали учнями), уроки без учня — окремим блоком
    expect(screen.getByText(/Перевірте — розпізнано: 2/)).toBeInTheDocument();
    expect(screen.queryByText(/не впізнав/)).toBeNull();
    expect(screen.getByText(/Уроки без учня — чий це урок\?/)).toBeInTheDocument();
    const pick = screen.getByRole("combobox", { name: "Математика · ср 18:00" });
    expect(screen.getByRole("combobox", { name: "Українська · вт 10:00" })).toBeInTheDocument();
    // без відповіді розклад нікому не приписаний
    expect(screen.queryByText(/Уроків на 4 тижні/)).toBeNull();
    // «чий це урок?» → таня: слот зʼявляється в її рядку, підсумок рахує 4 уроки за 4 тижні
    fireEvent.change(pick, { target: { value: "таня 500 грн борг" } });
    // («таня» є і в списку вибору — беремо рядок учениці, не <option>)
    const row = screen.getAllByText("таня").find((el) => el.tagName !== "OPTION")!.closest("div")!.parentElement!;
    expect(within(row).getByText(/ср 18:00/)).toBeInTheDocument();
    // предмет уроку не губиться: у тані предмета не було — тепер «математика»
    expect(within(row).getByText(/· математика/)).toBeInTheDocument();
    expect(screen.getByText(/Уроків на 4 тижні: 4/)).toBeInTheDocument();
    // «пропустити» — слот зникає з рядка, підсумок повертається
    fireEvent.change(pick, { target: { value: "__skip" } });
    expect(within(row).queryByText(/ср 18:00/)).toBeNull();
    expect(within(row).queryByText(/· математика/)).toBeNull();
    expect(screen.queryByText(/Уроків на 4 тижні/)).toBeNull();
  });

  it("14.09: урок з ІНШИМ предметом, ніж в учня, — предмет лишається в рядку нотаткою, а не зникає", () => {
    render(<ImportStudentsSheet open onOpenChange={() => {}} />);
    const ta = screen.getByRole("textbox", { name: /Перенести все, що є/ });
    fireEvent.change(ta, { target: { value: "Оля — англійська — 500\nматематика на середу о 18:00" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Математика · ср 18:00" }), { target: { value: "Оля — англійська — 500" } });
    const row = screen.getAllByText("Оля").find((el) => el.tagName !== "OPTION")!.closest("div")!.parentElement!;
    expect(within(row).getByText(/· англійська/)).toBeInTheDocument();
    expect(within(row).getByText(/📝 математика — ср 18:00/)).toBeInTheDocument();
  });

  it("правка рядка в тексті скидає правку до нього, решта лишається", () => {
    const ta = setup();
    fireEvent.click(screen.getByRole("button", { name: "борг 800 ₴" }));
    // змінюємо рядок Маші — правка до нього відпадає, питання повертається
    fireEvent.change(ta, { target: { value: TEXT.replace("800", "850") } });
    expect(screen.getByText(/«минулий місяць 850» — що це\?/)).toBeInTheDocument();
    const row = screen.getByText("Маша").closest("div")!.parentElement!;
    expect(within(row).queryByText(/борг 800/)).toBeNull();
  });
});
