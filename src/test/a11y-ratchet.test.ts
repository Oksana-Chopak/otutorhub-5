import { describe, expect, it } from "vitest";
import { studentMaterialsPath } from "@/lib/roleCapabilities";
import { lessonStateOf } from "@/components/StudentMaterials";
import { readFileSync } from "node:fs";
import { globSync } from "glob";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * C-хвиля, гейти доступності (ratchet — числа можуть ЛИШЕ падати):
 *
 *  1. «Гейт імені»: поле вводу без aria-label / aria-labelledby / id — для
 *     скрінрідера це просто «поле вводу». Було 85, стало 0.
 *  2. «Гейт цілі дотику»: інтерактивний елемент із явною висотою < 44px і без
 *     класу .tap-44 (той розширює ЗОНУ натискання, не змінюючи вигляд).
 *     Було 42, стало 0.
 *  3. «Гейт клавіатури»: div/span/tr/li з onClick без tabIndex/onKeyDown —
 *     мишею працює, клавіатурою ні. Було 16, стало 0.
 *
 * Свідомі виключення: примітиви в src/components/ui (імʼя дає той, хто їх
 * використовує), приховані `className="hidden"` інпути (їх тисне видима
 * кнопка), бекдропи `inset-0` (їх закриває Escape) і обгортки, що лише
 * глушать спливання події.
 */

const NAMED_BASELINE = 0;
const TOUCH_BASELINE = 0;
const KEYBOARD_BASELINE = 0;

const files = globSync("src/**/*.tsx", { ignore: ["src/test/**", "src/components/ui/**"] });

