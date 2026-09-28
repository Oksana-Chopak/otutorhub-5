#!/usr/bin/env node
/**
 * mutation-notify — один рядок власниці про мутаційне тестування грошових бібліотек
 * (27.09, «Ворота, що спали»). Читає reports/mutation/mutation.json (Stryker) і пише
 * ci-message.txt для edge `ci-report`, як ci-notify.mjs.
 *
 * Що це: Stryker ламає код (міняє «>» на «>=», «paid» на «», прибирає умови) і
 * дивиться, чи тести це помічають. Живий мутант = зміна грошової логіки, яку
 * жоден тест не ловить. Стеля: ≥ 85 % убитих — інакше «🔴».
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const file = process.env.MUTATION_REPORT ?? "reports/mutation/mutation.json";
const runUrl = process.env.RUN_URL ?? "";
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

let text;
if (!existsSync(file)) {
  text = `🔴 Мутаційне тестування грошей: звіт не створено (Stryker упав). ${runUrl ? `Деталі: ${runUrl}` : ""}`;
} else {
  const rep = JSON.parse(readFileSync(file, "utf8"));
  const perFile = [];
  let killed = 0, total = 0;
  for (const [name, f] of Object.entries(rep.files ?? {})) {
    const counted = f.mutants.filter((m) => m.status !== "Ignored");
    const k = counted.filter((m) => ["Killed", "Timeout", "RuntimeError", "CompileError"].includes(m.status)).length;
    killed += k; total += counted.length;
    const short = name.split("/").pop().replace(/\.ts$/, "");
    perFile.push(`${esc(short)} ${counted.length ? Math.round((k / counted.length) * 100) : 100}%`);
  }
  const score = total ? Math.round((killed / total) * 1000) / 10 : 100;
  const verdict = score >= 85 ? "🟢" : "🔴";
  text =
    `${verdict} Мутаційне тестування грошей: <b>${score}%</b> змін логіки ловлять тести (${killed}/${total}). ` +
    perFile.join(" · ") +
    (score < 85 ? ". Нижче стелі 85 % — скинути агентові: живі мутанти = гроші, які можна зіпсувати непомітно" : "") +
    (runUrl ? `\nЗвіт: ${runUrl}` : "");
}
writeFileSync("ci-message.txt", text);
console.log(text);
