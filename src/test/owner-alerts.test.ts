import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isOwnerAlertType, ownerAlertTelegramText, safeAppPath } from "../../supabase/functions/_shared/ownerAlerts";
import { newRequestId, requestNotificationType } from "@/lib/notifications";
import { iconForType } from "@/components/NotificationBell";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Власниці в Telegram (26.10): запит на репетитора · заявка на Pro · відгук.
 * Поведінку бази доводить сценарій scripts/db-replay/scenarios/72-owner-alerts.sql;
 * тут — контракт між тригерами (тип `…_<id>`), send-push (дзеркало в Telegram)
 * і клієнтом (запасний шлях із тим самим типом, іконка дзвіночка).
 */

describe("send-push дзеркалить у Telegram лише типи заявок, поставлені тригером", () => {
  const id = "0f1e2d3c-4b5a-4a6f-8b7c-9d0e1f2a3b4c";

  it("тип з id заявки — так; голий тип, скасування, чужі типи — ні", () => {
    expect(isOwnerAlertType(`tutor_request_${id}`)).toBe(true);
    expect(isOwnerAlertType(`pro_request_${id}`)).toBe(true);
    expect(isOwnerAlertType(`feedback_new_${id}`)).toBe(true);
    expect(isOwnerAlertType("tutor_request")).toBe(false);           // стара збірка клієнта — лише push
    expect(isOwnerAlertType("tutor_request_cancelled")).toBe(false);  // інша подія, свій канал
    expect(isOwnerAlertType("pro_request")).toBe(false);
    expect(isOwnerAlertType("feedback_reply")).toBe(false);
    expect(isOwnerAlertType("lesson_reminder")).toBe(false);
    expect(isOwnerAlertType(undefined)).toBe(false);
  });

  it("текст: жирний заголовок, тіло, кнопка «Відкрити» лише на наш шлях; HTML екранується", () => {
    const t = ownerAlertTelegramText({ title: "🙋 <Марія> шукає", body: "a & b", link: "/referrals" });
    expect(t).toBe("<b>🙋 &lt;Марія&gt; шукає</b>\na &amp; b\n\n<a href=\"https://otutorhub.com/referrals\">Відкрити →</a>");
    expect(safeAppPath("https://evil.example/x")).toBe("/");
    expect(safeAppPath("//evil.example")).toBe("/");
    expect(safeAppPath("/feedback-inbox")).toBe("/feedback-inbox");
  });

  it("send-push кличе дзеркало ПІСЛЯ push і не залежить від його результату", () => {
    const s = noComments(read("supabase/functions/send-push/index.ts"));
    expect(s).toMatch(/import \{ mirrorOwnerAlertToTelegram \} from "\.\.\/_shared\/ownerAlerts\.ts"/);
    const fcm = s.indexOf("const sentNative = await fcmSendNative(");
    const tg = s.indexOf("await mirrorOwnerAlertToTelegram(db, Deno.env.get(\"TELEGRAM_BOT_TOKEN\")");
    expect(fcm).toBeGreaterThan(0);
    expect(tg).toBeGreaterThan(fcm);
    expect(s).toMatch(/JSON\.stringify\(\{ ok: true, sent, sentNative, telegram,/);
    const lib = noComments(read("supabase/functions/_shared/ownerAlerts.ts"));
    expect(lib, "дзеркало ніколи не кидає назовні").toMatch(/catch \(e\) \{[\s\S]*?return `failed:/);
  });
});

describe("клієнт: тип сповіщення несе id заявки — той самий, що й у рядку заявки", () => {
  it("newRequestId — uuid v4; requestNotificationType — <kind>_<id>", () => {
    const id = newRequestId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(requestNotificationType("tutor_request", id)).toBe(`tutor_request_${id}`);
    expect(isOwnerAlertType(requestNotificationType("pro_request", id)), "клієнтський тип = тип тригера = тип для Telegram").toBe(true);
  });

  for (const [file, kind, table] of [
    ["src/components/FindTutorDialog.tsx", "tutor_request", "tutor_referral_requests"],
    ["src/components/student/StudentOnboarding.tsx", "tutor_request", "tutor_referral_requests"],
    ["src/components/SubscriptionRequestDialog.tsx", "pro_request", "subscription_requests"],
  ] as const) {
    it(`${file}: id народжується до вставки, йде і в рядок, і в тип сповіщення`, () => {
      const s = noComments(read(file));
      expect(s).toMatch(/const requestId = newRequestId\(\);/);
      expect(s).toMatch(new RegExp(`from\\("${table}"\\)\\.insert\\(\\{\\s*id: requestId,`));
      expect(s).toMatch(new RegExp(`type: requestNotificationType\\("${kind}", requestId\\)`));
      expect(s, "сталий тип повернув би дедуп на 24 год (другий запит за день ковтався)").not.toMatch(new RegExp(`type: "${kind}"`));
    });
  }

  it("дзвіночок показує іконку за основою типу, не за точним збігом", () => {
    const id = "0f1e2d3c-4b5a-4a6f-8b7c-9d0e1f2a3b4c";
    expect(iconForType(`tutor_request_${id}`)).toBe("🙋");
    expect(iconForType(`pro_request_${id}`)).toBe("⭐");
    expect(iconForType(`feedback_new_${id}`)).toBe("💬");
    expect(iconForType("tutor_request")).toBe("🙋");
    expect(iconForType("something_else")).toBe("🔔");
  });
});

describe("міграція 20261026120000_owner_alerts і сценарій 72", () => {
  const MIG = "supabase/migrations/20261026120000_owner_alerts.sql";

  it("файли на місці; тригери на трьох таблицях; помічники закриті від браузера; стелі", () => {
    expect(existsSync(join(ROOT, MIG))).toBe(true);
    expect(existsSync(join(ROOT, "scripts/db-replay/scenarios/72-owner-alerts.sql"))).toBe(true);
    const m = read(MIG);
    for (const t of ["trg_notify_on_tutor_request ON public.tutor_referral_requests", "trg_notify_on_subscription_request ON public.subscription_requests", "trg_notify_on_feedback ON public.feedback_submissions"]) {
      expect(m).toContain(`DROP TRIGGER IF EXISTS ${t}`);
    }
    expect(m).toMatch(/REVOKE ALL ON FUNCTION public\.owner_alert\(uuid, text, text, text, text\) FROM PUBLIC, anon, authenticated/);
    expect(m).toMatch(/rate_limit_check\('owner_alert_author', _author::text, 5, 3600\)/);
    expect(m).toMatch(/rate_limit_check\('owner_alert_all', 'platform', 60, 3600\)/);
    // тригер ніколи не ламає вставку заявки
    expect((m.match(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING 'notify_on_/g) ?? []).length).toBe(3);
  });
});
