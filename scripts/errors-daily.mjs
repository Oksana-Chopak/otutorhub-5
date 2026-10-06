#!/usr/bin/env node
/**
 * errors-daily — щоденна рутина лог-менеджменту (02.10).
 * 1) читає помилки за добу групами з edge `errors-report` (CRON_SECRET);
 * 2) пише `errors-24h.json` (для Claude Code, якщо є ключ) і `ci-message.txt`
 *    (один рядок у Telegram через `ci-report`, як у ворот).
 * Вихід: 0 завжди — рутина інформує, а не ламає CI.
 */
import { writeFileSync } from "node:fs";

const base = process.env.SUPABASE_FUNCTIONS_URL ?? "https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1";
const secret = process.env.CRON_SECRET ?? "";
const runUrl = process.env.RUN_URL ?? "";
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

let report = { hours: 24, total: 0, new: 0, groups: [] };
let text;
if (!secret) {
  text = "🧯 Щоденні помилки: CRON_SECRET не заданий у GitHub — рутина не може прочитати журнал.";
} else {
  try {
    const res = await fetch(`${base}/errors-report?hours=24`, { headers: { "x-cron-secret": secret } });
    const body = await res.text();
    if (!res.ok) {
      // 06.10: перший запуск упав саме так — функція відповіла власним 403, бо
      // перевіряла vault-секрет pg_cron, а GitHub надсилає env CRON_SECRET.
      // Рядок у Telegram мусить називати причину, а не питати «передеплоєна?».
      const why = res.status === 401 || res.status === 403
        ? "секрет не збігається: CRON_SECRET у GitHub ≠ тому, що перевіряє errors-report (у неї мають бути env CRON_SECRET або vault)"
        : res.status === 404
          ? "функції errors-report немає на проді — вона не задеплоєна (config.toml + передеплой edge)"
          : `edge errors-report відповіла ${res.status} ${body.slice(0, 160)}`;
      throw new Error(why);
    }
    report = JSON.parse(body);
    if (report.total === 0) {
      text = "🧯 Щоденні помилки: за добу жодної ✓";
    } else {
      const top = report.groups.slice(0, 5).map((g) => `• ${g.is_new ? "<b>НОВА</b> " : ""}×${g.hits} ${esc(String(g.sample).slice(0, 90))}${g.url ? ` (${esc(g.url)})` : ""}`);
      text = `🧯 Щоденні помилки: <b>${report.total}</b> груп, нових <b>${report.new}</b>\n${top.join("\n")}${runUrl ? `\nЗвіт: ${runUrl}` : ""}`;
    }
  } catch (e) {
    text = `🔴 Щоденні помилки: не вдалося прочитати журнал — ${esc(e.message)}.`;
  }
}
writeFileSync("errors-24h.json", JSON.stringify(report, null, 2));
writeFileSync("ci-message.txt", text);
console.log(text);
writeFileSync(process.env.GITHUB_OUTPUT ?? "/dev/null", `new=${report.new}\ntotal=${report.total}\n`, { flag: "a" });
