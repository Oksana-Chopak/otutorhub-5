/**
 * Лендінг, хвиля 4 (12.09): живі лічильники, шерна картка без сум, один
 * «спробуй»-віджет замість двох.
 *
 *  - лічильники показуються ЛИШЕ коли цифри вже не соромні (пороги в коді);
 *    поки платформа маленька — на сторінці їх ніби й немає;
 *  - картка «мій тиждень» — рішення власниці 10.09: без грошей і без імен,
 *    лише кількості, дні, час і обіцянка продукту;
 *  - «Спробуй прямо зараз» дублював калькулятор — прибрано разом із ключами.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke } },
}));

import { LandingLiveStats, LIVE_STATS_MIN_LESSONS, LIVE_STATS_MIN_REMINDERS } from "@/components/landing/LandingLiveStats";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const src = (f: string) => readFileSync(join(root, f), "utf8");
const landing = src("src/pages/LandingPage.tsx");
const calc = src("src/components/landing/MoneyCalculator.tsx");
const card = src("src/lib/shareCard.ts");
const fn = src("supabase/functions/landing-spots-left/index.ts");

beforeEach(() => { invoke.mockReset(); });

describe("живі лічильники платформи", () => {
  it("нижче порогу — нічого не рендерять (маленькі цифри працюють проти продукту)", async () => {
    invoke.mockResolvedValue({ data: { stats: { lessonsCompleted30d: LIVE_STATS_MIN_LESSONS - 1, remindersSent30d: 500, tutors: 9 } } });
    const { container } = render(<LandingLiveStats />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("landing-spots-left"));
    expect(container.querySelector(".live-stats")).toBeNull();
  });
  it("обидва пороги досягнуто — показують число зустрічей і нагадувань", async () => {
    invoke.mockResolvedValue({ data: { stats: { lessonsCompleted30d: 1234, remindersSent30d: LIVE_STATS_MIN_REMINDERS, tutors: 40 } } });
    render(<LandingLiveStats />);
    const line = await screen.findByText(/зустрічі/);   // 1234 → «зустрічі» (few), роздільник тисяч — пробіл
    expect(line.textContent).toMatch(/1\s234/);
    expect(line.textContent).toMatch(new RegExp(`${LIVE_STATS_MIN_REMINDERS} оплат`));
  });
  it("помилка функції або відповідь без stats — тиша, а не зламаний герой", async () => {
    invoke.mockResolvedValue({ data: { spotsLeft: 3 }, error: null });
    const { container } = render(<LandingLiveStats />);
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(container.querySelector(".live-stats")).toBeNull();
  });
  it("змонтовані під CTA героя; функція віддає лише агрегати — жодних імен і сум", () => {
    expect(landing).toMatch(/<LandingLiveStats \/>/);
    expect(fn).toMatch(/lessonsCompleted30d/);
    expect(fn).toMatch(/remindersSent30d/);
    expect(fn).toMatch(/lesson_payment_reminders/);
    expect(fn).not.toMatch(/full_name|price|amount/);
  });
});

describe("картка «мій тиждень» — без сум і без імен", () => {
  it("вхід картки не має поля під гроші чи імена; рядки розкладу — лише день і час", () => {
    expect(card).not.toMatch(/amount|income|₴|uah/i);
    expect(card).toMatch(/scheduleLines: string\[\]/);
    // у калькуляторі рядок будується з дня тижня і часу — r.name сюди не потрапляє
    const body = calc.slice(calc.indexOf("const shareCard = async"), calc.indexOf("const [tgBusy"));
    expect(body).toMatch(/importStudents\.day\$\{wd\}/);
    expect(body).not.toMatch(/r\.name|debt|netDebt|formatPrice/);
    expect(body).toMatch(/landing_share_card/);
  });
  it("є кнопка з підказкою «без імен і сум», Web Share на телефоні, файл на десктопі", () => {
    expect(calc).toMatch(/landingShare\.cta/);
    expect(calc).toMatch(/landingShare\.hint/);
    expect(calc).toMatch(/nav\.canShare\?\.\(\{ files: \[file\] \}\)/);
    expect(calc).toMatch(/a\.download = "otutorhub-week\.png"/);
  });
});

describe("один «спробуй»-віджет", () => {
  it("LandingTryDemo прибрано разом із ключами tryDemo у всіх трьох мовах", () => {
    expect(existsSync(join(root, "src/components/LandingTryDemo.tsx"))).toBe(false);
    expect(landing).not.toMatch(/LandingTryDemo/);
    for (const l of ["uk", "en", "sv"]) expect(src(`src/i18n/locales/${l}.ts`), l).not.toMatch(/tryDemo:/);
  });
});
