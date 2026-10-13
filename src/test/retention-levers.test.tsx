import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "@/i18n";

/**
 * Пакет C (13.10, пре-мортем): важелі утримання — «вау»-лічильник
 * (нагадано за вас · повернуто), Telegram одразу після імпорту з першим
 * дайджестом у мить підключення, iPhone «на головний екран», реферал після
 * першої підтвердженої заявки, версія Android для оновлення в Play.
 */
const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    functions: { invoke: vi.fn(async () => ({ data: { username: "oTutorHubBot" }, error: null })) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "t1" }, roles: ["tutor"] }) }));
vi.mock("@/lib/analytics", () => ({ logEvent: vi.fn() }));
const openExternal = vi.fn();
vi.mock("@/lib/openExternal", () => ({ openExternal: (...a: unknown[]) => openExternal(...a) }));

import { ReminderStatsLine } from "@/components/ReminderStatsLine";
import { TelegramNudgeSheet, tgNudgeSnoozed, snoozeTgNudge, TG_NUDGE_SNOOZE_DAYS } from "@/components/TelegramNudgeSheet";
import { shouldOfferHomeScreen } from "@/components/AddToHomeScreenCard";

describe("«вау»-лічильник: нагадано за вас · повернуто після нагадувань", () => {
  beforeEach(() => rpc.mockReset());

  it("рендериться лише коли нагадувань > 0; суми — з єдиного RPC tutor_reminder_stats", async () => {
    rpc.mockResolvedValue({ data: { reminded_times: 12, recovered_lessons: 6, recovered_sum: 4800, currency: "UAH" }, error: null });
    render(<ReminderStatsLine tutorId="t1" />);
    expect(await screen.findByText(/Нагадано за вас 12 разів/)).toBeInTheDocument();
    expect(screen.getByText(/повернуто 4.?800 ₴ після нагадувань/)).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("tutor_reminder_stats", { _tutor_id: "t1" });
  });

  it("0 нагадувань або бази ще немає — рядка немає (відсутнє рендериться як відсутнє)", async () => {
    rpc.mockResolvedValue({ data: { reminded_times: 0, recovered_lessons: 0, recovered_sum: 0, currency: "UAH" }, error: null });
    const { unmount } = render(<ReminderStatsLine tutorId="t1" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("reminder-stats")).toBeNull();
    unmount();
    rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    render(<ReminderStatsLine tutorId="t1" variant="hero" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("reminder-stats")).toBeNull();
  });

  it("стоїть у Фінансах (незалежний), на сторінці підписки (тріал і без підписки) і в тижневому дайджесті — НЕ на головному екрані", () => {
    expect(read("src/pages/FinancesPage.tsx")).toMatch(/<ReminderStatsLine tutorId=\{user\?\.id\} \/>/);
    expect((read("src/pages/SubscriptionPage.tsx").match(/<ReminderStatsLine tutorId=\{user\?\.id\} variant="hero" \/>/g) ?? []).length).toBe(2);
    expect(read("supabase/functions/tutor-weekly-digest/index.ts")).toMatch(/\(sb\.rpc as any\)\("tutor_reminder_stats", \{ _tutor_id: userId \}\)/);
    expect(read("src/pages/DashboardPage.tsx")).not.toMatch(/ReminderStatsLine/);
  });
});

