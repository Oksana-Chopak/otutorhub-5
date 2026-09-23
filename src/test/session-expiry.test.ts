import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hasStoredSession,
  looksLikeExpiredSession,
  onSessionExpired,
  reportSessionExpired,
  resetSessionExpiry,
  isTransientAuthError,
  RESTORE_DELAYS_MS,
} from "@/integrations/supabase/sessionExpiry";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * 16.09, скан живих логів: «розклад і профіль репетитора відповідають permission
 * denied рівно в ті моменти, коли оновлення токена впирається в ліміт». Це
 * протухла сесія: браузер далі ходить у базу зі старим токеном, сторінка ловить
 * помилку й малює ПОРОЖНЮ. Людина бачить не «увійдіть ще раз», а зниклі уроки —
 * і думає, що втратила дані.
 */
describe("протухла сесія (16.09)", () => {
  beforeEach(() => {
    resetSessionExpiry();
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  describe("що вважається протухлою сесією", () => {
    it("401 на даних — так", () => {
      expect(looksLikeExpiredSession("https://x.supabase.co/rest/v1/lessons?select=id", 401)).toBe(true);
    });

    it("401 на edge-функції — теж так", () => {
      expect(looksLikeExpiredSession("https://x.supabase.co/functions/v1/send-push", 401)).toBe(true);
    });

    it("401 на ВХОДІ — ні: це невірний пароль, і виганяти людину з форми входу безглуздо", () => {
      expect(looksLikeExpiredSession("https://x.supabase.co/auth/v1/token?grant_type=password", 401)).toBe(false);
    });

    it("посилання авторизації з /rest/v1/ у параметрі — теж ні", () => {
      // Реальний випадок: лист підтвердження несе redirect_to з адресою застосунку.
      // Без явного відсіву /auth/v1/ такий 401 виглядав би як протухла сесія.
      expect(looksLikeExpiredSession(
        "https://x.supabase.co/auth/v1/verify?token=abc&redirect_to=https://otutorhub.com/rest/v1/x",
        401,
      )).toBe(false);
    });

    it("403 — ні: це відмова політики живій сесії, а не протухлий токен", () => {
      expect(looksLikeExpiredSession("https://x.supabase.co/rest/v1/lessons", 403)).toBe(false);
    });

    it("успішна відповідь — ні", () => {
      expect(looksLikeExpiredSession("https://x.supabase.co/rest/v1/lessons", 200)).toBe(false);
    });
  });

  describe("сигнал", () => {
    it("анонімний запит без збереженого токена сесією не вважається", () => {
      expect(hasStoredSession()).toBe(false);
      localStorage.setItem("sb-kficbcjqcbhqhjimxfed-auth-token", "{}");
      expect(hasStoredSession()).toBe(true);
    });

    it("десяток паралельних відмов дає РІВНО один сигнал", () => {
      const spy = vi.fn();
      const off = onSessionExpired(spy);
      for (let i = 0; i < 12; i++) reportSessionExpired();
      expect(spy).toHaveBeenCalledTimes(1);
      off();
    });

    it("після відписки сигнал нікуди не йде", () => {
      const spy = vi.fn();
      onSessionExpired(spy)();
      reportSessionExpired();
      expect(spy).not.toHaveBeenCalled();
    });

    it("після входу приглушення скидається — наступний збій має прозвучати", () => {
      const spy = vi.fn();
      const off = onSessionExpired(spy);
      reportSessionExpired();
      resetSessionExpiry();
      reportSessionExpired();
      expect(spy).toHaveBeenCalledTimes(2);
      off();
    });
  });

  describe("як це вбудовано", () => {
    it("перевірка стоїть у спільній обгортці fetch — крізь неї йдуть УСІ запити", () => {
      const f = read("src/integrations/supabase/fetchWithTimeout.ts");
      expect(f).toMatch(/looksLikeExpiredSession\(url, res\.status\) && hasStoredSession\(\)/);
      expect(f, "тіло відповіді читає той, хто викликав — обгортка його не чіпає")
        .not.toMatch(/res\.json\(\)|res\.text\(\)/);
    });

    it("AuthProvider чистить стан і каже про це словами, а не мовчить", () => {
      const a = read("src/hooks/useAuth.tsx");
      expect(a).toMatch(/onSessionExpired\(\(\) => \{/);
      expect(a).toMatch(/setUser\(null\);/);
      expect(a, "мертвий токен у сховищі — причина, чому наступний запит теж упаде")
        .toMatch(/signOut\(\{ scope: "local" \}\)/);
      expect(a).toMatch(/i18n\.t\("auth\.sessionExpired"\)/);
    });

    it("не чекаємо першого зламаного екрана: є сторож на повернення вкладки", () => {
      const a = read("src/hooks/useAuth.tsx");
      expect(a).toMatch(/visibilitychange/);
      expect(a).toMatch(/refreshSession\(\)/);
      // 23.09: сигнал лише коли токен справді відкинуто; ліміт/мережа — наступний тик
      expect(a, "не вдалось поновити — це той самий сигнал (крім тимчасових збоїв)").toMatch(/if \(error && !isTransientAuthError\(error\)\) reportSessionExpired\(\)/);
    });

    it("успішний вхід знімає приглушення", () => {
      expect(read("src/hooks/useAuth.tsx")).toMatch(/resetSessionExpiry\(\)/);
    });
  });

  it("з реєстрації видно дорогу на лендінг — логотип веде на головну", () => {
    const ap = read("src/pages/AuthPage.tsx");
    const links = ap.match(/<Link to="\/" aria-label=\{t\("auth\.backToLanding"\)\}/g) ?? [];
    expect(links.length, "усі три екрани входу мусять мати вихід на лендінг").toBe(3);
    expect(ap).toMatch(/import \{ Link, useNavigate, useSearchParams \} from "react-router-dom";/);
  });

  describe("23.09 (скан Lovable): тимчасовий збій оновлення токена — не «сесія протухла»", () => {
    // supabase-js на 429 від /auth/v1/token стирає сесію і шле SIGNED_OUT; далі
    // запити йдуть анонімно → «permission denied» → людина на сторінці входу через
    // ліміт, який мине за хвилини. Тепер: тихі спроби повернути сесію тим самим
    // refresh-токеном, і лише потім — вхід заново.
    it("429 / over_request_rate_limit / мережа / 5xx — тимчасово", () => {
      expect(isTransientAuthError({ status: 429, message: "Request rate limit reached" })).toBe(true);
      expect(isTransientAuthError({ code: "over_request_rate_limit", status: 429 })).toBe(true);
      expect(isTransientAuthError({ name: "AuthRetryableFetchError", status: 0 })).toBe(true);
      expect(isTransientAuthError({ status: 503, message: "Service Unavailable" })).toBe(true);
      expect(isTransientAuthError({ message: "TypeError: Failed to fetch" })).toBe(true);
    });

    it("мертвий refresh-токен / невірний пароль — НЕ тимчасово: чесний вихід", () => {
      expect(isTransientAuthError({ status: 400, code: "refresh_token_not_found", message: "Invalid Refresh Token" })).toBe(false);
      expect(isTransientAuthError({ status: 401, message: "Invalid token" })).toBe(false);
      expect(isTransientAuthError(null)).toBe(false);
    });

    it("спроб відновлення дві, з паузою (ліміт триває хвилини, не секунди)", () => {
      expect(RESTORE_DELAYS_MS.length).toBe(2);
      expect(RESTORE_DELAYS_MS[0]).toBeGreaterThanOrEqual(3_000);
      expect(RESTORE_DELAYS_MS[1]).toBeGreaterThan(RESTORE_DELAYS_MS[0]);
    });

    it("useAuth: несподіваний SIGNED_OUT спершу пробує setSession зі старими токенами, і лише потім чистить стан", () => {
      const s = read("src/hooks/useAuth.tsx");
      expect(s).toMatch(/event === "SIGNED_OUT" && !explicitSignOutRef\.current && lastTokensRef\.current/);
      expect(s).toMatch(/supabase\.auth\.setSession\(tokens\)/);
      expect(s).toMatch(/if \(event === "SIGNED_OUT" && restoringRef\.current\) return;/);
      // явний вихід (кнопка або протухла сесія) відновлення НЕ запускає
      expect(s).toMatch(/const signOut = async \(\) => \{\s*\n\s*explicitSignOutRef\.current = true;/);
      expect(s.indexOf("explicitSignOutRef.current = true;"), "у обробнику протухлої сесії теж").toBeLessThan(s.indexOf('signOut({ scope: "local" })'));
      // фонова перевірка: 429 на refreshSession — не сигнал «протухла»
      expect(s).toMatch(/if \(error && !isTransientAuthError\(error\)\) reportSessionExpired\(\);/);
    });
  });
});
