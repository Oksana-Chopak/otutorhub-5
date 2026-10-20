import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { firefliesTitleFor, lessonIdFromTitle, legacyLessonIdFromTitle } from "../../supabase/functions/_shared/firefliesTitle";
import { cleanPersonName, cleanLabels } from "../../supabase/functions/_shared/textSafety";
import { safeAppUrl, isAppHost } from "../../supabase/functions/_shared/appOrigins";
import { oauthCookieHeader, clearOauthCookieHeader, readOauthCookie, nonceEqual } from "../../supabase/functions/_shared/oauthNonce";
import { scrubUrlForLog } from "@/lib/errorLog";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Red team, жовтень (20.10): щомісячний прохід за списком із CLAUDE.md.
 * Поведінку бази доводить сценарій scripts/db-replay/scenarios/68-redteam-october.sql
 * (і оновлений 96); тут — інваріанти edge-функцій, клієнта й воркфлоу, щоб клас
 * знахідки не повернувся тихою правкою.
 */

describe("H1 · Fireflies: транскрипт лягає лише у СВІЙ урок (HMAC-тег у назві зустрічі)", () => {
  const secret = "test-secret-123";
  const lesson = "0f1e2d3c-4b5a-4a6f-8b7c-9d0e1f2a3b4c";

  it("назву будує сервер: oTutorHub [<lessonId>.<16 hex>]", async () => {
    const title = await firefliesTitleFor(lesson, secret);
    expect(title).toMatch(new RegExp(`^oTutorHub \\[${lesson}\\.[0-9a-f]{16}\\]$`));
    expect(await lessonIdFromTitle(title, secret)).toBe(lesson);
  });

  it("чужий uuid у назві без тегу або з підробленим тегом — не адреса", async () => {
    const other = "11111111-2222-4333-8444-555555555555";
    expect(await lessonIdFromTitle(`x [${other}]`, secret)).toBeNull();
    expect(await lessonIdFromTitle(`x [${other}.0123456789abcdef]`, secret)).toBeNull();
    const title = await firefliesTitleFor(lesson, secret);
    expect(await lessonIdFromTitle(title, "other-secret")).toBeNull();
    // перший збіг у назві не може бути «протягнутий» через предмет: назва без предмета
    expect(title).not.toMatch(/Tutoring:/);
  });

  it("старий формат [uuid] розпізнається окремо (лише для уроків зі status=requested у вебхуку)", async () => {
    expect(legacyLessonIdFromTitle(`Tutoring: Math [${lesson}]`)).toBe(lesson);
    expect(legacyLessonIdFromTitle(await firefliesTitleFor(lesson, secret))).toBeNull();
  });

  it("start-recording і auto-join більше не беруть назву з клієнта чи предмета", () => {
    for (const fn of ["fireflies-start-recording", "fireflies-auto-join"]) {
      const s = noComments(read(`supabase/functions/${fn}/index.ts`));
      expect(s, fn).toMatch(/firefliesTitleFor\(/);
      expect(s, fn).not.toMatch(/Tutoring: \$\{/);
      expect(s, fn).toMatch(/FIREFLIES_WEBHOOK_SECRET/);
    }
    const start = noComments(read("supabase/functions/fireflies-start-recording/index.ts"));
    expect(start, "поле title з тіла запиту зникло").not.toMatch(/title\?: string/);
  });

  it("вебхук: тег → інакше лише урок, де бот справді був замовлений (fireflies_status = requested)", () => {
    const s = noComments(read("supabase/functions/fireflies-webhook/index.ts"));
    expect(s).toMatch(/lessonIdFromTitle\(t\.title, expectedSecret\)/);
    expect(s).toMatch(/legacyLessonIdFromTitle\(t\.title\)/);
    expect(s).toMatch(/\.eq\("fireflies_status", "requested"\)/);
    expect(s, "гола регулярка [uuid] як адреса зникла").not.toMatch(/t\.title\.match\(\/\\\[\(\[0-9a-f-\]\{36\}\)\\\]\/i\)/);
  });
});

describe("M · OAuth Google привʼязаний до браузера, який його почав", () => {
  it("cookie лише для шляху callback, HttpOnly, SameSite=Lax, 15 хв; гаситься після", () => {
    const h = oauthCookieHeader("abc");
    expect(h).toMatch(/^oth_oauth=abc; Max-Age=900; Path=\/functions\/v1\/google-calendar-callback; Secure; HttpOnly; SameSite=Lax$/);
    expect(clearOauthCookieHeader()).toMatch(/Max-Age=0/);
  });

  it("читання cookie й порівняння сталим часом", () => {
    const req = new Request("https://x.test/", { headers: { cookie: "a=1; oth_oauth=n%2Fonce; b=2" } });
    expect(readOauthCookie(req)).toBe("n/once");
    expect(readOauthCookie(new Request("https://x.test/"))).toBeNull();
    expect(nonceEqual("abc", "abc")).toBe(true);
    expect(nonceEqual("abc", "abd")).toBe(false);
    expect(nonceEqual(null, "abc")).toBe(false);
  });

  it("auth кладе nonce у state і в Set-Cookie; callback вимагає збігу", () => {
    const auth = noComments(read("supabase/functions/google-calendar-auth/index.ts"));
    expect(auth).toMatch(/nonce\b/);
    expect(auth).toMatch(/"Set-Cookie": oauthCookieHeader\(nonce\)/);
    const cb = noComments(read("supabase/functions/google-calendar-callback/index.ts"));
    expect(cb).toMatch(/const cookieNonce = readOauthCookie\(req\);\s*if \(!nonceEqual\(cookieNonce, verified\.nonce\)\)/);
    expect(cb).toMatch(/session_mismatch/);
    expect(cb, "state без nonce не приймається").toMatch(/if \(!userId \|\| !nonce\) return null;/);
  });

  it("адреси повернення — закритий список хостів, не будь-який *.lovable.app", () => {
    for (const fn of ["google-calendar-auth", "google-calendar-callback"]) {
      const s = noComments(read(`supabase/functions/${fn}/index.ts`));
      expect(s, fn).not.toMatch(/endsWith\(["']\.lovable\.app["']\)/);
      expect(s, fn).toMatch(/safeAppUrl\(/);
    }
    expect(safeAppUrl("https://evil-project.lovable.app/steal")).toBeNull();
    expect(safeAppUrl("http://otutorhub.com/profile")).toBeNull();
    expect(safeAppUrl("https://otutorhub.com/profile?x=1")).toBe("https://otutorhub.com/profile?x=1");
    expect(isAppHost("www.otutorhub.com")).toBe(true);
  });
});

describe("публічні двері: стелі й чистка тексту", () => {
  it("send-student-invite: стеля на відправника в базі + імена без посилань", () => {
    const s = noComments(read("supabase/functions/send-student-invite/index.ts"));
    expect(s).toMatch(/\['invite_caller_hour', PER_CALLER_HOUR, 3600\]/);
    expect(s).toMatch(/\['invite_caller_day', PER_CALLER_DAY, 86400\]/);
    expect(s).toMatch(/rateLimit\(admin, scope, user\.id, max, win\)/);
    expect(s).toMatch(/cleanPersonName\(/);
    expect(s).toMatch(/subjects = cleanLabels\(subjects\)/);
  });

  it("чистка імен: посилання й домени зникають, довжина обрізана, порожнє → undefined", () => {
    expect(cleanPersonName("Перейди на http://evil.example/приз Іван")).toBe("Перейди на Іван");
    expect(cleanPersonName("Оксана www.scam.test")).toBe("Оксана");
    expect(cleanPersonName("Ім'я evil.example")).toBe("Ім'я");
    expect(cleanPersonName("   ")).toBeUndefined();
    expect(cleanPersonName("а".repeat(100))?.length).toBe(60);
    expect(cleanLabels(["Математика", "Математика", "https://x.test", "Фізика"])).toEqual(["Математика", "Фізика"]);
    expect(cleanLabels(["1", "2", "3", "4", "5", "6"])).toHaveLength(5);
  });

  it("meta-capi: ліміт у базі (адреса + платформа) і Origin з нашого сайту", () => {
    const s = noComments(read("supabase/functions/meta-capi/index.ts"));
    expect(s).toMatch(/\["meta_capi_ip", ip, PER_IP_HOUR\]/);
    expect(s).toMatch(/\["meta_capi_all", "platform", PLATFORM_HOUR\]/);
    expect(s).toMatch(/APP_ORIGINS\.has\(origin\)/);
  });

  it("revenuecat-webhook: SANDBOX-події й анонімні app_user_id не вмикають Pro", () => {
    const s = noComments(read("supabase/functions/revenuecat-webhook/index.ts"));
    expect(s).toMatch(/environment !== 'PRODUCTION'/);
    expect(s).toMatch(/REVENUECAT_ALLOW_SANDBOX/);
    expect(s).toMatch(/anonymous_app_user_id/);
  });

  it("liqpay-callback більше не дублює токен картки в налаштуваннях", () => {
    const s = noComments(read("supabase/functions/liqpay-callback/index.ts"));
    expect(s).not.toMatch(/liqpay_card_token/);
    expect(s, "у liqpay_payments токен лишається (колонка схована від браузера)").toMatch(/card_token: cardToken \?\? paymentRow\.card_token/);
  });
});

describe("клієнт", () => {
  it("помилки пишуться через log_client_error, адреса без query і токенів", () => {
    const s = noComments(read("src/lib/errorLog.ts"));
    expect(s).toMatch(/\(supabase\.rpc as any\)\("log_client_error"/);
    expect(s).not.toMatch(/from\("error_log"\)\.insert/);
    expect(scrubUrlForLog("/pay/SECRET-TOKEN?invite=abc&email=x%40y.z#f")).toBe("/pay/…");
    expect(scrubUrlForLog("/join/REFCODE/extra")).toBe("/join/…/extra");
    expect(scrubUrlForLog("/auth?confirmed=1&email=a%40b.c")).toBe("/auth");
    expect(scrubUrlForLog("/schedule")).toBe("/schedule");
  });

  it("платформні екрани — лише суперадміну: маршрут і пункт сайдбара збігаються", () => {
    const app = read("src/App.tsx");
    for (const path of ["/errors", "/feedback-inbox", "/marketing", "/subscription-requests", "/paywall-metrics"]) {
      const re = new RegExp(`<Route path="${path}" element=\\{<ProtectedRoute allowedRoles=\\{\\["manager"\\]\\} superadmin>`);
      expect(app, `${path} без прапорця superadmin`).toMatch(re);
    }
    const nav = read("src/components/AppSidebar.tsx");
    expect(nav).toMatch(/to: "\/errors",[^\n]*superadminOnly: true/);
    expect(nav).toMatch(/to: "\/marketing",[^\n]*superadminOnly: true/);
  });

  it("«Вийти» стирає кеш react-query на диску й у памʼяті", () => {
    const auth = noComments(read("src/hooks/useAuth.tsx"));
    expect(auth).toMatch(/await supabase\.auth\.signOut\(\);\s*\} finally \{[\s\S]*?purgeLocalCaches\(\);/);
    const app = noComments(read("src/App.tsx"));
    expect(app).toMatch(/key: RQ_PERSIST_KEY/);
    expect(app).toMatch(/registerQueryClient\(queryClient\)/);
    const lib = noComments(read("src/lib/localCaches.ts"));
    expect(lib).toMatch(/localStorage\.removeItem\(RQ_PERSIST_KEY\)/);
    expect(lib).toMatch(/registered\?\.clear\(\)/);
  });

  it("онбординг перевіряє підключення календаря колонкою, яка існує", () => {
    const s = noComments(read("src/components/OnboardingFlowB.tsx"));
    expect(s).not.toMatch(/from\("google_calendar_tokens" as any\)\.select\("id"\)/);
    expect(s).toMatch(/from\("google_calendar_tokens" as any\)\.select\("user_id"\)/);
  });
});

describe("воркфлоу: агент щоденних помилок без права запису й без git/gh у руках", () => {
  const wf = () => read(".github/workflows/errors-daily.yml");

  it("токен агента лише на читання; git/gh/node йому не дозволені", () => {
    const s = wf();
    expect(s).toMatch(/^permissions: \{\}/m);
    expect(s).not.toMatch(/Bash\(git:\*\)/);
    expect(s).not.toMatch(/Bash\(gh:\*\)/);
    expect(s).not.toMatch(/Bash\(node:\*\)/);
    expect(s).not.toMatch(/Bash\(npm:\*\)/);
    const triage = s.slice(s.indexOf("  triage:"), s.indexOf("  verify:"));
    expect(triage).toMatch(/permissions:\n\s+contents: read/);
    expect(triage).not.toMatch(/contents: write/);
    expect(triage).toMatch(/errors-agent-input\.mjs/);
    expect(triage).toMatch(/ДАНІ, записані з браузерів користувачів/);
  });

  it("патч детерміновано не містить .github, міграцій, config.toml і package*.json; PR відкриває окремий крок без коду з патча", () => {
    const s = wf();
    expect(s).toMatch(/git add -A -- \. ':!\.github' ':!supabase\/migrations' ':!supabase\/config\.toml' ':!package\.json' ':!package-lock\.json'/);
    const openPr = s.slice(s.indexOf("  open_pr:"));
    expect(openPr).toMatch(/contents: write/);
    expect(openPr, "у кроці з правом запису код із патча не виконується").not.toMatch(/npm ci --no-audit|- run: npm/);
    expect(openPr).toMatch(/gh pr create --base main/);
    const verify = s.slice(s.indexOf("  verify:"), s.indexOf("  open_pr:"));
    expect(verify).toMatch(/npm run gates:fast/);
    expect(verify).not.toMatch(/contents: write/);
  });

  it("вхід агента — лише нормалізовані підписи", () => {
    const s = read("scripts/errors-agent-input.mjs");
    expect(s).toMatch(/signature: printable\(g\.signature, 120\)/);
    expect(s, "сирий текст помилки агентові не йде").not.toMatch(/g\.sample/);
    expect(s).toMatch(/errors-24h\.agent\.json/);
  });

  it("seed-demo запускається лише з main", () => {
    const s = read(".github/workflows/seed-demo.yml");
    expect(s).toMatch(/branches: \[main\]/);
  });
});

describe("міграція 20261020100000_redteam_october і сценарій 68", () => {
  const MIG = "supabase/migrations/20261020100000_redteam_october.sql";

  it("файли на місці", () => {
    expect(existsSync(join(ROOT, MIG))).toBe(true);
    expect(existsSync(join(ROOT, "scripts/db-replay/scenarios/68-redteam-october.sql"))).toBe(true);
  });

  it("злиття запрошеного профілю — лише з підтвердженою поштою", () => {
    const m = read(MIG);
    expect(m).toMatch(/IF NEW\.email_confirmed_at IS NOT NULL THEN\s+BEGIN\s+_merged := public\.merge_pending_profile/);
    expect(m).toMatch(/CREATE TRIGGER on_auth_user_email_confirmed\s+AFTER UPDATE ON auth\.users/);
    expect(m).toMatch(/WHEN \(OLD\.email_confirmed_at IS NULL AND NEW\.email_confirmed_at IS NOT NULL\)/);
    expect(m).toMatch(/REVOKE EXECUTE ON FUNCTION public\.merge_pending_profile\(uuid, text, text\) FROM PUBLIC, anon, authenticated/);
  });

  it("стелі: сповіщення, is_pending_email, error_log через RPC", () => {
    const m = read(MIG);
    expect(m).toMatch(/rate_limit_check\('notify_admin', _caller::text, 10, 3600\)/);
    expect(m).toMatch(/rate_limit_check\('notify_fanout', _caller::text, 300, 3600\)/);
    expect(m).toMatch(/rate_limit_check\('pending_email_probe', _key, 60, 3600\)/);
    expect(m).toMatch(/CREATE OR REPLACE FUNCTION public\.log_client_error\(/);
    expect(m).toMatch(/REVOKE INSERT ON public\.error_log FROM anon, authenticated/);
    expect(m).toMatch(/DROP POLICY IF EXISTS "error_log insert anon"/);
  });

  it("Pro-заявки лише суперадмін; секретні колонки без SELECT для браузера", () => {
    const m = read(MIG);
    const approve = m.slice(m.indexOf("FUNCTION public.approve_subscription_request"), m.indexOf("FUNCTION public.reject_subscription_request"));
    expect(approve).toMatch(/IF NOT public\.is_superadmin\(\) THEN/);
    expect(approve).not.toMatch(/has_role\(_caller, 'manager'/);
    expect(m).toMatch(/REVOKE SELECT ON public\.liqpay_payments FROM anon, authenticated/);
    expect(m).toMatch(/REVOKE SELECT ON public\.google_calendar_tokens FROM anon, authenticated/);
    const grantGoogle = /GRANT SELECT \(user_id, google_email, expires_at, created_at, updated_at\)\s+ON public\.google_calendar_tokens TO authenticated/;
    expect(m).toMatch(grantGoogle);
    expect(m).not.toMatch(/GRANT SELECT \([^)]*card_token/);
  });
});
