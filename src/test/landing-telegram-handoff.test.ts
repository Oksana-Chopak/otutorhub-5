/**
 * Дайджест у Telegram ДО реєстрації (11.09, «вау»-пункт 2).
 *
 * Ланцюжок: калькулятор → create_landing_handoff (список + ГОТОВИЙ текст) →
 * deep-link бота /start lh_<токен> → бот пересилає дайджест і дає кнопку
 * «Створити акаунт» з тим самим токеном → реєстрація кладе токен у метадані →
 * тригер прив'язує chat_id до нового акаунта. Кожна ланка — тут, бо будь-яка
 * з них, зникнувши мовчки, робить кнопку на лендінгу брехнею.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { updateUser: vi.fn(() => Promise.resolve({ data: null, error: null })) }, rpc: vi.fn(() => Promise.resolve({})) },
}));
vi.mock("@/lib/analytics", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/metaPixel", () => ({ metaTrack: vi.fn() }));

import { rememberHandoffToken, peekHandoffToken, consumeLandingHandoff, HANDOFF_TOKEN_RE } from "@/lib/landingFunnel";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const src = (f: string) => readFileSync(join(root, f), "utf8");
const mig = src("supabase/migrations/20260911120000_landing_telegram_handoff.sql");
const poll = src("supabase/functions/telegram-poll/index.ts");
const calc = src("src/components/landing/MoneyCalculator.tsx");
const auth = src("src/pages/AuthPage.tsx");
const ob = src("src/components/OnboardingFlowB.tsx");

beforeEach(() => { localStorage.clear(); });

describe("токен естафети на клієнті", () => {
  it("запам'ятовується лише у формі lh_<32hex>; стирається разом з естафетою", () => {
    rememberHandoffToken("lh_" + "a".repeat(32));
    expect(peekHandoffToken()).toBe("lh_" + "a".repeat(32));
    consumeLandingHandoff();
    expect(peekHandoffToken()).toBeNull();
    rememberHandoffToken("javascript:alert(1)");
    expect(peekHandoffToken()).toBeNull();
    expect(HANDOFF_TOKEN_RE.test("lh_" + "0".repeat(31))).toBe(false);
  });
});

describe("міграція: сховище під токен без доступу анонімові напряму", () => {
  it("таблиця закрита, працюють лише DEFINER-RPC із лімітами", () => {
    expect(mig).toMatch(/CREATE TABLE IF NOT EXISTS public\.landing_handoffs/);
    expect(mig).toMatch(/REVOKE ALL ON public\.landing_handoffs FROM anon, authenticated/);
    expect(mig).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(mig).not.toMatch(/CREATE POLICY[^\n]*landing_handoffs/);
    for (const fn of ["create_landing_handoff(text, text, text)", "read_landing_handoff(text)", "landing_bot_username()"]) {
      expect(mig, fn).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO anon, authenticated`);
    }
    expect(mig).toMatch(/RATE_LIMITED/);
    expect(mig).toMatch(/md5\(trim\(_ip\)\)/);          // IP не зберігається — лише хеш
    expect(mig).toMatch(/interval '24 hours'/);          // список живе добу
    expect(mig).toMatch(/cron\.schedule\(\s*'landing-handoffs-cleanup'/);
  });
  it("реєстрація з токеном прив'язує Telegram і вмикає ранковий дайджест; помилка не ламає реєстрацію", () => {
    expect(mig).toMatch(/CREATE TRIGGER on_auth_user_created_landing_handoff\s+AFTER INSERT ON auth\.users/);
    expect(mig).toMatch(/raw_user_meta_data->>'landing_handoff'/);
    expect(mig).toMatch(/INSERT INTO public\.user_telegram_links \(user_id, chat_id, linked_at\)/);
    expect(mig).toMatch(/SET daily_digest_enabled = true/);
    expect(mig).toMatch(/EXCEPTION WHEN unique_violation/);
    expect(mig).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING/);
  });
  it("read_landing_handoff віддає лише список, лише до реєстрації й лише до строку", () => {
    const body = mig.slice(mig.indexOf("FUNCTION public.read_landing_handoff"), mig.indexOf("FUNCTION public.landing_bot_username"));
    expect(body).toMatch(/SELECT h\.list_text/);
    expect(body).toMatch(/h\.expires_at > now\(\) AND h\.user_id IS NULL/);
    expect(body).not.toMatch(/digest_text|chat_id/);
  });
});

describe("бот: /start lh_<токен> → дайджест + кнопка з тим самим токеном", () => {
  it("гілка існує, токен перевіряється формою, чужий chat_id не отримує список", () => {
    expect(poll).toMatch(/\/\^lh_\[0-9a-f\]\{32\}\$\/i\.test\(code\)/);
    expect(poll).toMatch(/h\.chat_id && h\.chat_id !== chatId/);
    expect(poll).toMatch(/escapeHtml\(String\(h\.digest_text\)\)/);
    expect(poll).toMatch(/\/auth\?signup=1&role=tutor&lh=\$\{encodeURIComponent\(token\)\}/);
  });
  it("ім'я бота кешується в базі, а вибірка стану не залежить від нової колонки", () => {
    expect(poll).toMatch(/\.select\('\*'\)/);
    expect(poll).toMatch(/getMe/);
    expect(poll).toMatch(/update\(\{ bot_username: username \}\)/);
  });
});

describe("клієнт: кнопка, посилання з бота, онбординг", () => {
  it("калькулятор передає список і ГОТОВИЙ текст дайджесту, ім'я бота бере з бази", () => {
    expect(calc).toMatch(/rpc\("create_landing_handoff", \{ _list: text, _digest: digestText, _lang: lang \}\)/);
    expect(calc).toMatch(/rpc\("landing_bot_username"\)/);
    expect(calc).toMatch(/rememberHandoffToken\(token\)/);
    expect(calc).toMatch(/landingCalc\.tgHint/); // про 24 години сказано вголос
  });
  it("сторінка входу читає ?lh= і кладе токен у реєстрацію", () => {
    expect(auth).toMatch(/searchParams\.get\("lh"\)/);
    expect(auth).toMatch(/rpc\("read_landing_handoff", \{ _token: lh \}\)/);
    expect(auth).toMatch(/landing_handoff: handoffToken/);
  });
  it("онбординг більше не шле боту user.id замість коду", () => {
    expect(ob).not.toMatch(/\?start=\$\{user\.id\}/);
    expect(ob).toMatch(/generate_telegram_link_code/);
  });
});
