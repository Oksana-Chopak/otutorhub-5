import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

/**
 * Гейт «колонки в запитах існують у живій схемі» (13.09).
 *
 * Клас помилки, який не ловить ні typecheck, ні vitest, ні build: рядок у
 * `.select("…")` — просто рядок. Так у прод поїхали `lesson_details.currency`
 * (матеріали учня порожні), `lessons.location` (Google Calendar 500),
 * `tutor_workspace_settings.user_id` (CRM суперадміна без репетиторів),
 * `lesson_participants.status` (домашка групі не доходила). Кожен — «полагодив
 * одне, зламав повʼязане», бо колонка існувала лише в голові автора.
 *
 * Скрипт звіряє КОЖЕН `.from("t").select("…")` і `.rpc("fn")` у src/ і
 * supabase/functions/ з `types.ts` — живим дзеркалом схеми. Червоний = у коді
 * є звернення до того, чого в базі немає. Ніяких «попереджень».
 */
describe("гейт запитів до схеми (scripts/check-db-select.mjs)", () => {
  it("усі select/rpc відповідають живій схемі", () => {
    expect(() =>
      execFileSync("node", ["scripts/check-db-select.mjs"], { stdio: "pipe", encoding: "utf-8" }),
    ).not.toThrow();
  }, 60_000);
});
