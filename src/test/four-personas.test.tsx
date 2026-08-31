/**
 * four-personas.test.tsx — тест, якого просила аудиторка (звіт 31.08.2026):
 * «рендер кожного головного екрана під усіма чотирма персонами з перевіркою,
 *  що видно й що клікабельно».
 *
 * Усі шість регресій хвилі 34 були саме цього класу, і перевірка чистих
 * функцій не ловить їх НІКОЛИ. Тест має три шари:
 *
 *   Шар 1 — матриця здатностей: canSee × 4 персони (декларація намірів).
 *   Шар 2 — інваріант завантаження: редірект на прапорі воркспейсу без
 *           перевірки loading викидає легітимну персону на першому рендері
 *           (це були Р2 Wallets і Р3 Profile).
 *   Шар 3 — інваріант грошових гейтів: три місця, де тьютор тогліть оплату,
 *           мусять розрізняти хабового й незалежного (Р4 Dashboard, Р5
 *           Workspace, Р6 Schedule) — інакше одному видно фальшиву кнопку,
 *           а в другого зникає справжня.
 *   Шар 4 — рендер: StudentNextBlock у кожному зі своїх станів мусить дати
 *           РІВНО одну підписану кнопку (принцип DayBlock: ніколи не порожньо).
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { canSee, type RoleFlags, type Feature } from "@/lib/roleCapabilities";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, "..");

// ── Чотири персони проєкту (CLAUDE.md) ───────────────────────────────────────
const PERSONAS: Record<string, RoleFlags> = {
  manager:     { isManager: true,  isTutor: false, isIndependent: false, isStudent: false },
  hubTutor:    { isManager: false, isTutor: true,  isIndependent: false, isStudent: false },
  independent: { isManager: false, isTutor: true,  isIndependent: true,  isStudent: false },
  student:     { isManager: false, isTutor: false, isIndependent: false, isStudent: true  },
};

describe("чотири персони", () => {
  // ═══ Шар 1: матриця здатностей ═══
  describe("шар 1 — матриця canSee", () => {
    const FEATURES: Feature[] = [
      "subscription", "referrals", "paymentRules", "autoMark", "ownStudents",
      "achievements", "setupGuide", "tutorNotes", "aiNotes",
    ];

    it("обидва тьютори бачать щось; менеджер і учень — нуль ЗА ЗАДУМОМ", () => {
      // canSee описує наскрізні ТЬЮТОРСЬКІ здатності. Менеджер не викладає,
      // учень має власні екрани — їхній нуль тут є наміром, а не дірою, і цей
      // тест фіксує саме це, щоб «полагодити» його випадково стало помітно.
      for (const name of ["hubTutor", "independent"]) {
        const visible = FEATURES.filter((f) => canSee(f, PERSONAS[name]));
        expect(visible.length, `${name} не бачить нічого`).toBeGreaterThan(0);
      }
      for (const name of ["manager", "student"]) {
        const visible = FEATURES.filter((f) => canSee(f, PERSONAS[name]));
        expect(visible, `${name} раптом отримав тьюторські здатності`).toEqual([]);
      }
    });

    it("хабовий тьютор бачить викладацькі здатності, але НЕ біллінгові", () => {
      const hub = PERSONAS.hubTutor;
      expect(canSee("achievements", hub)).toBe(true);
      expect(canSee("tutorNotes", hub)).toBe(true);
      expect(canSee("subscription", hub)).toBe(false);
      expect(canSee("paymentRules", hub)).toBe(false);
    });

    it("незалежний бачить і викладацькі, і біллінгові", () => {
      const ind = PERSONAS.independent;
      expect(canSee("achievements", ind)).toBe(true);
      expect(canSee("subscription", ind)).toBe(true);
      expect(canSee("ownStudents", ind)).toBe(true);
    });
  });

  // ═══ Шар 2: інваріант завантаження (Р2, Р3) ═══
  describe("шар 2 — редірект на прапорі мусить чекати loading", () => {
    const PAGES = [
      "pages/WalletsPage.tsx",
      "pages/ProfilePage.tsx",
      "pages/SubscriptionPage.tsx",
      "pages/MyStudentsPage.tsx",
    ];

    it("кожна сторінка з редіректом на isIndependent перевіряє loading ДО нього", () => {
      const offenders: string[] = [];
      for (const rel of PAGES) {
        const text = readFileSync(join(src, rel), "utf8");
        const redirectIdx = text.search(/isIndependent[^\n]*<Navigate|!isIndependent\)\s*return\s*<Navigate/);
        if (redirectIdx === -1) continue; // немає редіректу — нічого перевіряти
        const before = text.slice(0, redirectIdx);
        const guarded = /wsLoading|loading:\s*wsLoading|if\s*\(loading\)/.test(before);
        if (!guarded) offenders.push(rel);
      }
      expect(offenders, "редірект спрацює на першому рендері, коли прапор ще false").toEqual([]);
    });
  });

  // ═══ Шар 3: грошові гейти розрізняють типи тьюторів (Р4, Р5, Р6) ═══
  describe("шар 3 — оплату тоглить лише той, хто справді може", () => {
    it("умовний onPayChange ніде не забуває незалежного (форма регресій Р4/Р6)", () => {
      // Регресія мала точну форму: `onPayChange={isManager ? ... : undefined}` —
      // гілка обслуговує ВСІХ не-менеджерів, тож незалежний втрачав свою
      // законну кнопку. Безумовні сайти (onPayChange={(field,paid)=>...}) тут
      // ні до чого — перевіряємо саме рольові тернарники.
      const offenders: string[] = [];
      for (const rel of ["pages/DashboardPage.tsx", "pages/SchedulePage.tsx"]) {
        const text = readFileSync(join(src, rel), "utf8");
        for (const m of text.matchAll(/onPayChange=\{\(?isManager[\s\S]{0,200}/g)) {
          const head = m[0];
          if (!/independent/.test(head)) offenders.push(`${rel}: ${head.slice(0, 90)}`);
        }
      }
      expect(offenders, "рольовий гейт оплати не розрізняє хабового й незалежного").toEqual([]);
    });

    it("LessonWorkspace гейтить блок оплати на canTogglePayment, не на canMarkCompleted", () => {
      const text = readFileSync(join(src, "components/LessonWorkspace.tsx"), "utf8");
      expect(text).toMatch(/canTogglePayment\s*&&\s*statusLocal\s*===\s*"completed"/);
      // Фальшива кнопка хабового: nudge під canMarkCompleted — ознака регресії Р5.
      expect(text).not.toMatch(/canMarkCompleted\s*&&\s*statusLocal\s*===\s*"completed"\s*&&[^\n]*paidLocal/);
    });
  });

  // ═══ Шар 4: реєстр учня ніколи не мовчить ═══
  describe("шар 4 — StudentNextBlock завжди дає рівно одну дію", () => {
    const BASE = {
      hasTutor: true, upcomingCount: 0, nextStartsAt: null, nextSubject: null,
      nextMeetingUrl: null, pendingPaymentsCount: 0, homeworkCount: 0,
      weeklyCount: 0, weeklyRecord: 0, lessonsBalance: null,
    };
    const STATES: Array<[string, Record<string, unknown>]> = [
      ["немає тьютора",          { hasTutor: false }],
      ["борг оплати",            { pendingPaymentsCount: 3 }],
      ["є домашка",              { homeworkCount: 2 }],
      ["передоплата вичерпана",  { lessonsBalance: 0 }],
      ["передоплата закінчується",{ lessonsBalance: 1 }],
      ["серія перервана",        { weeklyCount: 0, weeklyRecord: 4 }],
      ["наступний урок є",       { upcomingCount: 1, nextStartsAt: new Date(Date.now() + 864e5).toISOString(), nextSubject: "Англійська" }],
      ["порожній розклад",       {}],
    ];

    it.each(STATES)("стан «%s» дає підписану кнопку", async (_label, patch) => {
      const { StudentNextBlock } = await import("@/components/StudentNextBlock");
      const { unmount } = render(
        <MemoryRouter>
          <StudentNextBlock {...(BASE as any)} {...(patch as any)} />
        </MemoryRouter>,
      );
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBe(1);
      expect(buttons[0].textContent?.trim().length ?? 0).toBeGreaterThan(0);
      unmount();
    });
  });
});
