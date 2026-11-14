/**
 * Екранна клавіатура не накриває форму (13.11, скарга власниці: «на мобільній версії
 * боттом-шит форми застилаються клавіатурою»).
 *
 * На телефоні клавіатура НЕ зменшує сторінку — вона лягає поверх нижніх ~40% екрана. Форма-аркуш
 * притиснута до низу екрана, тож поле, в яке людина пише, і кнопка «Зберегти» опинялись під
 * клавіатурою: щоб зберегти, треба було спершу сховати клавіатуру. У браузері на компʼютері
 * цього не видно взагалі.
 *
 * Тут одне місце, яке знає, скільки екрана зараз видно, і каже це стилям:
 *   --kb-inset  на скільки пікселів клавіатура заходить на сторінку знизу;
 *   --vvh       видима висота екрана над клавіатурою;
 *   --vvtop     зсув видимої частини (браузер інколи сам підсуває сторінку);
 *   html.kb-open — клавіатура відкрита.
 * Аркуші (`.kb-sheet`, `.kb-bottom`, `.kb-center` у базових Dialog / Sheet / AlertDialog)
 * підіймаються над клавіатурою й стискаються до видимої висоти — правила в index.css.
 * Після цього поле, що у фокусі, прокручується у видиму частину своєї форми.
 *
 * Android (Chrome, застосунок) сам зменшує сторінку (`interactive-widget=resizes-content` в
 * index.html) — там --kb-inset = 0, а kb-open ховає нижню навігацію й «+», які інакше
 * вискакують над клавіатурою.
 */

export type KeyboardState = { open: boolean; inset: number; visible: number; top: number };

/** Чиста частина — для тестів. Усі розміри в пікселях CSS. */
export function computeKeyboard(input: {
  innerHeight: number;      // висота сторінки зараз
  baseline: number;         // найбільша висота сторінки, яку бачили при цій ширині
  vvHeight: number;         // видима висота
  vvTop: number;            // зсув видимої частини
  scale: number;            // масштаб (щипок)
  editable: boolean;        // фокус у полі вводу
}): KeyboardState {
  const { innerHeight, baseline, vvHeight, vvTop, scale, editable } = input;
  // при збільшенні щипком видима висота теж менша — це не клавіатура
  if (!editable || Math.abs(scale - 1) > 0.01) return { open: false, inset: 0, visible: innerHeight, top: 0 };
  const rawInset = Math.max(0, Math.round(innerHeight - vvHeight - vvTop));
  const inset = rawInset > 100 ? rawInset : 0;                 // менше — це рядок адреси, не клавіатура
  const shrunk = baseline - Math.min(innerHeight, vvHeight) > 150; // Android: зменшилась сама сторінка
  const open = inset > 0 || shrunk;
  return open
    ? { open, inset, visible: Math.round(vvHeight), top: Math.max(0, Math.round(vvTop)) }
    : { open: false, inset: 0, visible: innerHeight, top: 0 };
}

/* Поточний стан — для компонентів, яким мало стилів: спливне вікно (Popover) саме рахує, де
   йому стати, і без цього вважає вільним увесь екран, разом із частиною під клавіатурою. */
let current: KeyboardState = { open: false, inset: 0, visible: 0, top: 0 };
const listeners = new Set<() => void>();
export function subscribeKeyboard(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
/** Скільки пікселів знизу сторінки зараз під клавіатурою (0, якщо вона закрита або сторінка зменшилась сама). */
export function getKeyboardCover(): number { return current.open ? current.inset : 0; }

const isEditable = (el: Element | null): el is HTMLElement => {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    return !el.readOnly && !el.disabled && !["checkbox", "radio", "button", "submit", "file", "range", "color", "hidden"].includes(el.type);
  }
  return false;
};

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    const oy = getComputedStyle(a).overflowY;
    if ((oy === "auto" || oy === "scroll") && a.scrollHeight > a.clientHeight + 4) return a;
  }
  return null;
}

/** Поле у фокусі — у видиму частину своєї форми (не під клавіатуру й не під липкий підвал). */
export function revealFocused(state: KeyboardState): void {
  const focused = document.activeElement;
  if (!state.open || !isEditable(focused)) return;
  // Поле пошуку всередині спливного вікна (вибір предмета): саме вікно гортати нікуди — воно
  // висить біля своєї кнопки. Підсуваємо КНОПКУ до верху видимої частини, і вікно, яке стежить
  // за нею, розкривається під нею над клавіатурою.
  let el: HTMLElement = focused;
  let toTop = false;
  const popper = focused.closest("[data-radix-popper-content-wrapper]");
  const popId = popper?.firstElementChild?.id;
  if (popId) {
    const anchor = document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(popId)}"]`);
    if (anchor) { el = anchor; toTop = true; }
  }
  let visTop = state.top + 8;
  let visBottom = state.top + state.visible - 8;
  const sc = scrollParent(el);
  if (sc) {
    const sr = sc.getBoundingClientRect();
    visTop = Math.max(visTop, sr.top + 4);
    visBottom = Math.min(visBottom, sr.bottom - 4);
  }
  const r = el.getBoundingClientRect();
  if (!toTop && r.top >= visTop && r.bottom <= visBottom) return;
  // Куди поставити: поле — по центру ВИДИМОЇ частини (велике поле тексту — верхом до верху);
  // кнопку спливного вікна — до верху. `scrollIntoView({block:"center"})` тут не годиться: він
  // центрує відносно всієї сторінки, а її нижні 40% — під клавіатурою.
  const room = visBottom - visTop;
  const wantTop = toTop ? visTop + 4 : visTop + Math.max(0, (room - r.height) / 2);
  let delta = r.top - wantTop;
  if (Math.abs(delta) < 2) return;
  if (sc) {
    const before = sc.scrollTop;
    sc.scrollTop = before + delta;
    delta -= sc.scrollTop - before;
  }
  // решту (або все, якщо поле на звичайній сторінці) — прокруткою самої сторінки
  if (Math.abs(delta) > 1 && !el.closest('[role="dialog"], [role="alertdialog"]')) window.scrollBy(0, delta);
}

