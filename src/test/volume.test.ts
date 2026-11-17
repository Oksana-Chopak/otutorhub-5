/**
 * ОБʼЄМ (17.11, перевірка «школа на 150 учнів, 4 320 уроків»).
 *
 * API віддає не більше 1000 рядків за запит і мовчить про обрізане. На такій школі «Мій день»
 * казав «0 уроків сьогодні» (було 30), «Розклад» починався з уроків через два тижні, «Фінанси»
 * писали «Учні винні 0 ₴» при 270 950 ₴ у базі. Ці тести тримають і саму механіку дочитування,
 * і те, що три екрани нею користуються, і що однакові запити оболонки не множаться.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readAllPages, API_PAGE } from "@/lib/pagedRead";
import { coalesce, forgetCoalesced } from "@/lib/coalesce";
import { DASHBOARD_LESSONS_CAP, DASHBOARD_MONEY_CAP } from "@/lib/financials";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** «База» з n рядків, яка, як справжній API, не віддає більше 1000 за запит. */
function fakeTable(n: number) {
  const calls: Array<[number, number]> = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    const end = Math.min(to, from + API_PAGE - 1, n - 1);
    const data: number[] = [];
    for (let i = from; i <= end; i++) data.push(i);
    return { data, error: null };
  };
  return { page, calls };
}

describe("readAllPages: дочитує сторінками й не видає неповне за повне", () => {
  it("менше однієї сторінки — один запит, усе на місці", async () => {
    const t = fakeTable(37);
    const r = await readAllPages(t.page, { cap: 5000 });
    expect(r.data.length).toBe(37);
    expect(r.truncated).toBe(false);
    expect(t.calls.length).toBe(1);
  });

  it("4 320 рядків (уроки школи за пів року) — усі, без дублів і дірок", async () => {
    const t = fakeTable(4320);
    const r = await readAllPages(t.page, { cap: 6000 });
    expect(r.data.length).toBe(4320);
    expect(new Set(r.data).size, "жоден рядок не прочитано двічі").toBe(4320);
    expect(r.data[0]).toBe(0);
    expect(r.data[4319]).toBe(4319);
    expect(r.truncated).toBe(false);
    expect(t.calls.length).toBe(5);
  });

  it("рядків більше за стелю — віддає рівно стелю і каже про це", async () => {
    const t = fakeTable(9000);
    const r = await readAllPages(t.page, { cap: 5000 });
    expect(r.data.length).toBe(5000);
    expect(r.truncated).toBe(true);
  });

  it("стеля не кратна сторінці — остання сторінка просить рівно залишок", async () => {
    const t = fakeTable(9000);
    const r = await readAllPages(t.page, { cap: 400 });
    expect(r.data.length).toBe(400);
    expect(t.calls).toEqual([[0, 399]]);
    expect(r.truncated).toBe(true);
  });

  it("рівно стільки, скільки стеля, і далі порожньо — це НЕ «обрізано» лише тоді, коли сторінка неповна", async () => {
    const t = fakeTable(2000);
    const r = await readAllPages(t.page, { cap: 3000 });
    expect(r.data.length).toBe(2000);
    expect(r.truncated, "третя сторінка порожня — читання повне").toBe(false);
  });

  it("помилка посеред читання повертається помилкою, а не «даних немає»", async () => {
    let n = 0;
    const r = await readAllPages<number>(async () => {
      n++;
      return n === 1 ? { data: Array.from({ length: API_PAGE }, (_, i) => i), error: null } : { data: null, error: { message: "мережа" } };
    });
    expect(r.error).toBeTruthy();
    expect(r.truncated).toBe(false);
  });

  it("розмір сторінки ніколи не більший за те, що віддає API", async () => {
    const t = fakeTable(2500);
    const r = await readAllPages(t.page, { cap: 5000, pageSize: 4000 });
    expect(r.data.length, "із запитом на 4000 рядків за раз API віддав би 1000 і читання обірвалось би").toBe(2500);
  });
});

