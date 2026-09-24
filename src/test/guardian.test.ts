import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";

/**
 * «Сторож» (22.09) — ратчети на систему, що не дає правкам ламати працююче.
 *
 * Кожен блок — конкретний спосіб, яким сторож уже ламався або міг би:
 *  • CI мовчки мертвий (дубльований ключ у YAML, 25.08 → 835 червоних запусків);
 *  • CI перевіряє не те, що агент (два різні списки воріт);
 *  • штамп edge-функцій відстає від джерел (тоді «свіжий чи ні» знову вгадується);
 *  • history.json прогону бази ховає файл, який ще може поїхати в прод;
 *  • нові edge-функції не зареєстровані в config.toml (Lovable їх пропускає).
 */
const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("сторож: CI живий і перевіряє те саме, що агент", () => {
  it("кожен воркфлоу читається як YAML і має jobs (дубльований ключ = мертвий CI)", () => {
    const dir = join(ROOT, ".github/workflows");
    for (const f of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
      const doc = yaml.load(readFileSync(join(dir, f), "utf8")) as { jobs?: unknown; name?: string } | undefined;
      expect(doc?.jobs, `${f}: немає jobs`).toBeTruthy();
      expect(doc?.name, `${f}: воркфлоу без name показується як шлях до файла`).toBeTruthy();
    }
  });

  it("ci.yml виконує scripts/gates.mjs і ніколи — голий `npx tsc --noEmit`", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("node scripts/gates.mjs");
    expect(ci).not.toMatch(/run:.*npx tsc --noEmit/);
    // база для db-replay і робот на проді — обидва є
    expect(ci).toContain("image: postgres:16");
    expect(ci).toContain("playwright.prod.config.ts");
    expect(ci).toContain("scripts/ci-notify.mjs");
  });

  it("gates.mjs містить увесь ланцюг воріт (список = ратчет; прибрати ворота можна лише свідомо тут)", () => {
    const g = read("scripts/gates.mjs");
    for (const name of ["workflows", "typecheck", "eslint", "vitest", "build", "i18n", "ux", "hardcode", "currency", "db-sync", "db-select", "stamp-edge", "esbuild-edge", "playwright-list", "db-replay"]) {
      expect(g, `ворота «${name}» зникли з ланцюга`).toContain(`name: "${name}"`);
    }
    expect(g).toContain('["run", "-s", "typecheck"]');
  });

  it("package.json має npm run gates / gates:fast / db:replay / stamp / test:prod", () => {
    const s = JSON.parse(read("package.json")).scripts;
    expect(s.gates).toBe("node scripts/gates.mjs");
    expect(s["gates:fast"]).toBe("node scripts/gates.mjs --no-db");
    expect(s["db:replay"]).toBe("node scripts/db-replay/replay.mjs");
    expect(s.stamp).toBe("node scripts/stamp-edge.mjs");
    expect(s["test:prod"]).toContain("playwright.prod.config.ts");
  });
});