/** Викликається один раз на старті застосунку. */
export function installKeyboardInset(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const vv = window.visualViewport;
  if (!vv) return;                                   // дуже старий браузер — лишається як було
  const root = document.documentElement;
  let baseline = window.innerHeight;
  let width = window.innerWidth;
  let last = "";
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Спливні вікна (Popover) стежать за прокруткою й зміною розміру вікна, але не за тим, що форма
  // під ними підстрибнула над клавіатуру, — і лишались висіти на старому місці. Коли клавіатура
  // зʼявилась чи зникла, кажемо їм перерахувати місце.
  //
  // ⚠️ 14.11, мій дефект: тут вікну надсилалась подія resize після КОЖНОГО
  // фокуса. Випадаючий список (Radix Select) закривається на resize вікна — тож кожен список у
  // застосунку «блимав і зникав» через 60 мс після відкриття (скарга власниці: предмет і валюта
  // у формі «Додати репетитора до учня»). Перерахунок місця — лише подією `scroll` (на неї
  // список не закривається, а позиціонер слухає її так само) і лише при ЗМІНІ стану клавіатури.
  // Подію resize звідси не надсилати ніколи — стереже keyboard-inset.test.ts.
  // Подія йде від ДОКУМЕНТА і спливає до вікна — як справжня прокрутка сторінки. Якщо надіслати
  // її прямо вікну, ціллю стає window, а підказка (Radix Tooltip) питає `target.contains(…)`,
  // якого у вікна немає, — і падає з помилкою JS.
  let nudgeDue = false;
  let lateNudge: ReturnType<typeof setTimeout> | undefined;
  const nudgePopovers = () => {
    if (!document.querySelector("[data-radix-popper-content-wrapper]")) return;
    document.dispatchEvent(new Event("scroll", { bubbles: true }));
  };

  const apply = () => {
    if (window.innerWidth !== width) { width = window.innerWidth; baseline = window.innerHeight; } // поворот екрана
    baseline = Math.max(baseline, window.innerHeight);
    const s = computeKeyboard({
      innerHeight: window.innerHeight, baseline, vvHeight: vv.height, vvTop: vv.offsetTop, scale: vv.scale,
      editable: isEditable(document.activeElement),
    });
    const key = `${s.open}|${s.inset}|${s.visible}|${s.top}`;
    if (key !== last) {
      nudgeDue = true;
      last = key;
      current = s;
      listeners.forEach((cb) => cb());
      root.style.setProperty("--kb-inset", `${s.inset}px`);
      root.style.setProperty("--vvh", `${s.visible}px`);
      root.style.setProperty("--vvtop", `${s.top}px`);
      root.classList.toggle("kb-open", s.open);
    }
    // форма щойно змінила висоту — даємо їй перемалюватись і підсуваємо поле
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (s.open) revealFocused(s);
      if (!nudgeDue) return;
      nudgeDue = false;
      nudgePopovers();
      // і ще раз, коли форма доїхала на нове місце (перехід ~200–300 мс): перший перерахунок міг
      // застати її в русі — у CI спливне вікно пошуку так лишилось на 20px під клавіатурою (14.11)
      clearTimeout(lateNudge);
      lateNudge = setTimeout(nudgePopovers, 340);
    }, 60);
  };

  // Android зменшує САМУ сторінку, коли клавіатура ховається, — це справжній resize вікна, а
  // випадаючий список на нього закривається. Типовий жест «ввела ціну → тап по валюті»: список
  // відкрився, клавіатура за 200–300 мс сховалась, список зник. Тому зміну лише ВИСОТИ вікна
  // одразу після виходу з поля вводу, поки відкритий список, решті слухачів не показуємо
  // (свій перерахунок робимо самі). Поворот екрана (змінилась ширина) проходить як завжди.
  let leftFieldAt = 0;
  window.addEventListener("resize", (e) => {
    if (window.innerWidth !== width) return;
    if (Date.now() - leftFieldAt > 1500) return;
    if (!document.querySelector('[role="listbox"]')) return;
    e.stopImmediatePropagation();
    apply();
    nudgePopovers();
  }, true);

  vv.addEventListener("resize", apply);
  vv.addEventListener("scroll", apply);
  window.addEventListener("resize", apply);
  // клавіатура виїжджає ~250–300 мс після фокуса; перевіряємо одразу і ще раз, коли вона вже стоїть
  document.addEventListener("focusin", () => { apply(); setTimeout(apply, 320); });
  document.addEventListener("focusout", (e) => { if (isEditable(e.target as Element | null)) leftFieldAt = Date.now(); setTimeout(apply, 120); });
  apply();
}
