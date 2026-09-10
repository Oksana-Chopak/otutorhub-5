/**
 * Реклама не має права ввімкнутись сама.
 *
 * Ці перевірки стережуть три речі, кожна з яких коштує дорого, якщо зламається:
 *  1. Pixel і CAPI мовчать без явної згоди на куки (ePrivacy: _fbp — не
 *     «строго необхідна» кука, а IP і user-agent у CAPI — персональні дані);
 *  2. вони мовчать без ключів, тож до вставки значень у Lovable сайт
 *     поводиться байт-у-байт як раніше;
 *  3. браузерна й серверна події несуть ОДИН event_id — інакше Meta порахує
 *     кожну конверсію двічі й реклама оптимізується на вигадані цифри.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

describe("Meta Pixel / CAPI — згода і ключі", () => {
  const pixel = src("src/lib/metaPixel.ts");
  const edge = src("supabase/functions/meta-capi/index.ts");

  it("нічого не вантажиться і не шлеться без згоди", () => {
    // Обидва виходи — і завантаження скрипта, і сама подія — за перевіркою.
    expect(pixel).toMatch(/loadMetaPixel[\s\S]*?getConsent\(\) !== "accepted"[\s\S]*?return;/);
    expect(pixel).toMatch(/metaTrack[\s\S]*?getConsent\(\) !== "accepted"\) return;/);
  });

  it("без ключа фронт не робить жодного запиту", () => {
    expect(pixel).toMatch(/if \(!PIXEL_ID \|\| getConsent\(\)/);
    expect(pixel).toMatch(/VITE_META_PIXEL_ID/);
  });

  it("без ключів edge-функція нічого не шле в Meta", () => {
    expect(edge).toMatch(/if \(!pixelId \|\| !token\) return json\(200, \{ skipped: "not_configured" \}\)/);
  });

  it("один event_id на обидва канали — інакше подвійний рахунок", () => {
    expect(pixel).toMatch(/const eventId = /);
    expect(pixel).toMatch(/eventID: eventId/);          // браузер
    expect(pixel).toMatch(/event_id: eventId/);         // сервер
  });

  it("до Meta йде тільки білий список подій", () => {
    expect(edge).toMatch(/const ALLOWED = new Set\(\["PageView", "Lead", "CompleteRegistration"\]\)/);
    expect(edge).toMatch(/if \(!ALLOWED\.has\(eventName\)\)/);
  });

  it("у custom_data пролазять лише числа — жодного імені чи списку учнів", () => {
    expect(edge).toMatch(/for \(const k of \["students", "owed", "monthly"\]\)/);
    expect(edge).toMatch(/typeof v === "number"/);
    expect(edge).not.toMatch(/JSON\.stringify\(raw\)/);
  });

  it("edge зареєстрована без JWT — інакше анонімний лендінг її не дістане", () => {
    const cfg = src("supabase/config.toml");
    expect(cfg).toMatch(/\[functions\.meta-capi\]\s*\n\s*verify_jwt = false/);
  });
});

describe("Анонімна воронка — без персональних даних", () => {
  const funnel = src("src/lib/landingFunnel.ts");
  const mig = src("supabase/migrations/20260910100000_landing_funnel_anon.sql");

  it("лічильник не зберігає нічого на пристрої", () => {
    // Дедуп анонімного каналу — у памʼяті модуля, не в localStorage.
    // Дивимось РІВНО на тіло countAnon: далі у файлі localStorage є законно
    // (буфер тих, хто дійде до реєстрації), і широкий регекс ловив би його.
    const body = funnel.slice(funnel.indexOf("function countAnon"));
    const only = body.slice(0, body.indexOf("\n}\n") + 2);
    expect(funnel).toMatch(/const counted = new Set<string>\(\)/);
    expect(only).toMatch(/counted\.has\(name\)/);
    expect(only).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });

  it("у таблиці немає ані користувача, ані IP", () => {
    // Тільки оголошення таблиці: у коментарях слово user_id є законно —
    // саме тим, що app_events його ВИМАГАЄ, і пояснюється ця міграція.
    const ddl = mig.slice(mig.indexOf("CREATE TABLE"), mig.indexOf(");", mig.indexOf("CREATE TABLE")));
    expect(ddl).not.toMatch(/user_id|ip|inet|agent|session|device|fingerprint/i);
    expect(ddl).toMatch(/hits bigint/);
    expect(mig).toMatch(/CREATE TABLE IF NOT EXISTS public\.landing_funnel_daily/);
  });

  it("писати можна лише через функцію з білим списком імен", () => {
    expect(mig).toMatch(/revoke all on public\.landing_funnel_daily from anon, authenticated/);
    expect(mig).toMatch(/_name NOT IN \(/);
    expect(mig).toMatch(/grant execute on function public\.log_landing_event/);
  });

  it("читає лише суперадмін", () => {
    expect(mig).toMatch(/using \(public\.is_superadmin\(\)\)/);
  });
});
