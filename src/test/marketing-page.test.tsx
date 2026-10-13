import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@/i18n";

/**
 * Адмінка «Розсилки» після 13.10: канали пошта/Telegram, окремий текст для
 * Telegram, шаблон «оновлення застосунку», зведення автоматичного ланцюжка,
 * історія з лічильниками по каналах. Рендер зі змокованою базою — щоб жодна
 * з нових кнопок не впала на проді, як це бувало з «зеленими» воротами.
 */
const rpc = vi.fn();
const invoke = vi.fn();
const campaigns: unknown[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => ({
      select: () => ({ order: () => ({ limit: async () => ({ data: campaigns, error: null }) }) }),
    }),
  },
}));
vi.mock("@/hooks/useConfirm", () => ({ confirmDialog: vi.fn(async () => true) }));
import MarketingPage from "@/pages/MarketingPage";

const renderPage = () => render(<MemoryRouter><MarketingPage /></MemoryRouter>);

describe("адмінка розсилок — пошта й Telegram", () => {
  beforeEach(() => {
    rpc.mockReset(); invoke.mockReset(); campaigns.length = 0;
    rpc.mockResolvedValue({ data: [{ kind: "welcome", count: 4, last_at: "2026-10-13T08:00:00Z" }, { kind: "trial_2_left", count: 1, last_at: null }], error: null });
  });

  it("зведення ланцюжка читається з lifecycle_summary і показує кроки з лічильниками", async () => {
    renderPage();
    expect(await screen.findByText("Привітання (день 0)")).toBeInTheDocument();
    expect(screen.getByText(/4 повідомлення/)).toBeInTheDocument();
    expect(screen.getByText("Тріал: 2 дні")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("lifecycle_summary", { _days: 30 });
  });

  it("шаблон «оновлення застосунку» заповнює тему, лист і Telegram-текст; надсилання йде з каналами", async () => {
    invoke.mockResolvedValue({ data: { campaignId: "c1", count: 12, telegram: 5, channels: ["email", "telegram"] }, error: null });
    renderPage();
    await screen.findByText("Привітання (день 0)");
    fireEvent.click(screen.getByRole("button", { name: /Шаблон: оновлення застосунку/ }));
    const subject = screen.getByLabelText("Тема листа") as HTMLInputElement;
    expect(subject.value).toContain("Що нового в oTutorHub");
    const tg = screen.getByLabelText("Текст для Telegram") as HTMLTextAreaElement;
    expect(tg.value).toContain("Нагадування без акаунта учня");
    expect(tg.value).not.toMatch(/<[a-z]/i);
    fireEvent.click(screen.getByRole("button", { name: /^Надіслати$/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    const body = (invoke.mock.calls[0][1] as { body: Record<string, unknown> }).body;
    expect(body.channels).toEqual(["email", "telegram"]);
    expect(body.segment).toBe("all_independent");
    expect(String(body.telegramText)).toContain("Нагадування без акаунта учня");
    expect(body.dryRun).toBe(false);
  });

  it("без жодного каналу надсилання не йде; «Порахувати» показує і число з Telegram", async () => {
    invoke.mockResolvedValue({ data: { count: 20, telegram: 7, sample: [] }, error: null });
    renderPage();
    await screen.findByText("Привітання (день 0)");
    fireEvent.click(screen.getByRole("button", { name: /Порахувати одержувачів/ }));
    expect(await screen.findByText(/✈ 7/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Пошта/));
    fireEvent.click(screen.getByLabelText(/Telegram-бот/));
    invoke.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /^Надіслати$/ }));
    await new Promise((r) => setTimeout(r, 30));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("історія показує лічильники по каналах, а старі розсилки без колонок — як пошту", async () => {
    campaigns.push(
      { id: "a", subject: "Нове", segment: "pro_active", html_body: "<p>x</p>", recipients_total: 10, recipients_sent: 9, recipients_failed: 1, status: "completed", created_at: "2026-10-13T08:00:00Z", errors: [], channels: ["email", "telegram"], telegram_text: "Нове в боті", telegram_sent: 4, telegram_failed: 0 },
      { id: "b", subject: "Старе", segment: "trial", html_body: "<p>y</p>", recipients_total: 3, recipients_sent: 3, recipients_failed: 0, status: "completed", created_at: "2026-09-01T08:00:00Z", errors: null },
    );
    renderPage();
    expect(await screen.findByText("Нове")).toBeInTheDocument();
    expect(screen.getByText(/✉ 9\/10 · ✈ 4/)).toBeInTheDocument();
    expect(screen.getByText(/✉ 3\/3/)).toBeInTheDocument();
    expect(screen.getByText(/• Активна підписка/)).toBeInTheDocument();
  });
});