/** Межі відкривального JSX-тега з урахуванням лапок, шаблонів і вкладених { }. */
function openingTags(src: string, tags: string[]): Array<{ tag: string; start: number; attrs: string }> {
  const out: Array<{ tag: string; start: number; attrs: string }> = [];
  const re = new RegExp(`<(${tags.join("|")})\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = re.lastIndex;
    let depth = 0;
    let quote: string | null = null;
    let tick = false;
    while (i < src.length) {
      const c = src[i];
      if (quote) {
        if (c === "\\") { i += 2; continue; }
        if (c === quote) quote = null;
      } else if (tick) {
        if (c === "\\") { i += 2; continue; }
        if (c === "`") tick = false;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === "`") tick = true;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
      i++;
    }
    out.push({ tag: m[1], start: m.index, attrs: src.slice(re.lastIndex, i) });
  }
  return out;
}

const TW_H: Record<string, number> = { "h-3": 12, "h-3.5": 14, "h-4": 16, "h-5": 20, "h-6": 24, "h-7": 28, "h-8": 32, "h-9": 36, "h-10": 40, "h-11": 44, "h-12": 48, "h-14": 56 };

function explicitHeight(attrsRaw: string): number | null {
  const cut = attrsRaw.indexOf("=>");
  const attrs = cut > 0 ? attrsRaw.slice(0, cut) : attrsRaw;
  const inline = /\bheight\s*:\s*(\d+)/.exec(attrs);
  if (inline) return Number(inline[1]);
  const px = /(?<![\w-])h-\[(\d+)px\]/.exec(attrs);
  if (px) return Number(px[1]);
  for (const [k, v] of Object.entries(TW_H)) {
    if (new RegExp(`(?<![\\w-])${k.replace(".", "\\.")}(?![\\w.[-])`).test(attrs)) return v;
  }
  return null;
}

function scan() {
  const unnamed: string[] = [];
  const small: string[] = [];
  const noKeyboard: string[] = [];
  for (const f of files) {
    const s = readFileSync(f, "utf-8");
    const lineOf = (i: number) => s.slice(0, i).split("\n").length;

    for (const { start, attrs } of openingTags(s, ["input", "textarea", "select", "Input", "Textarea", "SelectTrigger"])) {
      if (/aria-label\b|aria-labelledby\b|\bid=/.test(attrs)) continue;
      if (/className="hidden"/.test(attrs)) continue;
      const head = s.slice(Math.max(0, start - 400), start);
      if (/<label\b[^>]*>(?:(?!<\/label>)[\s\S])*$/.test(head)) continue; // інпут усередині <label>
      unnamed.push(`${f}:${lineOf(start)}`);
    }

    for (const { start, attrs } of openingTags(s, ["button", "a", "Button"])) {
      if (attrs.includes("tap-44")) continue;
      const h = explicitHeight(attrs);
      if (h !== null && h < 44) small.push(`${f}:${lineOf(start)} (${h}px)`);
    }

    for (const { start, attrs } of openingTags(s, ["div", "span", "tr", "li", "td"])) {
      if (!attrs.includes("onClick")) continue;
      if (attrs.includes("tabIndex") || attrs.includes("onKeyDown")) continue;
      if (attrs.includes("stopPropagation") && !/onClick=\{\(\) =>/.test(attrs)) continue;
      if (/inset-0|inset: 0|onClickCapture/.test(attrs)) continue;
      noKeyboard.push(`${f}:${lineOf(start)}`);
    }
  }
  return { unnamed, small, noKeyboard };
}

describe("a11y ratchet (імена полів · цілі дотику · клавіатура)", () => {
  const r = scan();

  it(`полів без програмного імені — не більше ${NAMED_BASELINE}`, () => {
    if (r.unnamed.length > NAMED_BASELINE) console.error("Без імені:\n" + r.unnamed.join("\n"));
    expect(r.unnamed.length).toBeLessThanOrEqual(NAMED_BASELINE);
  });

  it(`цілей дотику < 44px без .tap-44 — не більше ${TOUCH_BASELINE}`, () => {
    if (r.small.length > TOUCH_BASELINE) console.error("Дрібні цілі:\n" + r.small.join("\n"));
    expect(r.small.length).toBeLessThanOrEqual(TOUCH_BASELINE);
  });

  it(`клікабельних без клавіатури — не більше ${KEYBOARD_BASELINE}`, () => {
    if (r.noKeyboard.length > KEYBOARD_BASELINE) console.error("Без клавіатури:\n" + r.noKeyboard.join("\n"));
    expect(r.noKeyboard.length).toBeLessThanOrEqual(KEYBOARD_BASELINE);
  });
});

/**
 * Мобільний аудит 10.09 — три дефекти, які видно лише на телефоні.
 * Кожен коштував користувачці дії, яку вона не могла зробити.
 */
describe("мобілка · знайдене аудитом 10.09", () => {
  const read = (p: string) => readFileSync(join(root, p), "utf8");

  it("FAB стоїть над банером кук — інакше головна дія екрана не натискається", () => {
    // Банер кук фіксований знизу і на першому візиті накривав FAB цілком:
    // «Додати учня» / «Додати репетитора» просто не реагували на дотик.
    expect(read("src/components/PageFAB.tsx")).toMatch(/var\(--cookie-banner-h, 0px\)/);
  });

  it("банер кук стоїть над нижньою навігацією, а не поверх неї", () => {
    expect(read("src/components/CookieConsent.tsx")).toMatch(/var\(--app-bottom-nav-h, 0px\)/);
    expect(read("src/components/MobileBottomNav.tsx")).toMatch(/--app-bottom-nav-h/);
  });

  it("плейсхолдери мають власний колір — дефолт Tailwind дає 2,45:1", () => {
    const css = read("src/index.css");
    expect(css).toMatch(/input::placeholder[\s\S]{0,120}color: hsl\(var\(--muted-foreground\)\)/);
  });

  it("рядок оплат учня переноситься, а не тримає все в одну лінію", () => {
    // Права група не стискалась, з'їдала ліву колонку (дата налазила на суму)
    // і виносила кнопку «Оплатити» за екран.
    const src = read("src/pages/student/StudentPaymentsPage.tsx");
    expect(src).toMatch(/flexWrap: "wrap"/);
    expect(src).not.toMatch(/className="flex items-center gap-2\.5 flex-shrink-0">/);
  });
});

/**
 * Форма уроку · рішення власниці 11.09.
 * Домашка на 20 рядків не має ховатись у віконце на 4, а посилання на
 * зустріч — жити в одному акордеоні з конспектом.
 */
describe("форма уроку · поля ростуть, зустріч окремо", () => {
  const read = (p: string) => readFileSync(join(root, p), "utf8");
  const lw = read("src/components/LessonWorkspace.tsx");

  it("домашка, конспект і нотатки ростуть під вміст", () => {
    expect(lw).toMatch(/useAutoGrowTextarea/);
    expect(lw).toMatch(/ref=\{homeworkGrow\}/);
    expect(lw).toMatch(/ref=\{summaryGrow\}/);
    expect(lw).toMatch(/ref=\{notesGrow\}/);
  });

  it("стеля росту висока — низька повертає той самий скрол усередині поля", () => {
    // 20 рядків домашки на телефоні — це ~950px. Стеля 500–600 знову ховала б текст.
    const hook = read("src/hooks/useAutoGrowTextarea.ts");
    const m = hook.match(/maxHeight = (\d+)/);
    expect(m).toBeTruthy();
    expect(Number(m![1])).toBeGreaterThanOrEqual(1500);
  });

  it("акордеон замінено відкритими картками — без зайвих кліків", () => {
    expect(lw).not.toMatch(/<Row\b/);
    expect(lw).toMatch(/<Section emoji="🎥"/);
    expect(lw).toMatch(/<Section emoji="✨"/);
    expect(lw).toMatch(/<Section emoji="📚"/);
  });

  it("зустріч — окрема картка ПЕРЕД конспектом і домашкою", () => {
    const meet = lw.indexOf('<Section emoji="🎥"');
    const sum = lw.indexOf('<Section emoji="✨"');
    const hw = lw.indexOf('<Section emoji="📚"');
    expect(meet).toBeGreaterThan(-1);
    expect(meet).toBeLessThan(sum);
    expect(sum).toBeLessThan(hw);
  });
});

/**
 * Матеріали учня · рішення власниці 11.09.
 * «Історія» була згорнутим списком дат із першим рядком конспекту й без
 * посилань — щоб щось прочитати, репетиторка стрибала від уроку до уроку.
 */
describe("матеріали учня · хронологія, розгорнуто, з посиланнями", () => {
  const read = (p: string) => readFileSync(join(root, p), "utf8");
  const ms = read("src/pages/MyStudentsPage.tsx");
  const sm = read("src/components/StudentMaterials.tsx");

  it("замість згорнутої історії — розгорнуті матеріали", () => {
    expect(ms).toMatch(/<StudentMaterials/);
    expect(ms).not.toMatch(/loadHistory/);
    expect(ms).not.toMatch(/historyData/);
  });

  it("матеріали несуть конспект, домашку, нотатку і файли", () => {
    for (const k of ["summary", "homework", "privateNote", "files"]) {
      expect(sm).toMatch(new RegExp(`${k}:`));
    }
    expect(sm).toMatch(/lesson_attachments/);
    expect(sm).toMatch(/lesson_tutor_notes/);
  });

  it("з матеріалів можна відкрити сам урок", () => {
    expect(sm).toMatch(/onOpenLesson/);
    expect(ms).toMatch(/setLessonDetailsId/);
  });

  it("імʼя учня всюди веде в його матеріали через ?open=", () => {
    expect(ms).toMatch(/searchParams\.get\("open"\)/);
    expect(read("src/components/LessonDetailsDialog.tsx")).toMatch(/my-students\?open=/);
  });

  /**
   * 11.09: «на картці уроку клік по імені перекидував на матеріали».
   * Пастка, яку тут замкнено: у ХАБОВОГО репетитора сторінки учня немає —
   * /my-students відкидає його на дашборд. Тому адресу рахує СТОРІНКА
   * (вона знає тип репетитора), а не картка, і для хабового це null.
   */
  it("адресу рахує сторінка, а не картка — картка ролі не вгадує", () => {
    const lc = read("src/components/LessonCard.tsx");
    expect(lc).toMatch(/studentHref\?: string \| null/);
    // коментарі маршрути згадують навмисно — дивимось на КОД
    const code = lc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/my-students\?open=/);
    expect(code).not.toMatch(/people\?open=/);
  });

  it("кожна картка уроку отримує studentHref — жодного пропущеного виклику", () => {
    for (const f of ["src/pages/DashboardPage.tsx", "src/pages/SchedulePage.tsx"]) {
      const src = read(f);
      const cards = (src.match(/<LessonCard\b/g) ?? []).length;
      const hrefs = (src.match(/studentHref=\{studentMaterialsPath\(flags,/g) ?? []).length;
      expect(cards, f).toBeGreaterThan(0);
      expect(hrefs, f).toBe(cards);
    }
  });

  it("хабовий репетитор і учень посилання не отримують", () => {
    expect(studentMaterialsPath({ isManager: true, isTutor: false, isIndependent: false, isStudent: false }, "s1"))
      .toBe("/people?open=s1");
    expect(studentMaterialsPath({ isManager: false, isTutor: true, isIndependent: true, isStudent: false }, "s1"))
      .toBe("/my-students?open=s1");
    // хабовий: /my-students його відкидає на дашборд — посилання вело б у нікуди
    expect(studentMaterialsPath({ isManager: false, isTutor: true, isIndependent: false, isStudent: false }, "s1"))
      .toBeNull();
    expect(studentMaterialsPath({ isManager: false, isTutor: false, isIndependent: false, isStudent: true }, "s1"))
      .toBeNull();
    // груповий урок — учня немає
    expect(studentMaterialsPath({ isManager: false, isTutor: true, isIndependent: true, isStudent: false }, null))
      .toBeNull();
  });

  /**
   * Аудит 11.09, робот по кожній формі кожної ролі: дрібні елементи керування
   * у формах. Пороги нижче — не смак, а те, що робот реально зловив:
   * 31px чипи предметів, 30px поле назви групи, 32px перемикач у ГРОШОВІЙ
   * формі, 24px вимикач дня. Плюс поле з 14px змушує iOS зумити всю форму.
   */
  describe("форми: дотик і розмір шрифту після аудиту 11.09", () => {
    const rd = (f: string) => readFileSync(join(root, f), "utf8");

    it("чипи предметів ≥ 40px і поле власного предмета ≥ 15px", () => {
      const sm = rd("src/components/SubjectMultiSelect.tsx");
      expect(sm, "чип предмета").toMatch(/min-h-\[40px\]/);
      expect(sm, "поле з 14px змусить iOS зумити форму").not.toMatch(/className="h-\d+ text-\[14px\]"/);
    });

    it("перемикач режиму в формі оплати ≥ 44px", () => {
      expect(rd("src/components/RecordPaymentSheet.tsx")).toMatch(/TabsTrigger value="lesson" className="min-h-\[44px\]"/);
    });

    it("поле майстра груп забирає всю висоту рамки, а не свій рядок", () => {
      expect(rd("src/pages/GroupsPage.tsx")).toMatch(/alignSelf: "stretch"/);
    });

    it("вимикач дня в доступності має 44px зони дотику", () => {
      expect(rd("src/components/AvailabilityManager.tsx")).toMatch(/width: 43, height: 44/);
    });
  });

  /**
   * Бекап не має залежати від того, чи Lovable переніс рядок про бакет:
   * 11.09 він його мовчки зрізав, і о 23:45 все впало б у 500 без свідків.
   */
  it("нічний бекап створює свій бакет сам і лишає його приватним", () => {
    const fn = readFileSync(join(root, "supabase/functions/db-backup/index.ts"), "utf8");
    expect(fn).toMatch(/createBucket\(BUCKET, \{ public: false \}\)/);
    expect(fn).toMatch(/exist/i);
  });

  it("менеджер має куди прийти: /people?open= відкриває аркуш людини", () => {
    expect(read("src/pages/PeoplePage.tsx")).toMatch(/searchParams\.get\("open"\)/);
  });

  /**
   * Питання власниці 12.09: «наступний урок сьогодні о 12:30, а домашку
   * показує ніби з учорашнього — це я наплутала?». Ні: картка показувала
   * ЛИШЕ дату, без часу і без ознаки «вже було / ще буде». Домашку нормально
   * писати наперед, але тоді список зобовʼязаний це сказати.
   */
  describe("матеріали: коли саме був урок і чи він уже був", () => {
    const sm = () => readFileSync(join(root, "src/components/StudentMaterials.tsx"), "utf8");

    it("у шапці картки є і дата, і ЧАС", () => {
      expect(sm()).toMatch(/\{fmtDate\(it\.startsAt\)\}, \{fmtTime\(it\.startsAt\)\}/);
    });

    it("час і дата — ОКРЕМІ форматери (комбінований скелет дає інший відмінок у Chromium)", () => {
      const src = sm();
      expect(src).toMatch(/toLocaleDateString\(getLocale\(\), \{ day: "numeric", month: "short" \}\)/);
      expect(src).toMatch(/toLocaleTimeString\(getLocale\(\), \{ hour: "2-digit", minute: "2-digit" \}\)/);
    });

    it("майбутній урок НЕ виглядає як запис про минуле", () => {
      const future = new Date(Date.now() + 3 * 3600_000).toISOString();
      const past = new Date(Date.now() - 3 * 3600_000).toISOString();
      expect(lessonStateOf("scheduled", future)).toBe("upcoming");
      // минулий і досі «заплановано» — саме той, що чекає відмітки
      expect(lessonStateOf("scheduled", past)).toBe("unmarked");
      expect(lessonStateOf("completed", past)).toBe("done");
      expect(lessonStateOf("cancelled", past)).toBe("cancelled");
      // статус у базі важливіший за час: проведений майбутній лишається проведеним
      expect(lessonStateOf("completed", future)).toBe("done");
    });

    it("дві вкладки: «Матеріали» фільтрує по вмісту, «Історія» — ні", () => {
      const src = sm();
      expect(src).toMatch(/tabMaterials/);
      expect(src).toMatch(/tabHistory/);
      expect(src, "історія мусить показувати УСІ уроки")
        .toMatch(/tab === "materials" \? hasStuff\(i\) : true/);
    });

    it("картка згортається в один рядок і розгортається назад", () => {
      const src = sm();
      expect(src).toMatch(/aria-expanded=\{on\}/);
      expect(src).toMatch(/setOpenCards\(\(p\) => \(\{ \.\.\.p, \[it\.lessonId\]: !on \}\)\)/);
      expect(src).toMatch(/collapseAll/);
    });

    it("домашка теж складається — раніше вона не згорталась узагалі", () => {
      const src = sm();
      const hw = src.slice(src.indexOf("studentMaterials.homework"));
      expect(hw.slice(0, 300), "домашка мусить рендеритись через LongText").toMatch(/<LongText/);
    });
  });

  /**
   * Скарга власниці 12.09: «у груповому уроці не виводить список усіх моїх
   * учнів, можу обрати лише одного, додавати теж не можу».
   * Причина: перемикач «Груповий» рендерився ЛИШЕ коли група вже існує, а
   * зібрати її можна було тільки на іншій сторінці. Репетиторка без жодної
   * групи бачила в формі уроку список учнів із вибором рівно одного — і
   * жодного натяку, що груповий урок узагалі можливий.
   */
  describe("груповий урок збирається у самій формі", () => {
    const qld = () => readFileSync(join(root, "src/components/QuickLessonDialog.tsx"), "utf8");

    it("перемикач НЕ залежить від того, чи групи вже є", () => {
      const src = qld();
      expect(src, "умова groups.length > 0 на перемикачі — і є той самий баг")
        .not.toMatch(/\{groups\.length > 0 && \(\s*\n\s*<div style=\{\{ display: "flex", gap: 4/);
      expect(src).toMatch(/\{!isHubVariant && \(/);
    });

    it("кількох учнів можна відмітити прямо тут", () => {
      const src = qld();
      expect(src).toMatch(/newGroupPicks/);
      expect(src, "вибір мусить бути множинним, а не заміною одного на іншого")
        .toMatch(/on \? p2\.filter\(x => x !== s2\.student_id\) : \[\.\.\.p2, s2\.student_id\]/);
    });

    it("групу пишемо ОДНИМ каноном, а не другою копією логіки", () => {
      expect(qld()).toMatch(/createGroupWithStudents/);
      expect(readFileSync(join(root, "src/pages/GroupsPage.tsx"), "utf8"))
        .toMatch(/createGroupWithStudents/);
      const lib = readFileSync(join(root, "src/lib/groups.ts"), "utf8");
      expect(lib).toMatch(/from\("lesson_groups"\)/);
      expect(lib).toMatch(/from\("group_enrollments"\)/);
    });

    it("групова ціна НЕ підставляється з індивідуальної ставки", () => {
      const lib = readFileSync(join(root, "src/lib/groups.ts"), "utf8");
      expect(lib, "групова ціна зазвичай інша — підстановка тихо виставила б чужу суму")
        .toMatch(/price_per_lesson: null/);
      // будь-що, крім null, — це вже підстановка з іншого поля
      expect(lib).not.toMatch(/price_per_lesson:\s*(?!null\b)[A-Za-z_$]/);
    });

    it("без груп перемикач одразу відкриває збирання, а не порожню панель", () => {
      expect(qld()).toMatch(/if \(mode === "group" && groups\.length === 0\) setNewGroupOpen\(true\)/);
    });

    /* 12.09, знайдено роботом на 390×844 під час зйомки інструкції: кнопка
       «Створити групу» стояла в кінці вмісту панелі, тобто на y≈851 — НИЖЧЕ
       згину екрана, а знизу світився «Створити урок», який у цю мить нічого
       зробити не може (групи ще немає). Потрібна дія була схована, зайва —
       на видноті. Тепер поки збирання відкрите, футер несе саме збирання. */
    it("поки збирається група, потрібна кнопка — у футері, а не під згином", () => {
      const src = qld();
      expect(src, "дія збирання мусить жити у футері діалогу")
        .toMatch(/\{newGroupOpen && \(\s*\n\s*<button disabled=\{creatingGroup \|\| !groupBuildReady\} onClick=\{createGroupNow\}/);
      expect(src, "«Створити урок» не показуємо, поки групи ще немає")
        .toMatch(/\{!newGroupOpen && \(\s*\n\s*<button disabled=\{submitting \|\| !canSubmit\}/);
      expect(src, "другого рядка дій усередині панелі більше бути не може")
        .not.toMatch(/<button onClick=\{\(\) => setNewGroupOpen\(false\)\} disabled=\{creatingGroup\}/);
    });

    it("напис на кнопці збирання не зникає, коли вона неактивна", () => {
      const src = qld();
      expect(src, "білий напис по світлому тлу — саме те, що ховало кнопку")
        .not.toMatch(/newGroupPicks\.length >= 2 && newGroupName\.trim\(\) \? "#0f0f1a" : "#fff"/);
      expect(src, "темний напис тримається в обох станах")
        .toMatch(/background: groupBuildReady \? "linear-gradient\(135deg,#2BBFAA,#25a896\)" : "rgba\(43,191,170,\.28\)",\s*\n\s*color: "#0f0f1a"/);
    });
  });

  /* 12.09, спіймано при зйомці інструкції: у профілі світився напис
     «undefined undefined», бо рівень підписувався з полів обʼєкта, який міг
     прийти іншої форми. Інваріант «відсутнє рендериться як відсутнє». */
  it("рівень у профілі не підписується полями, яких може не бути", () => {
    const pp = read("src/pages/ProfilePage.tsx");
    expect(pp, "гола перевірка на істинність обʼєкта давала «undefined undefined»")
      .not.toMatch(/\{gamLevel \? `\$\{gamLevel\.emoji\} \$\{gamLevel\.name\}`/);
    expect(pp).toMatch(/gamLevel\?\.name \? `\$\{gamLevel\.emoji \?\? "🏅"\} \$\{gamLevel\.name\}`/);
  });

  it("учень бачить конспект одразу, а не за кнопкою", () => {
    const sh = read("src/pages/student/StudentHomeworkPage.tsx");
    expect(sh).toMatch(/r\.hasAiNote && \(\(\) => \{/);
    expect(sh).not.toMatch(/onClick=\{\(\) => setOpenNoteId\(openNoteId === r\.lesson_id \? null : r\.lesson_id\)\} aria-expanded/);
  });
});
