import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname ?? __dirname, "..", "..");
const SRC = readFileSync(join(ROOT, "supabase/functions/telegram-poll/index.ts"), "utf8");

/**
 * Telegram: вебхук замість опитування щохвилини (25.10).
 *
 * Чому ратчети на текст, а не юніт-тести: функція — Deno-код з імпортами з
 * esm.sh, vitest її не підніме. Тому стережемо саме ті властивості, на яких
 * тримається безпека й цілість грошових кнопок.
 */
describe("Telegram: вебхук", () => {
  it("публічні двері зачинені секретним заголовком, і відмова — 401, а не 200", () => {
    // verify_jwt = false, тож заголовок — ЄДИНІ двері.
    expect(SRC).toContain('req.headers.get("x-telegram-bot-api-secret-token")');
    const wr = SRC.slice(SRC.indexOf("async function webhookRun"));
    expect(wr, "секрет звіряється з тим самим джерелом, що й крон").toContain('supabase.rpc("get_cron_shared_secret")');
    const forbidden = wr.slice(wr.indexOf('error: "Forbidden"'), wr.indexOf('error: "Forbidden"') + 120);
    expect(forbidden, "401 → Telegram ПОВТОРИТЬ доставку, тож натиснута кнопка не губиться").toContain("401");
  });

  it("повторна доставка того самого апдейта не виконується двічі", () => {
    // Telegram повторює доставку, якщо не дочекався відповіді — навіть коли
    // робота вже зроблена. Без цього «Оплачено» могло б закрити борг двічі.
    const wr = SRC.slice(SRC.indexOf("async function webhookRun"));
    expect(wr).toContain('rateLimit(supabase, "telegram_update", String(id)');
    expect(wr, "дедуп саме по update_id").toContain("const id = Number(u?.update_id)");
  });

  it("обробка апдейта — ОДНА для крону й для вебхука", () => {
    // Дві копії розійдуться, і кнопка, що працює з опитування, тихо перестане
    // працювати з вебхука.
    expect((SRC.match(/async function processUpdate\(/g) ?? []).length).toBe(1);
    expect((SRC.match(/if \(u\.callback_query\)/g) ?? []).length, "єдине місце, де розбираються кнопки").toBe(1);
    expect((SRC.match(/processUpdate\(TG_BASE, supabase, u,/g) ?? []).length, "обидва шляхи кличуть ту саму функцію").toBe(2);
  });

  it("бот не замовкає: якщо вебхук не піднявся — крон опитує по-старому", () => {
    const cr = SRC.slice(SRC.indexOf("async function cronRun"), SRC.indexOf("function webhookUrl"));
    expect(cr, "вебхук перевіряється до оренди опитування").toContain("ensureWebhook(TG_BASE, supabaseUrl");
    expect(cr, "тільки живий вебхук скасовує опитування цього запуску").toContain("if (w.active) return new Response");
    expect(cr, "а не активний — йдемо в getUpdates, як раніше").toContain("падаю на опитування");
    expect(SRC, "довге опитування лишилось цілим").toContain("/getUpdates");
  });

  it("вебхук самолікується після ротації секрету", () => {
    // 06.10 секрет крону ротується. Telegram ще шле СТАРИЙ токен, ми віддаємо
    // 401 — і це видно в getWebhookInfo.last_error_message. Сторож мусить
    // перевстановити вебхук з чинним секретом, інакше бот мовчить назавжди.
    const ew = SRC.slice(SRC.indexOf("async function ensureWebhook"), SRC.indexOf("async function webhookRun"));
    expect(ew).toContain("last_error_message");
    expect(ew, "401/403 від нас = перевстановити").toMatch(/\(401\|403\)/);
    expect(ew, "адреса не вшита, а з env").toContain("webhookUrl(supabaseUrl)");
    expect(ew, "накопичене за час опитування не викидаємо").toContain("drop_pending_updates: false");
  });

  it("доставка вебхука НЕ пишеться в job_runs як запуск процесу", () => {
    // Інакше кожне повідомлення в боті ставало б рядком у зведенні «🛡 Нічні
    // процеси» і топило б справжні нічні процеси.
    const disp = SRC.slice(SRC.indexOf("Deno.serve(async (req)"), SRC.indexOf("async function cronRun"));
    expect(disp, "гілка вебхука — без withJob").toContain("return await webhookRun(req);");
    expect(disp, "withJob лишається лише на кроні").toContain('withJob("telegram-poll", cronRun)');
  });

  it("відкат описаний у коді й не потребує ні SQL, ні секретів", () => {
    expect(SRC).toContain("const USE_WEBHOOK = true;");
    expect(SRC, "false → сторож знімає вебхук").toContain("/deleteWebhook");
  });
});

/**
 * Пастка 25.10, знайдена на собі: у шапці міграції стояв крон-розклад
 * «зірочка-слеш-пʼять», і ця послідовність ЗАКРИЛА блоковий коментар на
 * середині речення. Решта прози поїхала в парсер як SQL: «syntax error at or
 * near 5». Власниця побачила б у SQL editor Lovable лише цей рядок і не мала б
 * шансу зрозуміти, що сталось. Тому це ворота, а не урок на згадку.
 *
 * (Той самий слід є і в цьому файлі: перший варіант цього ж коментаря так само
 * обірвався, і vitest не зміг розібрати тест. Дешеве підтвердження, що
 * перевірка стереже справжню пастку, а не вигадану.)
 */
describe("міграції: блоковий коментар не закривається на середині", () => {
  const MIG = join(ROOT, "supabase/migrations");
  const files = readdirSync(MIG).filter((f) => f.endsWith(".sql"));

  /* Сканер, який знає, де в SQL коментар, а де — рядок. Інакше ловить сам себе:
     розклад '*' + '/5 * * * *' У РЯДКОВОМУ ЛІТЕРАЛІ законний, а той самий текст
     у коментарі обриває коментар. Тому дивимось лише на стан «усередині
     блокового коментаря». */
  const scan = (sql: string) => {
    const hits: string[] = [];
    let i = 0, line = 1, inBlock = false, dollar: string | null = null, inStr = false;
    while (i < sql.length) {
      const ch = sql[i], two = sql.slice(i, i + 2);
      if (ch === "\n") { line++; i++; continue; }
      if (dollar) { if (sql.startsWith(dollar, i)) { i += dollar.length; dollar = null; } else i++; continue; }
      if (inStr) { if (ch === "'") { if (sql[i + 1] === "'") i += 2; else { inStr = false; i++; } } else i++; continue; }
      if (inBlock) {
        if (two === "*/") {
          inBlock = false; i += 2;
          const nl = sql.indexOf("\n", i);
          const after = sql.slice(i, nl < 0 ? sql.length : nl);
          if (/\d/.test(after.slice(0, 1))) hits.push(`рядок ${line}: закривач перед цифрою — це крон у коментарі`);
          else if (/[А-Яа-яЇїІіЄєҐґ]/.test(after)) hits.push(`рядок ${line}: після закривача проза «${after.trim().slice(0, 36)}»`);
          continue;
        }
        i++; continue;
      }
      if (two === "/*") { inBlock = true; i += 2; continue; }
      if (two === "--") { const nl = sql.indexOf("\n", i); i = nl < 0 ? sql.length : nl; continue; }
      const dm = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (dm) { dollar = dm[0]; i += dm[0].length; continue; }
      if (ch === "'") { inStr = true; i++; continue; }
      i++;
    }
    if (inBlock) hits.push("блоковий коментар так і не закрився");
    return hits;
  };

  it("файлів багато — перевірка не вакуумна", () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it("жодна міграція не обриває коментар на середині речення", () => {
    const bad = files.flatMap((f) => scan(readFileSync(join(MIG, f), "utf8")).map((h) => `${f} → ${h}`));
    expect(bad).toEqual([]);
  });

  it("сканер ловить саму пастку і не ловить законний розклад у рядку", () => {
    // Без цього попередні два тести могли б бути вакуумними.
    expect(scan("/* сторож на */5 * * * * — і далі проза */ SELECT 1;").length).toBeGreaterThan(0);
    expect(scan("SELECT cron.schedule('watch', '*/5 * * * *', $cron$SELECT 1;$cron$);")).toEqual([]);
    expect(scan("/* звичайна шапка\n   другий рядок */\nSELECT 1;")).toEqual([]);
    expect(scan("/* inline */ SELECT 1;")).toEqual([]);
  });
});