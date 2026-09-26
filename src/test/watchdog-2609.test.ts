import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isPrepaidAheadLesson, isStudentDebtLesson, isExpectedPaymentLesson, type MoneyLesson } from "@/lib/financials";
import { isRetryableReadStatus, retryPauseMs } from "@/integrations/supabase/fetchWithTimeout";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const HOUR = 3600_000;
const base: MoneyLesson = {
  starts_at: new Date(Date.now() + 48 * HOUR).toISOString(),
  status: "scheduled",
  student_price: 500,
  tutor_payout: 300,
  student_payment_status: "paid",
  tutor_payout_status: "unpaid",
};

/* ───────────────────────────────────────────────────────────────────────────
   1. ПЕРЕДОПЛАТА, ЯКУ ВЖЕ РОЗКЛАЛИ ПО ДАТАХ (фідбек менеджера 26.09)
   «Бачу передоплати Ніни — 4 уроки. А Петро створив уроки Тимура наперед на
   жовтень-листопад, вони теж передоплачені, і цього я не бачу.»
   ─────────────────────────────────────────────────────────────────────────── */
describe("передоплата видима в обох станах (26.09)", () => {
  it("майбутній оплачений урок — передоплачений", () => {
    expect(isPrepaidAheadLesson(base)).toBe(true);
  });

  it("минулий оплачений урок — уже НЕ передоплата (він відбувся)", () => {
    expect(isPrepaidAheadLesson({ ...base, starts_at: new Date(Date.now() - HOUR).toISOString() })).toBe(false);
  });

  it("майбутній НЕоплачений — це очікуваний платіж, не передоплата", () => {
    const l = { ...base, student_payment_status: "unpaid" };
    expect(isPrepaidAheadLesson(l)).toBe(false);
    expect(isExpectedPaymentLesson(l)).toBe(true);
  });

  it("проведений і оплачений — ні передоплата, ні борг", () => {
    const l = { ...base, status: "completed", starts_at: new Date(Date.now() - HOUR).toISOString() };
    expect(isPrepaidAheadLesson(l)).toBe(false);
    expect(isStudentDebtLesson(l)).toBe(false);
  });

  it("скасований (у т.ч. перенесений борг зі штрафом) не стає «уроком наперед»", () => {
    expect(isPrepaidAheadLesson({ ...base, status: "cancelled", is_cancellation_fee: true })).toBe(false);
  });

  it("урок без ціни не рахується передоплаченим (нуль не є оплатою)", () => {
    expect(isPrepaidAheadLesson({ ...base, student_price: 0 })).toBe(false);
  });

  it("сторінка «Фінанси» рахує ОБА стани і не має другої правди", () => {
    const f = read("src/pages/FinancesPage.tsx");
    expect(f, "предикат спільний, не переписаний інлайном").toMatch(/isPrepaidAheadLesson\(l, nowMs\)/);
    expect(f, "у рядку передоплат мусить бути і залишок гаманця, і уроки наперед")
      .toMatch(/finances\.prepaidAheadShort/);
    expect(f, "пара лише з уроками наперед (залишок 0) теж мусить показуватись")
      .toMatch(/r\.lessons > 0 \|\| r\.amount > 0 \|\| r\.ahead > 0/);
  });

  it("гроші в рядку показуються у валюті пари, а не завжди в гривні", () => {
    const f = read("src/pages/FinancesPage.tsx");
    expect(f).toMatch(/formatPrice\(r\.amount, r\.currency \?\? "UAH"\)/);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
   2. ЛІМІТ ЗАПИТІВ НА IP — НЕ «ЗЛАМАНИЙ ЕКРАН»
   Ранок 26.09: хабовий репетитор бачив «Не вдалося завантажити» на /finances,
   учень не міг увійти за 45с. Клас той самий, що знайшов скан логів 16.09:
   тимчасова відмова читання (429/5xx) на спільному IP.
   ─────────────────────────────────────────────────────────────────────────── */
describe("тимчасова відмова читання лікується повтором (26.09)", () => {
  it("429 і 5xx — повторюємо; 400/401/404 — ні (це відповідь, а не затримка)", () => {
    expect(isRetryableReadStatus(429)).toBe(true);
    expect(isRetryableReadStatus(500)).toBe(true);
    expect(isRetryableReadStatus(503)).toBe(true);
    for (const s of [200, 204, 400, 401, 403, 404, 406, 409]) expect(isRetryableReadStatus(s)).toBe(false);
  });

  it("Retry-After поважаємо, але не даємо екрану застигнути (стеля 2с)", () => {
    expect(retryPauseMs("1", 0)).toBe(1000);
    expect(retryPauseMs("60", 0)).toBe(2000);
    expect(retryPauseMs(null, 0)).toBe(400);
    expect(retryPauseMs(null, 1)).toBe(800);
    expect(retryPauseMs("не-число", 0)).toBe(400);
  });

  it("повторюються лише читання, і НІКОЛИ не /auth/v1/ (там ліміт лікує supabase-js)", () => {
    const f = read("src/integrations/supabase/fetchWithTimeout.ts");
    expect(f).toMatch(/const isAuth = url\.includes\("\/auth\/v1\/"\)/);
    expect(f).toMatch(/\(method === "GET" \|\| method === "HEAD"\) && !isAuth \? READ_ATTEMPTS : 1/);
    expect(f, "мутації не ретраяться — повторний POST міг би записати оплату двічі")
      .not.toMatch(/method === "POST".*READ_ATTEMPTS/s);
  });

  it("персона: запит налаштувань має власні ретраї — без персони «Фінанси» кажуть «Не вдалося завантажити»", () => {
    const w = read("src/hooks/useWorkspaceSettings.tsx");
    expect(w).toMatch(/retry: 3/);
    expect(w).toMatch(/retryDelay:/);
    expect(w, "стан «не знаю персону» лишається чесним").toMatch(/workspaceUnknown = enabled && !loading && !settings/);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
   3. РОЛІ: ОДИН НЕВДАЛИЙ ЗАПИТ НЕ ЛИШАЄ ЛЮДИНУ НА СПІНЕРІ
   Саме це впало в робота: учень увійшов, а застосунок не перейшов на дашборд
   (Index тримає напис «готуємо кабінет», поки roles порожні).
   ─────────────────────────────────────────────────────────────────────────── */
describe("читання ролей витримує зрив звʼязку (26.09)", () => {
  it("fetchRoles повторює спроби, а не здається після першої", () => {
    const a = read("src/hooks/useAuth.tsx");
    expect(a).toMatch(/ROLE_RETRY_DELAYS_MS/);
    expect(a).toMatch(/if \(attempt < ROLE_RETRY_DELAYS_MS\.length\)/);
    expect(a, "попередні ролі зберігаються — збій читання ≠ «ролей немає» (B10)")
      .toMatch(/keeping previous roles/);
  });

  it("після всіх спроб стан названий словом, і його видно сторінці", () => {
    const a = read("src/hooks/useAuth.tsx");
    expect(a).toMatch(/setRolesUnreadable\(true\)/);
    expect(a).toMatch(/rolesUnreadable: boolean/);
    const idx = read("src/pages/Index.tsx");
    expect(idx).toMatch(/rolesUnreadable \? "index\.rolesUnreadable" : "index\.rolePending"/);
  });

  it("успішне читання знімає прапорець (інакше напис залипне назавжди)", () => {
    const a = read("src/hooks/useAuth.tsx");
    expect(a).toMatch(/setRolesUnreadable\(false\);\s*\n\s*setRoles\(/);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
   4. СТОРОЖ НАЗИВАЄ ПРИЧИНУ, А НЕ СИМПТОМ
   ─────────────────────────────────────────────────────────────────────────── */
describe("робот-сторож: діагноз замість симптому (26.09)", () => {
  const spec = () => read("tests/prod/smoke.spec.ts");

  it("verify_jwt=true → проба лише з ключем (кінець хибної тривоги remind-payment)", () => {
    const toml = read("supabase/config.toml");
    // Той самий розбір, що й у спеку: блок функції в config.toml.
    const jwtOf = (fn: string) => /verify_jwt\s*=\s*true/.test(
      (new RegExp(`\\[functions\\.${fn}\\][^\\[]*`, "m").exec(toml) ?? [""])[0],
    );
    expect(jwtOf("remind-payment"), "саме вона щодня звучала як «застаріла»").toBe(true);
    expect(jwtOf("payment-reminders")).toBe(false);
    const sp = spec();
    expect(sp).toMatch(/JWT_PROTECTED/);
    expect(sp, "ключ беремо з секрету або з самої збірки — він публічний").toMatch(/findAnonKey/);
    expect(sp, "без ключа функція «не перевірена», а не «застаріла»").toMatch(/unverifiable/);
  });

  it("провал несе те, що бачив робот: екран, тости, відповіді бази", () => {
    const sp = spec();
    expect(sp).toMatch(/async function diagnose/);
    expect(sp).toMatch(/повідомлення на екрані/);
    expect(sp).toMatch(/збій бази\/edge/);
  });

  it("429 названий лімітом на IP, а не поломкою екрана", () => {
    const sp = spec();
    expect(sp).toMatch(/if \(s === 429\) w\.rateLimited\.push\(line\)/);
    expect(sp).toMatch(/прод обмежував частоту/);
  });

  it("вхід: «прод відмовив» (429 або 400) відрізняється від «застрягли без ролі»", () => {
    const sp = spec();
    expect(sp).toMatch(/authStatuses/);
    expect(sp).toMatch(/прод відмовив у вході/);
    expect(sp, "гіпотеза «user_roles порожній» лишається — саме її полагоджено ретраями")
      .toMatch(/застрягли на головній/);
  });

  it("персони ходять по черзі — робот більше не створює лімітів, про які звітує", () => {
    expect(read("playwright.prod.config.ts")).toMatch(/workers: 1/);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
   5. СКРИНЬКА ЗВЕРНЕНЬ ВІДПОВІДАЄ (живий випадок 14.09, полагоджено 26.09)
   ─────────────────────────────────────────────────────────────────────────── */
describe("на звернення можна відповісти (26.09)", () => {
  const page = () => read("src/pages/FeedbackInboxPage.tsx");

  it("сторінка кличе RPC і оновлює картку лише після успіху", () => {
    const p = page();
    expect(p).toMatch(/answer_feedback/);
    expect(p, "спершу перевіряємо результат, потім малюємо «відповіджено»")
      .toMatch(/if \(res\.error \|\| !res\.data\?\.ok\)/);
    expect(p).toMatch(/status: "resolved" as Status, answer: sentText/);
  });

  it("анонімне звернення не вдає доставку", () => {
    const p = page();
    expect(p).toMatch(/res\.data\?\.delivered === false/);
    expect(p).toMatch(/feedbackInbox\.answerAnonymous/);
  });

  it("запит скриньки читає `*` — нові колонки не ламають екран до міграції", () => {
    expect(page()).toMatch(/\.from\("feedback_submissions"\)\s*\n[\s\S]{0,400}?\.select\("\*"\)/);
  });

  it("форма — нижній аркуш (канон дизайну), кнопки з зоною дотику 44+", () => {
    const p = page();
    expect(p).toMatch(/rounded-t-\[20px\] rounded-b-none sm:rounded-\[20px\]/);
    expect(p).toMatch(/height: 44/);
    expect(p).toMatch(/height: 50/);
  });

  it("є готовий текст про чат підтримки — він описує РЕАЛЬНИЙ шлях у застосунку", () => {
    const uk = read("src/i18n/locales/uk.ts");
    expect(uk).toMatch(/answerTemplateSupport: "Так, чат підтримки є/);
    expect(uk, "шлях: меню → Допомога → Чат підтримки").toMatch(/«Допомога» → «Чат підтримки»/);
    const sidebar = read("src/components/AppSidebar.tsx");
    expect(sidebar, "цей шлях мусить існувати").toMatch(/nav\.supportChat/);
  });

  it("міграція: відповідь пишеться лише через RPC, і вона ж надсилає сповіщення", () => {
    const m = read("supabase/migrations/20260926120000_answer_feedback.sql");
    expect(m).toMatch(/CREATE OR REPLACE FUNCTION public\.answer_feedback/);
    expect(m).toMatch(/INSERT INTO public\.notifications/);
    expect(m, "скоуп дослівно як у політик читання скриньки")
      .toMatch(/has_role\(auth\.uid\(\), 'manager'::app_role\) AND public\.is_superadmin\(\)/);
    expect(m, "тригер тримає інваріант «відповідь без сповіщення неможлива»")
      .toMatch(/guard_feedback_answer_writes/);
    expect(m, "таймстемп вище водяного знаку Lovable (20260924151830)").toBeTruthy();
    const scen = read("scripts/db-replay/scenarios/70-answer-feedback.sql");
    expect(scen).toMatch(/ROLLBACK;\s*$/);
    expect(scen, "друга відповідь за добу мусить доходити").toMatch(/друга відповідь за добу не дійшла/);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
   6. ПОВЕДІНКА ОБГОРТКИ НА ЖИВИХ ВІДПОВІДЯХ (не лише по джерелу)
   ─────────────────────────────────────────────────────────────────────────── */
describe("обгортка fetch: 429 на читанні лікується сама", () => {
  const realFetch = globalThis.fetch;
  // jsdom не має AbortSignal.timeout/any (у браузерах і Node 22 вони є) — підміняємо
  // на нейтральні, щоб перевіряти ПОВТОРИ, а не поліфіл середовища.
  const AS = AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal; any?: (s: AbortSignal[]) => AbortSignal };
  const realTimeout = AS.timeout; const realAny = AS.any;
  beforeEach(() => {
    vi.useFakeTimers();
    if (typeof realTimeout !== "function") AS.timeout = () => new AbortController().signal;
    if (typeof realAny !== "function") AS.any = (list: AbortSignal[]) => list[0];
  });
  afterEach(() => {
    vi.useRealTimers(); globalThis.fetch = realFetch;
    AS.timeout = realTimeout; AS.any = realAny;
  });

  it("перше читання 429, друге 200 → викликач бачить 200", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: any, init?: any) => {
      calls.push(String(init?.method ?? "GET"));
      return calls.length === 1
        ? new Response("{}", { status: 429, headers: { "retry-after": "1" } })
        : new Response('{"ok":true}', { status: 200 });
    }) as any;
    const { fetchWithTimeout } = await import("@/integrations/supabase/fetchWithTimeout");
    const p = fetchWithTimeout("https://x.supabase.co/rest/v1/lessons?select=id");
    await vi.advanceTimersByTimeAsync(1200);
    const res = await p;
    expect(res.status).toBe(200);
    expect(calls.length).toBe(2);
  });

  it("POST із 429 НЕ повторюється (оплата не пишеться двічі)", async () => {
    let n = 0;
    globalThis.fetch = vi.fn(async () => { n += 1; return new Response("{}", { status: 429 }); }) as any;
    const { fetchWithTimeout } = await import("@/integrations/supabase/fetchWithTimeout");
    const res = await fetchWithTimeout("https://x.supabase.co/rest/v1/lesson_details", { method: "POST", body: "{}" });
    expect(res.status).toBe(429);
    expect(n).toBe(1);
  });
});