describe("coalesce: однакові запити оболонки летять один раз", () => {
  beforeEach(() => forgetCoalesced());

  it("пʼять місць питають одне й те саме одночасно — запит один, відповідь у всіх", async () => {
    let hits = 0;
    const ask = () => coalesce("is-superadmin:u1", async () => { hits++; await new Promise((r) => setTimeout(r, 5)); return true; });
    const got = await Promise.all([ask(), ask(), ask(), ask(), ask()]);
    expect(hits).toBe(1);
    expect(got).toEqual([true, true, true, true, true]);
  });

  it("відповідь однієї людини ніколи не дістається іншій (ключ з id)", async () => {
    const a = await coalesce("unread:u1", async () => 3, 60_000);
    const b = await coalesce("unread:u2", async () => 7, 60_000);
    expect([a, b]).toEqual([3, 7]);
  });

  it("без часу памʼяті наступний запит летить знову — свіжі дані не підміняються старими", async () => {
    let hits = 0;
    await coalesce("k", async () => ++hits);
    await coalesce("k", async () => ++hits);
    expect(hits).toBe(2);
  });

  it("з часом памʼяті повторне питання відповіді з бази не тягне; після «Вийти» — тягне", async () => {
    let hits = 0;
    await coalesce("k", async () => ++hits, 60_000);
    await coalesce("k", async () => ++hits, 60_000);
    expect(hits).toBe(1);
    forgetCoalesced();
    await coalesce("k", async () => ++hits, 60_000);
    expect(hits).toBe(2);
  });

  it("збій не запамʼятовується: наступна спроба йде в базу", async () => {
    let hits = 0;
    await expect(coalesce("k", async () => { hits++; throw new Error("мережа"); }, 60_000)).rejects.toThrow();
    expect(await coalesce("k", async () => { hits++; return "ok"; }, 60_000)).toBe("ok");
    expect(hits).toBe(2);
  });

  it("«Вийти» забуває все запамʼятоване", () => {
    expect(read("src/lib/localCaches.ts")).toMatch(/forgetCoalesced\(\)/);
  });
});

