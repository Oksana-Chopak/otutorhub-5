import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  splitStatements,
  persistentStatements,
  normalizeStatement,
  indexAppliedStatements,
  proveByContent,
  acceptsHashFor,
} from "../../scripts/db-replay/sql-statements.mjs";

/**
 * Доказ змістом для воріт db-sync (06.10).
 *
 * 02.10 main став червоним після того, як власниця вставила SQL: Lovable записав
 * його хеш-файлом, водяний знак переїхав через нашу міграцію, а журнал ще казав
 * «чекає». Тобто ворота червоніли через РОЗМІТКУ, а не через базу. Тепер файл
 * нижче знаку доводиться постатейно по хеш-файлах Lovable. Цей тест тримає
 * розбивач SQL і правило доказу: що саме вважається «тим самим», а що — ні.
 */
const ROOT = join(__dirname, "../..");
const MIG = join(ROOT, "supabase/migrations");
const isHash = (f: string) => /^\d{14}_[0-9a-f]{8}-[0-9a-f]{4}-/.test(f);

describe("розбивач SQL на statements", () => {
  it("крапка з комою всередині рядка, тіла $$ і коментаря не розриває statement", () => {
    const sql = `
      -- коментар; з крапкою з комою
      INSERT INTO t(a) VALUES ('x; y'); /* блок; */
      CREATE OR REPLACE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$
      BEGIN
        -- всередині; тіла
        PERFORM 1; PERFORM 2;
      END $$;
      CREATE FUNCTION g() RETURNS text LANGUAGE sql AS $fn$ SELECT 'a;b' $fn$;
      GRANT SELECT ON "weird;name" TO anon
    `;
    const parts = splitStatements(sql);
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("INSERT INTO t(a) VALUES ('x; y')");
    expect(parts[1]).toContain("PERFORM 1; PERFORM 2;");
    expect(parts[1]).not.toContain("всередині"); // коментар у тілі прибрано
    expect(parts[2]).toContain("$fn$ SELECT 'a;b' $fn$");
    expect(parts[3]).toBe('GRANT SELECT ON "weird;name" TO anon');
  });

  it("подвоєні лапки в рядку ('it''s;') лишаються одним рядком", () => {
    expect(splitStatements("SELECT 'it''s; fine'; SELECT 2")).toEqual(["SELECT 'it''s; fine'", "SELECT 2"]);
  });

  it("канонічна форма: пробіли й SET search_path у заголовку не роблять функцію «іншою»", () => {
    const a = normalizeStatement("CREATE OR REPLACE FUNCTION public.f(_x text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT _x $$");
    const b = normalizeStatement("CREATE OR REPLACE FUNCTION public.f( _x text )\n RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT _x $$");
    expect(a).toBe(b);
    // а інше тіло — інша функція
    const c = normalizeStatement("CREATE OR REPLACE FUNCTION public.f(_x text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT upper(_x) $$");
    expect(c).not.toBe(a);
  });

  it("COMMENT ON і DO-самоперевірки не лишають сліду в базі — у доказ не входять", () => {
    const sts = persistentStatements(`
      COMMENT ON TABLE t IS 'x';
      DO $$ BEGIN RAISE NOTICE 'ok'; END $$;
      GRANT EXECUTE ON FUNCTION public.f() TO service_role;
    `);
    expect(sts).toEqual(["GRANT EXECUTE ON FUNCTION public.f()TO service_role"]);
  });
});

describe("правило доказу", () => {
  const ours = persistentStatements(`
    CREATE TABLE public.demo(id int);
    GRANT SELECT ON public.demo TO anon;
  `);

  it("усі statements у хеш-файлі, записаному ПІСЛЯ міграції → доведено", () => {
    const idx = indexAppliedStatements([
      { file: "20261006150000_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.sql", sql: "-- Lovable\nCREATE TABLE public.demo(id int);\nGRANT SELECT ON public.demo TO anon;\nREVOKE ALL ON public.demo FROM PUBLIC;" },
    ]);
    const p = proveByContent(ours, idx, acceptsHashFor("20261006120000_demo.sql"));
    expect(p.proven).toBe(true);
    expect(p.files).toEqual(["20261006150000_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.sql"]);
  });

  it("хоч один statement відсутній або інший → НЕ доведено, і видно, який саме", () => {
    const idx = indexAppliedStatements([
      { file: "20261006150000_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.sql", sql: "CREATE TABLE public.demo(id int);\nGRANT SELECT ON public.demo TO authenticated;" },
    ]);
    const p = proveByContent(ours, idx, acceptsHashFor("20261006120000_demo.sql"));
    expect(p.proven).toBe(false);
    expect(p.missing).toEqual(["GRANT SELECT ON public.demo TO anon"]);
  });

  it("ті самі statements у СТАРОМУ хеш-файлі (раніше за міграцію мінус доба) доказом не є", () => {
    // Саме так виглядає перевидання прав після «security findings»: GRANT уже
    // був у вересневій вставці, але Lovable його забрав — і нова вставка ще не зроблена.
    const idx = indexAppliedStatements([
      { file: "20260929114620_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.sql", sql: "CREATE TABLE public.demo(id int);\nGRANT SELECT ON public.demo TO anon;" },
    ]);
    expect(proveByContent(ours, idx, acceptsHashFor("20261006120000_demo.sql")).proven).toBe(false);
    // …а той самий хеш-файл, записаний того ж дня трохи РАНІШЕ за назву міграції (29.09: 11:46 проти 12:00) — є
    expect(proveByContent(ours, idx, acceptsHashFor("20260929120000_demo.sql")).proven).toBe(true);
  });

  it("файл без жодного statement, що лишає слід (лише DO/COMMENT), змістом не доводиться — лише журналом", () => {
    const only = persistentStatements("DO $$ BEGIN PERFORM 1; END $$;");
    expect(only).toEqual([]);
    expect(proveByContent(only, new Map(), () => true).proven).toBe(false);
  });
});