describe("сторож: три канали доставки мають штампи, які видно з проду", () => {
  it("edge: _shared/version.ts відповідає джерелам (інакше «передеплоєно чи ні» знову вгадується)", () => {
    const r = spawnSync(process.execPath, ["scripts/stamp-edge.mjs", "--check"], { cwd: ROOT, encoding: "utf8" });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it("edge: функції version і ci-report зареєстровані в config.toml без JWT (інакше Lovable їх не деплоїть / робот не дістане)", () => {
    const toml = read("supabase/config.toml");
    expect(toml).toMatch(/\[functions\.version\]\s*\n\s*verify_jwt = false/);
    expect(toml).toMatch(/\[functions\.ci-report\]\s*\n\s*verify_jwt = false/);
    expect(existsSync(join(ROOT, "supabase/functions/version/index.ts"))).toBe(true);
    expect(existsSync(join(ROOT, "supabase/functions/ci-report/index.ts"))).toBe(true);
    // ci-report ходить лише з CRON_SECRET і шле лише platform_admins
    const cr = read("supabase/functions/ci-report/index.ts");
    expect(cr).toContain('Deno.env.get("CRON_SECRET")');
    expect(cr).toContain('from("platform_admins")');
  });

  it("фронтенд: штамп джерел вшивається збіркою (vite.config.ts), видимий у index.html, buildInfo, /auth", () => {
    expect(read("vite.config.ts")).toContain('fileName: "version.json"');
    expect(read("vite.config.ts")).toContain("sourceStamp()");
    expect(read("index.html")).toContain('<meta name="build-stamp" content="dev" />');
    expect(read("src/lib/buildInfo.ts")).toContain("export const BUILD_STAMP");
    expect(read("src/pages/AuthPage.tsx")).toContain("{BUILD_STAMP}");
  });

  it("робот на проді знає всі чотири персони і три класи збоїв", () => {
    const spec = read("tests/prod/smoke.spec.ts");
    for (const env of ["TEST_TUTOR_EMAIL", "TEST_MANAGER_EMAIL", "TEST_HUB_TUTOR_EMAIL", "TEST_STUDENT_EMAIL"]) expect(spec).toContain(env);
    expect(spec).toContain('"pageerror"');
    expect(spec).toContain("s === 400 || s === 404 || s >= 500");
    expect(spec).toContain("Щось пішло не так");
    expect(spec).toContain("/version.json");
    expect(spec).toContain("/functions/v1/version");
  });
});

describe("сторож: прогін бази чесний", () => {
  it("history.json не ховає жодного файла ВИЩЕ водяного знаку Lovable", () => {
    const files = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    const hashes = files.filter((f) => /^\d{14}_[0-9a-f]{8}-[0-9a-f]{4}-/.test(f));
    const watermark = hashes[hashes.length - 1].slice(0, 14);
    const h = JSON.parse(read("scripts/db-replay/history.json")) as { neverApplied: Record<string, string>; knownFailures: Record<string, string> };
    for (const f of [...Object.keys(h.neverApplied), ...Object.keys(h.knownFailures)]) {
      expect(files, `history.json згадує неіснуючий файл ${f}`).toContain(f);
      expect(f.slice(0, 14) <= watermark, `${f} вище водяного знаку ${watermark} — він ще може поїхати в прод і мусить прогонятись`).toBe(true);
      expect((h.neverApplied[f] ?? h.knownFailures[f]).length, `${f}: без пояснення`).toBeGreaterThan(20);
    }
  });

  it("сценарії прогону існують і відкочують усе за собою", () => {
    const dir = join(ROOT, "scripts/db-replay/scenarios");
    const scen = readdirSync(dir).filter((f) => f.endsWith(".sql"));
    expect(scen.length).toBeGreaterThanOrEqual(3);
    for (const f of scen) {
      const s = readFileSync(join(dir, f), "utf8");
      expect(s.trim().startsWith("--") || s.trim().startsWith("BEGIN")).toBe(true);
      expect(s, `${f}: без ROLLBACK стенд забруднюється`).toMatch(/ROLLBACK;\s*$/);
    }
  });
});

/**
 * 24.09 — уроки першого справжнього звіту робота (23.09 18:36):
 *  • «хабовий репетитор /finances: видно «Не вдалося завантажити»» без жодної
 *    підказки, ЩО впало — діагностика жила в закритому журналі GitHub;
 *  • `remind-payment: ?(401)` названо «застарілою», хоча функція просто захищена
 *    JWT і шлюз відкинув пробу без ключа;
 *  • 🔴 «main червоний» при зелених воротах — читалось як «пуш зламав прод».
 */
describe("сторож: звіт робота каже причину, а не лише факт", () => {
  it("робот на проді пояснює збій (адреса, екран, збійні запити) і знає, які функції захищені JWT", () => {
    const spec = read("tests/prod/smoke.spec.ts");
    expect(spec).toContain("async function diagnose(");
    expect(spec).toMatch(/вхід не завершився[\s\S]*await diagnose\(page, w\)/);
    expect(spec).toMatch(/видно «\$\{t\}»\\n\$\{await diagnose\(page, w\)\}/);
    expect(spec).toContain("verify_jwt");
    expect(spec).toContain("JWT_PROTECTED.has(name)");
    expect(spec).toContain("findAnonKey(request)");
  });

  it("ci-notify: ворота зелені + збій на проді = 🟠 з діагностикою, а не 🔴 «не публікуй»", () => {
    const tmp = join(ROOT, "node_modules", ".cache", "ci-notify-test");
    mkdirSync(tmp, { recursive: true });
    const message = [
      "хабовий репетитор /finances: видно «Не вдалося завантажити»",
      "адреса: https://otutorhub.com/finances",
      "екран: «Не вдалося завантажити …»",
      "збій бази/edge: GET /rest/v1/student_wallet_balances → 500 canceling statement due to statement timeout",
    ].join("\n");
    const report = { suites: [{ specs: [
      { title: "хабовий репетитор: логін і головні екрани без збоїв", tests: [{ status: "unexpected", annotations: [], results: [{ error: { message } }] }] },
      { title: "лендінг живий", tests: [{ status: "expected", annotations: [], results: [{}] }] },
      { title: "edge-функції на проді = репо", tests: [{ status: "expected", annotations: [{ type: "freshness", description: "версію remind-payment ззовні не перевірити: функція захищена JWT, а ключ проду роботові недоступний" }], results: [{}] }] },
    ] }] };
    writeFileSync(join(tmp, "prod-report.json"), JSON.stringify(report));
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/ci-notify.mjs")], {
      cwd: tmp, encoding: "utf8",
      env: { ...process.env, GATES_RESULT: "success", EVENT: "push", SHA: "abc1234def", TITLE: "Тест", RUN_URL: "", PROD_REPORT: "prod-report.json" },
    });
    expect(r.status, r.stderr).toBe(0);
    const text = readFileSync(join(tmp, "ci-message.txt"), "utf8");
    expect(text).toContain("🟠");
    expect(text).not.toContain("🔴");
    expect(text).not.toContain("НЕ публікуй");
    expect(text).toContain("statement timeout"); // діагностика робота доходить до Telegram
    expect(text).toContain("адреса: https://otutorhub.com/finances");
    expect(text).not.toContain("Передеплой"); // «не перевірити» (JWT) — не привід до передеплою
    expect(text).toContain("скинь це повідомлення агентові");
  });
});
