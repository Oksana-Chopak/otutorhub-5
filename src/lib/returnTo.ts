/**
 * «Куда людина йшла» — памʼять про перервану дію (§4 аудиту шляхів 24.09:
 * «після оплати підписки не повертає до перерваної дії»).
 *
 * Сценарій, який рвався: репетиторка тисне «Записати оплату», замок після
 * тріалу показує шит, вона платить — і опиняється на сторінці підписки. Те, по
 * що вона прийшла, загублено; згадати й повторити мусить сама, вже заплативши.
 *
 * Чому sessionStorage, а не параметр в адресі: оплата через LiqPay ЙДЕ ГЕТЬ із
 * застосунку і повертається за адресою, яку задає сервер, — будь-який наш
 * параметр по дорозі зникає. sessionStorage живе у цій вкладці через
 * перезавантаження, тобто саме стільки, скільки триває оплата, і не переживає
 * закриття браузера (застаріле «повернутись» через тиждень було б дивним).
 *
 * Дозволяємо лише ВНУТРІШНІЙ відносний шлях: абсолютна чи протокол-відносна
 * адреса тут перетворилась би на відкрите перенаправлення.
 */
const KEY = "tutorhub.returnTo";

function isSafeInternalPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//");
}

export function rememberReturnTo(path: string): void {
  if (!isSafeInternalPath(path)) return;
  try { sessionStorage.setItem(KEY, path); } catch { /* приватний режим — просто без повернення */ }
}

/** Прочитати, не витрачаючи (для вирішення, чи показувати кнопку). */
export function peekReturnTo(): string | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return v && isSafeInternalPath(v) ? v : null;
  } catch { return null; }
}

/** Прочитати й ЗАБУТИ: повернення одноразове, інакше кнопка жила б вічно. */
export function takeReturnTo(): string | null {
  const v = peekReturnTo();
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  return v;
}
