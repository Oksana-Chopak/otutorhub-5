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
  const el = document.activeElement;
  if (!state.open || !isEditable(el)) return;
  let visTop = state.top + 8;
  let visBottom = state.top + state.visible - 8;
  const sc = scrollParent(el);
  if (sc) {
    const sr = sc.getBoundingClientRect();
    visTop = Math.max(visTop, sr.top + 4);
    visBottom = Math.min(visBottom, sr.bottom - 4);
  }
  const r = el.getBoundingClientRect();
  if (r.top >= visTop && r.bottom <= visBottom) return;
  // Куди поставити поле: по центру ВИДИМОЇ частини; якщо воно вище за неї (велике поле тексту) —
  // верхом до верху. `scrollIntoView({block:"center"})` тут не годиться: він центрує відносно
  // всієї сторінки, а її нижні 40% — під клавіатурою.
  const room = visBottom - visTop;
  const wantTop = visTop + Math.max(0, (room - r.height) / 2);
  let delta = r.top - wantTop;
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

  const apply = () => {
    if (window.innerWidth !== width) { width = window.innerWidth; baseline = window.innerHeight; } // поворот екрана
    baseline = Math.max(baseline, window.innerHeight);
    const s = computeKeyboard({
      innerHeight: window.innerHeight, baseline, vvHeight: vv.height, vvTop: vv.offsetTop, scale: vv.scale,
      editable: isEditable(document.activeElement),
    });
    const key = `${s.open}|${s.inset}|${s.visible}|${s.top}`;
    if (key !== last) {
      last = key;
      root.style.setProperty("--kb-inset", `${s.inset}px`);
      root.style.setProperty("--vvh", `${s.visible}px`);
      root.style.setProperty("--vvtop", `${s.top}px`);
      root.classList.toggle("kb-open", s.open);
    }
    // форма щойно змінила висоту — даємо їй перемалюватись і підсуваємо поле
    if (s.open) { clearTimeout(timer); timer = setTimeout(() => revealFocused(s), 60); }
  };

  vv.addEventListener("resize", apply);
  vv.addEventListener("scroll", apply);
  window.addEventListener("resize", apply);
  // клавіатура виїжджає ~250–300 мс після фокуса; перевіряємо одразу і ще раз, коли вона вже стоїть
  document.addEventListener("focusin", () => { apply(); setTimeout(apply, 320); });
  document.addEventListener("focusout", () => setTimeout(apply, 120));
  apply();
}