describe("Telegram одразу після імпорту — один дотик, перший дайджест у мить підключення", () => {
  beforeEach(() => { rpc.mockReset(); openExternal.mockReset(); localStorage.clear(); });

  it("аркуш показує цифри імпорту, генерує код і відкриває бота; «Пізніше» — тиша на 14 днів", async () => {
    rpc.mockResolvedValue({ data: "AB12CD34", error: null });
    const onOpenChange = vi.fn();
    render(<TelegramNudgeSheet open onOpenChange={onOpenChange} students={7} debtTotal={2400} />);
    expect(await screen.findByText(/Учнів перенесено: 7, боргів на 2.?400 ₴/)).toBeInTheDocument();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("generate_telegram_link_code", { _user_id: "t1" }));
    fireEvent.click(screen.getByRole("button", { name: "Підключити Telegram" }));
    await waitFor(() => expect(openExternal).toHaveBeenCalled());
    expect(String(openExternal.mock.calls[0][0])).toMatch(/^https:\/\/t\.me\/oTutorHubBot\?start=AB12CD34$/);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(tgNudgeSnoozed()).toBe(false);
    snoozeTgNudge(1_000_000);
    expect(tgNudgeSnoozed(1_000_000 + (TG_NUDGE_SNOOZE_DAYS * 86_400_000) - 1)).toBe(true);
    expect(tgNudgeSnoozed(1_000_000 + TG_NUDGE_SNOOZE_DAYS * 86_400_000 + 1)).toBe(false);
  });

  it("«Мої учні» пропонує бота після імпорту лише без чату й без «пізніше»; бот у мить підключення шле знімок справ", () => {
    const p = read("src/pages/MyStudentsPage.tsx");
    expect(p).toMatch(/void offerTelegram\(r\.students, r\.debtTotal\)/);
    expect(p).toMatch(/if \(!user \|\| students <= 0 \|\| tgNudgeSnoozed\(\)\) return;/);
    expect(p).toMatch(/if \(data\?\.chat_id\) return;/);
    const poll = read("supabase/functions/telegram-poll/index.ts");
    expect(poll).toMatch(/await sendTg\(TG_BASE, chatId, await linkedWelcome\(supabase, link\.user_id\)\);/);
    expect(poll).toMatch(/\(supabase\.rpc as any\)\('tutor_snapshot', \{ _tutor_id: userId \}\)/);
    expect(poll).not.toMatch(/сповіщення про нові повідомлення в чатах oTutorHub/);
    expect(read("supabase/migrations/20261013150000_lifecycle_nudges.sql")).toMatch(/FUNCTION public\.tutor_snapshot\(_tutor_id uuid\)/);
  });
});

describe("iPhone «на головний екран» — лише Safari у браузері, лише поки не закрили", () => {
  const ios = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  it("умови показу", () => {
    expect(shouldOfferHomeScreen({ ua: ios, standalone: false, native: false, dismissed: false })).toBe(true);
    expect(shouldOfferHomeScreen({ ua: ios, standalone: true, native: false, dismissed: false })).toBe(false);
    expect(shouldOfferHomeScreen({ ua: ios, standalone: false, native: true, dismissed: false })).toBe(false);
    expect(shouldOfferHomeScreen({ ua: ios, standalone: false, native: false, dismissed: true })).toBe(false);
    expect(shouldOfferHomeScreen({ ua: ios.replace("Safari/604.1", "CriOS/120 Safari/604.1"), standalone: false, native: false, dismissed: false })).toBe(false);
    expect(shouldOfferHomeScreen({ ua: "Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36", standalone: false, native: false, dismissed: false })).toBe(false);
    expect(shouldOfferHomeScreen({ ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", standalone: false, native: false, dismissed: false })).toBe(false);
  });
  it("стоїть на головній в AppLayout, не на кожній сторінці", () => {
    expect(read("src/components/AppLayout.tsx")).toMatch(/\{isDashboard && <AddToHomeScreenCard \/>\}/);
  });
});

describe("реферал у момент радості та версія для Play", () => {
  it("перша підтверджена заявка → один раз тост «поділитися» з переходом у «Мої запрошення»", () => {
    const c = read("src/components/PaymentClaimsCard.tsx");
    expect(c).toMatch(/void offerReferralOnce\(claim\.tutor_id\);/);
    expect(c).toMatch(/\.eq\("status", "confirmed"\)\.limit\(2\)/);
    expect(c).toMatch(/data\.length !== 1\) return;/);
    expect(c).toMatch(/window\.location\.assign\("\/my-referrals"\)/);
    expect(read("src/App.tsx")).toMatch(/path="\/my-referrals"/);
  });
  it("Android: versionCode 5 / 1.0.4 — Play приймає лише вищий код", () => {
    const g = read("android/app/build.gradle");
    expect(g).toMatch(/versionCode 5\n/);
    expect(g).toMatch(/versionName "1\.0\.4"/);
  });
});