describe("три екрани читають школу будь-якого розміру", () => {
  const dash = read("src/pages/DashboardPage.tsx");
  const sched = read("src/pages/SchedulePage.tsx");
  const fin = read("src/pages/FinancesPage.tsx");

  it("«Мій день»: сьогодні й найближче читаються ОКРЕМО і від початку дня — їх не витісняють далекі уроки", () => {
    expect(dash).toMatch(/\.gte\("starts_at", dayStart\.toISOString\(\)\)[\s\S]{0,260}\.order\("starts_at", \{ ascending: true \}\)\.order\("id"\)\s*\.limit\(DASHBOARD_LESSONS_CAP\)/);
    expect(dash).toMatch(/\.lt\("starts_at", dayStart\.toISOString\(\)\)\s*\.order\("starts_at", \{ ascending: false \}\)\.order\("id"\)\s*\.limit\(DASHBOARD_LESSONS_CAP\)/);
    expect(DASHBOARD_LESSONS_CAP, "одна сторінка API").toBeLessThanOrEqual(API_PAGE);
  });

  it("«Мій день»: вікно грошей дочитується сторінками до спільної стелі", () => {
    expect(dash).toMatch(/readAllPages<any>\(\(from, to\) => \{[\s\S]{0,700}\}, \{ cap: DASHBOARD_MONEY_CAP \}\)/);
    expect(DASHBOARD_MONEY_CAP).toBeGreaterThan(API_PAGE);
  });

  it("«Мій день»: список уперся у стелю → лічильник показується як «N+» і стоїть рядок «повна цифра — у Фінансах»", () => {
    expect(dash).toMatch(/listCut = \(up\.data \?\? \[\]\)\.length >= DASHBOARD_LESSONS_CAP \|\| \(past\.data \?\? \[\]\)\.length >= DASHBOARD_LESSONS_CAP/);
    expect(dash).toMatch(/setDebtPartial\(listCut \|\| moneyReadIsPartial\(/);
    expect(dash).toMatch(/const pendingCountLabel = debtPartial \? `\$\{pendingPayments\.length\}\+` : String\(pendingPayments\.length\)/);
    expect(dash, "голе число з обрізаного списку ніде не показується").not.toMatch(/pendingPaymentsTitle", \{ count: pendingPayments\.length \}/);
  });

  it("«Розклад»: майбутнє — від сьогодні за зростанням, минуле — окремо за спаданням", () => {
    expect(sched).toMatch(/\.order\("starts_at", \{ ascending: true \}\)\.order\("id"\)\.range\(from, to\), \{ cap: listCap \}\)/);
    expect(sched).toMatch(/\.order\("starts_at", \{ ascending: false \}\)\.order\("id"\)\.range\(from, to\), \{ cap: listCap \}\)/);
  });

  it("«Розклад»: якщо показано не все — це сказано словами і є кнопка «завантажити ще»", () => {
    expect(sched).toMatch(/data-list-cut=""/);
    expect(sched).toMatch(/schedule\.cutUpcoming/);
    expect(sched).toMatch(/schedule\.cutPast/);
    expect(sched).toMatch(/schedule\.cutLoadMore/);
    expect(sched).toMatch(/data-show-more-later=""/);
    for (const loc of ["uk", "en", "sv"]) {
      const s = read(`src/i18n/locales/${loc}.ts`);
      for (const k of ["cutUpcoming", "cutPast", "cutLoadMore"]) expect(s, `${loc}.${k}`).toMatch(new RegExp(`${k}: "`));
    }
  });

  it("«Фінанси»: уроки, групові уроки й рух гаманця дочитуються сторінками; стеля одна", () => {
    const n = (fin.match(/readAllPages<any>\(/g) ?? []).length;
    expect(n).toBeGreaterThanOrEqual(5);
    expect(fin).toMatch(/const FIN_CAP = 5000;/);
    expect(fin, "перевірка «обрізано» дивиться на ту саму стелю").toMatch(/\.length \?\? 0\) >= FIN_CAP/);
    expect(fin, "стара мовчазна стеля").not.toMatch(/\.limit\(2000\)/);
    // кожне дочитування має другий ключ порядку — інакше сторінки перекриваються
    const paged = fin.match(/build\(\)\.order\([^\n]*\.range\(from, to\)/g) ?? [];
    expect(paged.length).toBeGreaterThanOrEqual(4);
    for (const p of paged) expect(p).toMatch(/\.order\("id"\)\.range/);
  });

  it("запит «більше 1000 рядків одним шматком» у робочих екранах не зʼявляється", () => {
    // API поверне 1000 і промовчить. Лишились два свідомі місця: запасний шлях «Людей»
    // (працює лише коли немає RPC агрегатів) і службова сторінка метрик пейволу.
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== "test") walk(p); continue; }
        if (!/\.tsx?$/.test(name)) continue;
        readFileSync(p, "utf8").split("\n").forEach((line, i) => {
          const m = line.match(/\.limit\((\d+)\)/);
          if (m && Number(m[1]) > API_PAGE && !/^\s*(\/\/|\*)/.test(line)) hits.push(`${p.slice(process.cwd().length + 1)}:${i + 1}`);
        });
      }
    };
    walk(join(process.cwd(), "src"));
    expect(hits.map((h) => h.replace(/:\d+$/, "")).sort()).toEqual(["src/pages/PaywallMetricsPage.tsx", "src/pages/PeoplePage.tsx"]);
  });
});

describe("оболонка: один запит замість кількох однакових", () => {
  it("суперадмін, сповіщення, непрочитані чати, останні нагадування — через coalesce з id людини в ключі", () => {
    expect(read("src/hooks/useIsSuperadmin.ts")).toMatch(/coalesce\(/);
    expect(read("src/components/AppSidebar.tsx")).toMatch(/askIsSuperadmin\(/);
    expect(read("src/hooks/useNotifications.ts")).toMatch(/coalesce\(/);
    expect(read("src/hooks/useUnreadChats.ts")).toMatch(/coalesce\(\s*[`'"]unread-chats:/);
    expect(read("src/hooks/useLastReminders.ts")).toMatch(/coalesce\(/);
  });

  it("велика школа проходиться в CI після кожного пушу — і до репетиції відновлення", () => {
    const wf = read(".github/workflows/walks.yml");
    expect(wf).toMatch(/node scripts\/local-stack\/volume-walk\.mjs/);
    expect(wf.indexOf("volume-walk.mjs")).toBeLessThan(wf.indexOf("backup-restore.mjs drill"));
    const seed = read("scripts/local-stack/big-school.sql");
    expect(seed, "уроки щодня — інакше в неділю «сьогодні» порожнє і прохід нічого не доводить").toMatch(/r\.rn % 7/);
  });

  it("стенд обрізає відповіді так само, як прод (1000 рядків) — інакше обʼємні дефекти на ньому невидимі", () => {
    expect(read("scripts/local-stack/up.sh")).toMatch(/db-max-rows\s*=\s*1000/);
  });
});
