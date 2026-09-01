/**
 * Аудит 01.09: копіювання скрізь робилося як `navigator.clipboard.writeText(x)`
 * без await і без catch, а одразу після нього показувався тост «скопійовано».
 * У WebView без захищеного контексту (а це нативні збірки) виклик падає —
 * і застосунок упевнено повідомляє про успіх, якого не було.
 *
 * Тут одна функція: копіює, за потреби відкочується на старий execCommand,
 * і ЧЕСНО повертає, чи вийшло. Тост показує викликач — за результатом.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* падаємо у фолбек нижче */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
