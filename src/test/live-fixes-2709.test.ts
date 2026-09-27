import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/**
 * Живі скарги власниці 27.09, знайдені нею на проді за півгодини після релізу:
 *  • «Цей email належить іншому акаунту» на її ж тестовому учні;
 *  • тости «дуже надокучливі, білі і порожні»;
 *  • закриття тоста ХРЕСТИКОМ убило заповнену форму уроку разом із даними;
 *  • вікно підтримки на лендінгу «зникло».
 */

describe("клік по тосту більше не вбиває форму", () => {
  const d = () => read("src/components/ui/dialog.tsx");

  it("натискання в шарі тостів не рахується «кліком поза діалогом»", () => {
    const s = d();
    expect(s).toMatch(/const isInsideToaster = \(target: EventTarget \| null\) =>/);
    expect(s).toMatch(/closest\("\[data-sonner-toaster\]"\)/);
    expect((s.match(/event\.preventDefault\(\);/g) ?? []).length,
      "обидва канали Radix: pointerDownOutside і interactOutside").toBeGreaterThanOrEqual(2);
  });

  it("обробники з пропів НЕ губляться — інакше зламаються діалоги, що ними керують", () => {
    const s = d();
    expect(s).toMatch(/onPointerDownOutside\?\.\(event\);/);
    expect(s).toMatch(/onInteractOutside\?\.\(event\);/);
    expect(s, "проп мусить бути витягнутий, інакше {...props} перезапише наш обробник")
      .toMatch(/\{ className, children, onPointerDownOutside, onInteractOutside, \.\.\.props \}/);
  });
});

describe("тости не накопичуються стосом", () => {
  const s = () => read("src/components/ui/sonner.tsx");

  it("вони зникають самі — «вічний» показ прибрано", () => {
    /* Коментарі не рахуємо: у файлі свідомо лишилась ІСТОРІЯ рішення 28.07,
       і саме її згадка не мусить видавати себе за живий код. */
    const code = s()
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(code, "duration={Infinity} і був причиною білих порожніх карток у стосі")
      .not.toMatch(/duration=\{Infinity\}/);
    expect(code).toMatch(/duration=\{8000\}/);
  });

  it("одночасно видно не більше двох", () => {
    expect(s()).toMatch(/visibleToasts=\{2\}/);
  });

  it("хрестик лишився — прибрати одразу досі можна", () => {
    expect(s()).toMatch(/closeButton/);
  });
});

describe("тост без тексту неможливий", () => {
  it("сирий message більше не є ЄДИНИМ вмістом тоста", () => {
    for (const f of ["src/components/CurrencyComboBox.tsx", "src/pages/GroupsPage.tsx", "src/pages/ErrorLogPage.tsx"]) {
      const s = read(f);
      expect(s, `${f}: порожній message давав білу картку без тексту`)
        .not.toMatch(/toast\.error\((err|error|upErr)\.message\);/);
      expect(s).toMatch(/description: (err|error|upErr)\.message \|\| undefined/);
    }
  });
});

describe("підтримка на лендінгу", () => {
  const b = () => read("src/components/landing/LandingSupportBubble.tsx");

  it("закриття памʼятається на ДОБУ, а не до кінця сесії браузера", () => {
    const s = b();
    expect(s, "sessionStorage означало «назавжди»: вкладку не закривають тижнями")
      .not.toMatch(/sessionStorage\.(getItem|setItem)\("otutorhub_support_bubble"/);
    expect(s).toMatch(/const DISMISS_MS = 24 \* 60 \* 60 \* 1000;/);
    expect(s).toMatch(/localStorage\.setItem\(DISMISS_KEY, String\(Date\.now\(\) \+ DISMISS_MS\)\)/);
    expect(s).toMatch(/until > Date\.now\(\)/);
  });

  it("форма звʼязку є навіть без Telegram", () => {
    const s = b();
    expect(s).toMatch(/<LandingContactDialog open=\{formOpen\}/);
    expect(s, "умова показу більше не вимагає посилання на Telegram")
      .not.toMatch(/if \(!url \|\| hidden/);
    expect(s).toMatch(/\{url && \(/);
  });

  it("форма пише в ТУ САМУ скриньку, з якої власниця вміє відповідати", () => {
    const d = read("src/components/landing/LandingContactDialog.tsx");
    expect(d).toMatch(/rpc as any\)\("submit_landing_feedback"/);
    expect(d, "ліміт бази має людський текст, а не сирий код").toMatch(/RATE_LIMITED.*landingContact\.rateLimited/s);
    expect(d, "«надіслано» лише після відповіді бази").toMatch(/setSent\(true\);/);
    expect(d).toMatch(/_contact: contact\.trim\(\) \|\| null/);
  });

  it("скринька показує, КУДИ відповідати анонімному", () => {
    const i = read("src/pages/FeedbackInboxPage.tsx");
    expect(i).toMatch(/contact\?: string \| null;/);
    expect(i).toMatch(/feedbackInbox\.contactLabel/);
  });
});

describe("міграція: роль ЧУЖОГО користувача", () => {
  const m = () => read("supabase/migrations/20260927120000_role_of_other_user.sql");

  it("нова функція читає user_roles напряму і не має грантів", () => {
    const s = m();
    expect(s).toMatch(/CREATE OR REPLACE FUNCTION public\.user_has_role\(_user_id uuid, _role app_role\)/);
    expect(s).toMatch(/FROM public\.user_roles\s*\n\s*WHERE user_id = _user_id AND role = _role/);
    for (const who of ["PUBLIC", "anon", "authenticated"]) {
      expect(s, `EXECUTE для ${who} має бути відкликано`).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.user_has_role\\(uuid, app_role\\) FROM ${who};`));
    }
  });

  it("усі три місця, де питали роль чужого, виправлені", () => {
    const s = m();
    expect(s).toMatch(/_is_student := public\.user_has_role\(_existing, 'student'::app_role\);/);
    expect(s).toMatch(/AND NOT public\.user_has_role\(_tutor_id, 'manager'::app_role\)/);
    expect(s).toMatch(/IF NOT public\.user_has_role\(_student_id, 'student'::app_role\) THEN/);
    expect(s, "про СЕБЕ has_role правдива — її лишаємо").toMatch(/public\.has_role\(_caller, 'tutor'::app_role\)/);
  });

  it("гард ролей більше не спрацьовує на «нічого не роблю»", () => {
    expect(m()).toMatch(/IF NOT EXISTS \(SELECT 1 FROM public\.user_roles WHERE user_id = _sid\) THEN/);
  });

  it("анонімне звернення з лендінгу: грант, ліміт, IP лише хешем", () => {
    const s = m();
    expect(s).toMatch(/GRANT EXECUTE ON FUNCTION public\.submit_landing_feedback\(text, text, text\) TO anon, authenticated;/);
    expect(s).toMatch(/IF _recent >= 5 THEN/);
    expect(s).toMatch(/_ip_hash := CASE WHEN trim\(_ip\) = '' THEN NULL ELSE md5\(trim\(_ip\)\) END;/);
    expect(s, "у таблиці зберігаємо ХЕШ, не адресу").not.toMatch(/INSERT[\s\S]{0,400}\b_ip\b[,)]/);
  });

  it("сценарій бази покриває і привʼязку, і лендінг", () => {
    const sc = read("scripts/db-replay/scenarios/95-add-existing-student.sql");
    for (const n of ["(1)", "(2)", "(3)", "(4)", "(5)", "(6)", "(7)"]) expect(sc).toContain(n);
    expect(sc).toMatch(/action=linked/);
    expect(sc).toMatch(/RATE_LIMITED/);
  });
});
