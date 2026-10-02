import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { normalizePath } from "@/lib/productTelemetry";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Аналітика продукту й лог-менеджмент (02.10): воронка до AHA, прапорці,
 * записи використання, помилки групами, щоденна рутина. Поведінку бази доводить
 * сценарій 06-product-analytics.sql; тут — що клієнт і edge підключені до неї.
 */

const CRON = ["payment-reminders", "payout-reminders", "lesson-reminders", "tutor-daily-digest", "tutor-evening-summary", "tutor-weekly-digest", "scheduled-notifications", "db-backup", "telegram-poll", "fireflies-auto-join", "archive-old-chats", "process-email-queue"];

describe("помилки edge-функцій більше не зникають у логах Supabase", () => {
  const fns = readdirSync(join(ROOT, "supabase/functions")).filter((d) => !d.startsWith("_") && existsSync(join(ROOT, "supabase/functions", d, "index.ts")));
  // mcp — автогенерований плагіном Lovable на кожному build (банер у файлі): не обгортаємо.
  for (const fn of fns.filter((f) => !CRON.includes(f) && f !== "version" && f !== "mcp")) {
    it(`${fn}: Deno.serve(withErrorLog("${fn}", …))`, () => {
      const s = noComments(read(`supabase/functions/${fn}/index.ts`));
      expect(s).toMatch(/from ["']\.\.\/_shared\/errorLog\.ts["']/);
      expect(s).toMatch(new RegExp(`Deno\\.serve\\(withErrorLog\\("${fn}", `));
    });
  }
  it("обгортка пише лише 5xx і винятки, не 4xx і не проби", () => {
    const s = noComments(read("supabase/functions/_shared/errorLog.ts"));
    expect(s).toMatch(/if \(probe \|\| res\.status < 500\) return res;/);
    expect(s).toMatch(/from\("error_log"\)\.insert\(\{ message: message\.slice\(0, 500\), url: `edge:\$\{name\}`, context \}\)/);
  });
});

describe("записи використання: app_open раз на сесію, page_view раз на шлях за 5 хв", () => {
  it("шлях без ідентифікаторів", () => {
    expect(normalizePath("/schedule")).toBe("/schedule");
    expect(normalizePath("/chats/3f2a1b2c-1234-4abc-9def-0123456789ab")).toBe("/chats/#");
    expect(normalizePath("/students/42/lessons")).toBe("/students/#/lessons");
  });
  it("AppLayout логує обидві події з роллю і платформою", () => {
    const s = noComments(read("src/components/AppLayout.tsx"));
    expect(s).toMatch(/logAppOpen\(roleName, isNativeApp\(\) \? \(isIosApp\(\) \? "ios" : "android"\) : "web"\)/);
    expect(s).toMatch(/useEffect\(\(\) => \{ if \(user\) logPageView\(pathname, roleName\); \}, \[user\?\.id, pathname, roleName\]\);/);
  });
});

describe("прапорці функцій гейтять справжні функції (не декорація)", () => {
  it("імпорт: таблиця й календар; лендінг: посилання; урок: AI-кнопка", () => {
    const sheet = noComments(read("src/components/ImportStudentsSheet.tsx"));
    expect(sheet).toMatch(/const flagSheet = useFeatureFlag\("import_sheet_link"\);/);
    expect(sheet).toMatch(/const flagCalendar = useFeatureFlag\("import_google_calendar"\);/);
    expect(sheet).toMatch(/\.filter\(\(\[key\]\) => \(key !== "sheet" \|\| flagSheet\) && \(key !== "calendar" \|\| flagCalendar\)\)/);
    const hero = noComments(read("src/components/landing/LandingHero.tsx"));
    expect(hero).toMatch(/const flagSheetLink = useFeatureFlag\("landing_sheet_link"\);/);
    expect(hero).toMatch(/\{!flagSheetLink \? null : sheetOpen \? \(/);
    const ws = noComments(read("src/components/LessonWorkspace.tsx"));
    expect(ws).toMatch(/const flagAiSummary = useFeatureFlag\("ai_lesson_summary"\);/);
    expect((ws.match(/aiAllowed && flagAiSummary \?/g) ?? []).length).toBe(2);
  });
  it("без бази — fallback «увімкнено»: функція не зникає через прапорці", () => {
    const s = noComments(read("src/lib/featureFlags.ts"));
    expect(s).toMatch(/if \(!flags \|\| !\(key in flags\)\) return fallback;/);
    expect(s).toMatch(/export function useFeatureFlag\(key: FlagKey, fallback = true\)/);
  });
});

describe("адмінка: воронка, активність, помилки групами, прапорці", () => {
  it("блок змонтовано в AdminStatsPage і читає RPC 20261002120000", () => {
    expect(noComments(read("src/pages/AdminStatsPage.tsx"))).toMatch(/<ProductHealth \/>/);
    const s = noComments(read("src/components/admin/ProductHealth.tsx"));
    expect(s).toMatch(/rpc<Funnel>\("admin_product_funnel", \{ _weeks: 8 \}\)/);
    expect(s).toMatch(/rpc<ErrorGroup\[\]>\("error_groups", \{ _hours: 24, _limit: 20 \}\)/);
    expect(s).toMatch(/\["week", "signed", "student", "lesson", "aha", "d7", "d30", "paying", "churned"\]\.map/);
    expect(s).toMatch(/role="switch" aria-checked=\{f\.enabled\}/);
  });
  it("міграція й сценарій на місці; воронка — лише суперадмін; прапорці читає анонім", () => {
    const MIG = "supabase/migrations/20261002120000_product_analytics.sql";
    expect(existsSync(join(ROOT, MIG))).toBe(true);
    expect(existsSync(join(ROOT, "scripts/db-replay/scenarios/06-product-analytics.sql"))).toBe(true);
    const m = read(MIG);
    expect(m).toMatch(/IF NOT public\.is_superadmin\(\) THEN\s*RAISE EXCEPTION 'superadmin only'/);
    expect(m).toMatch(/GRANT EXECUTE ON FUNCTION public\.my_feature_flags\(\) TO anon, authenticated, service_role;/);
    expect(m).toMatch(/CREATE POLICY "error_log insert anon" ON public\.error_log\s*\n\s*FOR INSERT TO anon WITH CHECK \(user_id IS NULL\);/);
  });
});

describe("щоденна рутина: Telegram-рядок і PR від Claude Code", () => {
  it("воркфлоу читає errors-report, шле в ci-report і запускає Claude лише з ключем і лише на нові", () => {
    const w = read(".github/workflows/errors-daily.yml");
    expect(w).toMatch(/cron: "15 6 \* \* \*"/);
    expect(w).toMatch(/node scripts\/errors-daily\.mjs/);
    expect(w).toMatch(/uses: anthropics\/claude-code-action@v1/);
    expect(w).toMatch(/if: \$\{\{ env\.HAS_CLAUDE_KEY == 'true' && steps\.report\.outputs\.new != '0'/);
    // без дозволених інструментів Claude в режимі автоматизації нічого не виправить
    expect(w).toMatch(/--allowedTools "Read,Edit,Write,Glob,Grep,Bash\(npm:\*\),Bash\(npx:\*\),Bash\(node:\*\),Bash\(git:\*\),Bash\(gh:\*\)"/);
    expect(w).toMatch(/claude_code_oauth_token: \$\{\{ secrets\.CLAUDE_CODE_OAUTH_TOKEN \}\}/);
    expect(w).toMatch(/Заборонено: пушити в main/);
    const s = noComments(read("supabase/functions/errors-report/index.ts"));
    expect(s).toMatch(/if \(!provided \|\| !expected \|\| provided !== expected\)/);
    expect(read("supabase/config.toml")).toMatch(/\[functions\.errors-report\]\s*\n\s*verify_jwt = false/);
  });
  it("ранковий дайджест суперадміна показує нові групи помилок першими", () => {
    const d = noComments(read("supabase/functions/tutor-daily-digest/index.ts"));
    expect(d).toMatch(/\(sb\.rpc as any\)\("error_groups", \{ _hours: 24, _limit: 20 \}\)/);
    expect(d).toMatch(/lines\.push\(\.\.\.errLines\(D\)\);/);
    expect((d.match(/\berrTop: \(n: number, newN: number\) =>/g) ?? []).length).toBe(3);
  });
});
