// Хости застосунку, яким дозволено бути адресою повернення / джерелом публічних
// викликів (red team 20.10). Раніше google-calendar-auth/-callback приймали
// БУДЬ-ЯКИЙ `*.lovable.app` — тобто й чужий проєкт на Lovable міг стати
// `return_to` нашого OAuth-потоку. Список закритий і один на всі функції.
export const APP_HOSTS: ReadonlySet<string> = new Set([
  "otutorhub.com",
  "www.otutorhub.com",
  "otutorhub.lovable.app",
  "id-preview--0aa51a41-1c1e-499c-b511-ba5e0d425456.lovable.app",
]);

export const APP_ORIGINS: ReadonlySet<string> = new Set(
  Array.from(APP_HOSTS, (h) => `https://${h}`),
);

export function isAppHost(hostname: string | null | undefined): boolean {
  return !!hostname && APP_HOSTS.has(hostname.toLowerCase());
}

/** `https://<дозволений хост>/…` або null. */
export function safeAppUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !isAppHost(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}
