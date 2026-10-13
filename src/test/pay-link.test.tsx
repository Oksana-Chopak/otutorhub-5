/**
 * 13.10 — нагадування БЕЗ акаунта учня (пре-мортем): магічне посилання на
 * публічну сторінку «борг · реквізити · Я оплатив(ла)», аркуш «Нагадати» з
 * двома шляхами (автоматично / переслати самому), посилання в автоматичних
 * нагадуваннях. Сторінка — без входу, тому тут вона тестується з підміненим
 * fetch до edge `pay-link`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildShareText, payLinkUrl, shareHref } from "@/lib/payLink";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// ── чиста логіка ────────────────────────────────────────────────────────────
describe("payLink: адреса, текст, месенджери", () => {
  const t = (k: string, v?: Record<string, unknown>) => {
    const m: Record<string, string> = {
      "payLink.shareGreet": `${v?.name}, нагадую про оплату 🙂`,
      "payLink.shareBody": `${v?.count} уроки — ${v?.sum}.`,
      "payLink.shareFrom": `— ${v?.tutor}`,
      "payLink.shareLinkLine": "Реквізити й кнопка «Я оплатив(ла)»:",
    };
    return m[k] ?? k;
  };
  it("адреса сторінки — /pay/<token>, без подвійних слешів", () => {
    expect(payLinkUrl("https://otutorhub.com/", TOKEN)).toBe(`https://otutorhub.com/pay/${TOKEN}`);
  });
  it("текст: привітання, уроки з сумою, від кого, посилання останнім рядком", () => {
    const text = buildShareText({ studentFirstName: "Оля", tutorName: "Ірина", lessons: 2, total: 1200, currencySymbol: "₴", url: `https://otutorhub.com/pay/${TOKEN}`, t });
    expect(text.split("\n")).toEqual([
      "Оля, нагадую про оплату 🙂",
      "2 уроки — 1200 ₴.",
      "— Ірина",
      "Реквізити й кнопка «Я оплатив(ла)»:",
      `https://otutorhub.com/pay/${TOKEN}`,
    ]);
  });
  it("Telegram отримує url і текст окремо; Viber/WhatsApp/SMS — увесь текст", () => {
    const text = `Оля, привіт\nhttps://otutorhub.com/pay/${TOKEN}`;
    const tg = new URL(shareHref("telegram", text));
    expect(tg.searchParams.get("url")).toBe(`https://otutorhub.com/pay/${TOKEN}`);
    expect(tg.searchParams.get("text")).toBe("Оля, привіт");
    expect(shareHref("viber", text)).toMatch(/^viber:\/\/forward\?text=/);
    expect(shareHref("whatsapp", text)).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(shareHref("sms", text)).toMatch(/^sms:\?&body=/);
    expect(decodeURIComponent(shareHref("whatsapp", text).split("text=")[1])).toBe(text);
  });
});

// ── публічна сторінка ───────────────────────────────────────────────────────
import PayLinkPage from "@/pages/PayLinkPage";

const view = {
  ok: true, tutor_name: "Ірина Репетитор", student_first_name: "Оля",
  lessons: [
    { date: "2026-10-06T15:00:00Z", subject: "Математика", amount: 500, currency: "UAH" },
    { date: "2026-10-09T15:00:00Z", subject: "Математика", amount: 500, currency: "UAH" },
  ],
  total: 1000, currency: "UAH", requisites: "Монобанк 5375 4141 0000 1234", pending_claim: false, can_register: true, lang: "uk",
};
const calls: Array<{ url: string; init?: RequestInit }> = [];
function mockFetch(getBody: unknown, postBody: unknown = { ok: true }) {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const body = init?.method === "POST" ? postBody : getBody;
    return { json: async () => body } as Response;
  }));
}
function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/pay/${TOKEN}`]}>
      <Routes><Route path="/pay/:token" element={<PayLinkPage />} /></Routes>
    </MemoryRouter>,
  );
}
beforeEach(() => { vi.unstubAllGlobals(); });

describe("публічна сторінка /pay/<token>", () => {
  it("показує, хто нагадує, уроки, суму, реквізити і запрошення створити акаунт", async () => {
    mockFetch(view);
    renderPage();
    expect(await screen.findByText("Привіт, Оля!")).toBeInTheDocument();
    expect(screen.getByText(/Ірина Репетитор нагадує про оплату/)).toBeInTheDocument();
    expect(screen.getAllByText(/500 ₴/)).toHaveLength(2);
    expect(screen.getByText("1000 ₴")).toBeInTheDocument();
    expect(screen.getByText("Монобанк 5375 4141 0000 1234")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Створити акаунт учня" })).toHaveAttribute("href", "/auth?signup=1&role=student");
    // GET пішов на pay-link з токеном
    expect(calls[0].url).toMatch(new RegExp(`/functions/v1/pay-link\\?t=${TOKEN}$`));
  });

  it("«Я оплатив(ла)»: сума підставлена з боргу, POST з токеном, потім подяка", async () => {
    mockFetch(view, { ok: true });
    renderPage();
    await screen.findByText("Привіт, Оля!");
    const amount = screen.getByRole("textbox", { name: "Сума" }) as HTMLInputElement;
    expect(amount.value).toBe("1000");
    fireEvent.change(screen.getByRole("textbox", { name: "Коментар" }), { target: { value: "з картки мами" } });
    fireEvent.click(screen.getByRole("button", { name: "Я оплатив(ла)" }));
    expect(await screen.findByText(/Дякуємо! Ірина Репетитор отримає повідомлення/)).toBeInTheDocument();
    const post = calls.find((c) => c.init?.method === "POST")!;
    expect(JSON.parse(String(post.init!.body))).toEqual({ token: TOKEN, amount: 1000, note: "з картки мами" });
  });

  it("заявка вже в очікуванні — кнопки немає, є статус", async () => {
    mockFetch({ ...view, pending_claim: true });
    renderPage();
    await screen.findByText("Привіт, Оля!");
    expect(screen.queryByRole("button", { name: "Я оплатив(ла)" })).toBeNull();
    expect(screen.getByText(/Ви вже повідомили про оплату/)).toBeInTheDocument();
  });

  it("мертве посилання — чесний текст, без форми", async () => {
    mockFetch({ ok: false, reason: "not_found" });
    renderPage();
    expect(await screen.findByText("Посилання вже не діє")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Я оплатив(ла)" })).toBeNull();
  });

  it("усе оплачено — святкуємо, форми немає", async () => {
    mockFetch({ ...view, lessons: [], total: 0 });
    renderPage();
    expect(await screen.findByText(/Усе оплачено — дякуємо!/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Я оплатив(ла)" })).toBeNull();
  });
});

// ── аркуш «Нагадати» ────────────────────────────────────────────────────────
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), functions: { invoke: vi.fn() } } }));
vi.mock("@/lib/analytics", () => ({ logEvent: vi.fn() }));
import { RemindSheet } from "@/components/RemindSheet";

const issue = { token: TOKEN, lessons: 2, total: 1200, currency: "UAH", telegram: false, email: false, has_requisites: true, student_first_name: "Оля", tutor_name: "Ірина" };

describe("аркуш «Нагадати» — автоматично або переслати самому", () => {
  beforeEach(() => { rpc.mockReset(); });

  it("учень без Telegram/пошти: автоматичної кнопки немає, є текст із посиланням і месенджери", async () => {
    rpc.mockResolvedValue({ data: issue, error: null });
    const onAutoSend = vi.fn();
    render(<RemindSheet open onOpenChange={() => {}} studentId="s1" studentName="Оля Коваль" onAutoSend={onAutoSend} />);
    expect(await screen.findByText("2 уроки · 1200 ₴")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("issue_payment_link", { _student_id: "s1", _tutor_id: null });
    expect(screen.queryByRole("button", { name: /Надіслати/ })).toBeNull();
    expect(screen.getByText(/В учня ще немає Telegram-бота чи пошти/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`https?://[^\\s]+/pay/${TOKEN}`))).toBeInTheDocument();
    for (const name of ["Telegram", "Viber", "WhatsApp", "SMS", "Скопіювати"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("є Telegram: кнопка «Надіслати в Telegram» викликає автоматичний шлях і закриває аркуш", async () => {
    rpc.mockResolvedValue({ data: { ...issue, telegram: true }, error: null });
    const onAutoSend = vi.fn();
    const onOpenChange = vi.fn();
    render(<RemindSheet open onOpenChange={onOpenChange} studentId="s1" studentName="Оля" onAutoSend={onAutoSend} />);
    fireEvent.click(await screen.findByRole("button", { name: "Надіслати в Telegram" }));
    expect(onAutoSend).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("пересилання у Viber відкриває deep link і лишає слід у журналі", async () => {
    rpc.mockResolvedValue({ data: issue, error: null });
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const onShared = vi.fn();
    render(<RemindSheet open onOpenChange={() => {}} studentId="s1" studentName="Оля" onAutoSend={() => {}} onShared={onShared} />);
    fireEvent.click(await screen.findByRole("button", { name: "Viber" }));
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^viber:\/\/forward\?text=/), "_blank", "noopener,noreferrer");
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("payment_link_shared", { _student_id: "s1", _tutor_id: null, _channel: "viber" }));
    expect(onShared).toHaveBeenCalled();
  });

  it("боргу немає — каже це словами і нічого не пропонує", async () => {
    rpc.mockResolvedValue({ data: { ...issue, lessons: 0, total: 0 }, error: null });
    render(<RemindSheet open onOpenChange={() => {}} studentId="s1" studentName="Оля" onAutoSend={() => {}} />);
    expect(await screen.findByText(/Оля нічого не винен/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Viber" })).toBeNull();
  });
});

// ── розтяжки ────────────────────────────────────────────────────────────────
describe("розтяжки: публічні двері й автоматичні нагадування", () => {
  it("edge pay-link — без JWT, з лімітами в базі, лише службові RPC", () => {
    const cfg = read("supabase/config.toml");
    expect(cfg).toMatch(/\[functions\.pay-link\]\n\s+verify_jwt = false/);
    const s = read("supabase/functions/pay-link/index.ts");
    expect(s).toMatch(/from "\.\.\/_shared\/rateLimit\.ts"/);
    expect((s.match(/rateLimit\(admin,/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(s).toMatch(/withErrorLog\("pay-link"/);
    expect(s).toMatch(/"payment_link_view"/);
    expect(s).toMatch(/"payment_link_claim"/);
    expect(s).toMatch(/\[0-9a-f\]\{64\}/);
  });
  it("міграція: посилання, заявка з посилання, FK на profiles, штраф гаситься гаманцем; сценарій 65 на місці", () => {
    const m = read("supabase/migrations/20261013120000_payment_links.sql");
    expect(m).toMatch(/CREATE TABLE IF NOT EXISTS public\.payment_links/);
    expect(m).toMatch(/REFERENCES public\.profiles\(id\) ON DELETE CASCADE/);
    expect(m).toMatch(/GRANT EXECUTE ON FUNCTION public\.payment_link_view\(text\) TO service_role/);
    expect(m).toMatch(/GRANT EXECUTE ON FUNCTION public\.payment_link_claim\(text, numeric, text\) TO service_role/);
    expect(m).toMatch(/OR ld\.is_cancellation_fee IS TRUE\)/);
    expect(read("scripts/db-replay/scenarios/65-payment-links.sql")).toMatch(/payment_link_claim\(tok, 750/);
  });
  it("автоматичні нагадування несуть посилання: ручне/Telegram-кнопка і крон про борг", () => {
    expect(read("supabase/functions/_shared/paymentReminder.ts")).toMatch(/payment_link_for_pair/);
    expect(read("supabase/functions/_shared/paymentReminder.ts")).toMatch(/payUrl: payUrl \|\| undefined/);
    expect(read("supabase/functions/payment-reminders/index.ts")).toMatch(/payment_link_for_pair/);
    expect(read("supabase/functions/_shared/transactional-email-templates/payment-reminder.tsx")).toMatch(/href=\{payUrl\}/);
  });
  it("кнопка «Нагадати» відкриває аркуш, а не шле наосліп", () => {
    const b = read("src/components/RemindDebtButton.tsx");
    expect(b).toMatch(/<RemindSheet/);
    expect(b).toMatch(/onClick=\{\(\) => \{ haptic\.tap\(\); setSheetOpen\(true\); \}\}/);
    expect(read("src/App.tsx")).toMatch(/<Route path="\/pay\/:token" element=\{<PayLinkPage \/>\} \/>/);
  });
  it("на публічній сторінці оплати немає банера про куки (він заступав «Я оплатив(ла)»)", () => {
    expect(read("src/App.tsx")).toMatch(/!location\.pathname\.startsWith\("\/pay\/"\) && <CookieConsent \/>/);
    // довгий токен у тексті для пересилання переноситься, а не вилазить за край аркуша
    expect(read("src/components/RemindSheet.tsx")).toMatch(/overflowWrap: "anywhere"/);
  });
});
