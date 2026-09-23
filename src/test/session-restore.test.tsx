/**
 * 23.09 (скан Lovable): «розклад і профіль падають з permission denied рівно
 * тоді, коли оновлення токена впирається в ліміт». supabase-js на 429 від
 * /auth/v1/token стирає сесію і шле SIGNED_OUT; людина, яка нічого не робила,
 * опиняється на сторінці входу через ліміт, який мине за хвилини.
 *
 * Тут — поведінковий тест AuthProvider із підміненим клієнтом Supabase:
 *  · несподіваний SIGNED_OUT НЕ чистить користувача одразу — спершу тиха спроба
 *    setSession зі старими токенами;
 *  · вдалося → людина лишається в застосунку, жодного тосту;
 *  · токен мертвий (не тимчасова помилка) → чесний вихід;
 *  · явний вихід кнопкою відновлення не запускає.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

type Listener = (event: string, session: unknown) => void;
const mock = vi.hoisted(() => ({
  listener: null as Listener | null,
  setSession: vi.fn<(tokens: unknown) => Promise<{ data: { session: unknown }; error: unknown }>>(),
  signOut: vi.fn<(opts?: unknown) => Promise<{ error: null }>>(async () => ({ error: null })),
  toastError: vi.fn<(...a: unknown[]) => void>(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: Listener) => {
        mock.listener = cb;
        return { data: { subscription: { unsubscribe: () => { mock.listener = null; } } } };
      },
      getSession: async () => ({ data: { session: null }, error: null }),
      setSession: (tokens: unknown) => mock.setSession(tokens),
      signOut: (opts?: unknown) => mock.signOut(opts),
      refreshSession: async () => ({ data: { session: null }, error: null }),
    },
    from: () => ({ select: () => ({ eq: async () => ({ data: [{ role: "tutor" }], error: null }) }) }),
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => mock.toastError(...a), success: vi.fn() } }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { RESTORE_DELAYS_MS } from "@/integrations/supabase/sessionExpiry";

function Probe() {
  const { user } = useAuth();
  return <div data-testid="who">{user ? `user:${user.id}` : "anon"}</div>;
}

const SESSION = { access_token: "a1", refresh_token: "r1", expires_at: 0, user: { id: "u1" } };

describe("відновлення сесії після тимчасового збою оновлення (23.09)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mock.setSession.mockReset();
    mock.signOut.mockClear();
    mock.toastError.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function mountSignedIn() {
    render(<AuthProvider><Probe /></AuthProvider>);
    // спершу дати відпрацювати початковому getSession() (він порожній), потім — вхід
    await act(async () => { await Promise.resolve(); });
    await act(async () => { mock.listener!("SIGNED_IN", SESSION); });
    expect(screen.getByTestId("who").textContent).toBe("user:u1");
  }

  it("несподіваний SIGNED_OUT → людина лишається; через паузу йде setSession зі старими токенами; вдалося → без тосту", async () => {
    await mountSignedIn();
    mock.setSession.mockImplementation(async () => {
      // сервер повернув сесію — supabase-js сам надішле SIGNED_IN
      mock.listener!("SIGNED_IN", { ...SESSION, access_token: "a2", refresh_token: "r2" });
      return { data: { session: SESSION }, error: null };
    });

    await act(async () => { mock.listener!("SIGNED_OUT", null); });
    // одразу після SIGNED_OUT — ще не вигнали
    expect(screen.getByTestId("who").textContent).toBe("user:u1");
    expect(mock.setSession).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(RESTORE_DELAYS_MS[0] + 10); });
    expect(mock.setSession).toHaveBeenCalledTimes(1);
    expect(mock.setSession).toHaveBeenCalledWith({ access_token: "a1", refresh_token: "r1" });
    expect(screen.getByTestId("who").textContent).toBe("user:u1");
    expect(mock.toastError).not.toHaveBeenCalled();
  });

  it("ліміт ще діє на першій спробі (429) → друга спроба пізніше; вдалася → людина в застосунку", async () => {
    await mountSignedIn();
    mock.setSession
      .mockImplementationOnce(async () => ({ data: { session: null }, error: { status: 429, message: "Request rate limit reached" } }))
      .mockImplementationOnce(async () => {
        mock.listener!("SIGNED_IN", { ...SESSION, access_token: "a3", refresh_token: "r3" });
        return { data: { session: SESSION }, error: null };
      });

    await act(async () => { mock.listener!("SIGNED_OUT", null); });
    await act(async () => { await vi.advanceTimersByTimeAsync(RESTORE_DELAYS_MS[0] + 10); });
    expect(mock.setSession).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("who").textContent, "після першої невдалої спроби ще не виганяємо").toBe("user:u1");
    await act(async () => { await vi.advanceTimersByTimeAsync(RESTORE_DELAYS_MS[1] + 10); });
    expect(mock.setSession).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("who").textContent).toBe("user:u1");
    expect(mock.toastError).not.toHaveBeenCalled();
  });

  it("refresh-токен мертвий (не тимчасова помилка) → чесний вихід із тостом, без другої спроби", async () => {
    await mountSignedIn();
    mock.setSession.mockImplementation(async () => ({ data: { session: null }, error: { status: 400, code: "refresh_token_not_found", message: "Invalid Refresh Token" } }));

    await act(async () => { mock.listener!("SIGNED_OUT", null); });
    await act(async () => { await vi.advanceTimersByTimeAsync(RESTORE_DELAYS_MS[0] + 10); });
    expect(mock.setSession).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("who").textContent).toBe("anon");
    expect(mock.toastError).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(RESTORE_DELAYS_MS[1] + 10); });
    expect(mock.setSession, "мертвий токен не мучимо повторно").toHaveBeenCalledTimes(1);
  });

  it("явний вихід кнопкою → одразу anon, без спроб відновлення", async () => {
    let ctxSignOut: (() => Promise<void>) | null = null;
    function Grab() { ctxSignOut = useAuth().signOut; return null; }
    render(<AuthProvider><Probe /><Grab /></AuthProvider>);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { mock.listener!("SIGNED_IN", SESSION); });
    mock.signOut.mockImplementation(async () => { mock.listener!("SIGNED_OUT", null); return { error: null }; });

    await act(async () => { await ctxSignOut!(); });
    expect(screen.getByTestId("who").textContent).toBe("anon");
    await act(async () => { await vi.advanceTimersByTimeAsync(RESTORE_DELAYS_MS[0] + RESTORE_DELAYS_MS[1] + 100); });
    expect(mock.setSession).not.toHaveBeenCalled();
  });
});