describe("живі пари «наша міграція → хеш-файл Lovable» доводяться (регресія на реальних файлах)", () => {
  const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
  const idx = indexAppliedStatements(files.filter(isHash).map((file) => ({ file, sql: readFileSync(join(MIG, file), "utf8") })));
  // 27.09 (пакет із 6 міграцій → один хеш-файл 29.09), 29.09 (права), 02.10 (аналітика: Lovable
  // дописав SET search_path в error_signature — усе одно та сама функція).
  for (const f of [
    "20260927120000_role_of_other_user.sql",
    "20260927150000_public_doors.sql",
    "20260927160000_ai_calls.sql",
    "20260927170000_job_runs.sql",
    "20260927180000_invite_tokens.sql",
    "20260927190000_server_core_lock.sql",
    "20260929120000_reassert_edge_grants.sql",
    "20261002120000_product_analytics.sql",
  ]) {
    it(f, () => {
      const p = proveByContent(persistentStatements(readFileSync(join(MIG, f), "utf8")), idx, acceptsHashFor(f));
      expect(p.missing, `не знайдено у хеш-файлах: ${p.missing.map((s) => s.slice(0, 80)).join(" | ")}`).toEqual([]);
      expect(p.proven).toBe(true);
    });
  }
});

/**
 * 24.10 — СЛІПА ПЛЯМА ВОРІТ СХЕМИ, через яку журнал помилок помер непомітно.
 *
 * `check-db-select` мав рівно одне правило на RPC: `.rpc("x"`. Але половина
 * застосунку кличе їх як `(supabase.rpc as any)("x", …)` — каст ставить `)` між
 * `.rpc` і `(`, і регулярка такий виклик НЕ бачила: з 80 різних RPC ворота
 * бачили 49. Саме в сліпій половині сидів `log_client_error`: код поїхав у прод
 * 21.10, функції в базі немає (міграція 20261020100000 не вставлена), тож
 * ЖОДНА помилка з браузера не писалась у журнал — а ворота звітували «усі
 * select/rpc відповідають живій схемі». Доказ на живому проді: у /errors
 * останній запис 19.10, при тому що збірка 21.10.
 */
describe("ворота схеми бачать усі форми виклику RPC", () => {
  const gate = readFileSync(join(ROOT, "scripts/check-db-select.mjs"), "utf8");
  const shapes = gate.slice(gate.indexOf("RPC_SHAPES"), gate.indexOf("RPC_SHAPES") + 700);

  it("форм більше однієї, і серед них — та, що з кастом", () => {
    expect(gate).toContain("RPC_SHAPES");
    expect((shapes.match(/\.rpc/g) ?? []).length, "три форми виклику").toBeGreaterThanOrEqual(3);
    expect(shapes, "форма «(supabase.rpc as any)(…)» — та, що ховала log_client_error").toContain("any");
    expect(gate, "старого одинокого правила більше немає").not.toContain("const rpcRe =");
  });

  it("каст справді вживається в застосунку — інакше перевірка вакуумна", () => {
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const p2 = join(d, e.name);
        return e.isDirectory() ? walk(p2) : /\.tsx?$/.test(e.name) ? [p2] : [];
      });
    const users = walk(join(ROOT, "src"))
      .filter((f) => !/[\\/]test[\\/]|\.test\./.test(f))
      .filter((f) => /\.rpc as any\)\s*\(/.test(readFileSync(f, "utf8")));
    expect(users.length, "каст є в бойовому коді, тож форму мусить бачити гейт").toBeGreaterThan(0);
  });

  it("«чекає вставки» і «немає ніде» — різні вердикти", () => {
    // Червоне на справному стані вчить ігнорувати червоне: функція з
    // невставленої міграції — жовтий рядок із назвою міграції, не падіння.
    expect(gate).toContain("if (pendingFns.has(fn)) pending.push(");
    expect(gate).toContain("else problems.push(");
    expect(gate, "черга визначається водяним знаком, а не списком руками")
      .toContain("x.slice(0, 14) > watermark");
  });
});
