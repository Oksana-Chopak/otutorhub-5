// Застаріла збірка у відкритій вкладці (19.10, помилка з проду:
// «Failed to fetch dynamically imported module: …/assets/Index-By8Xifsb.js»).
//
// Що сталося: людина тримала вкладку відкритою, вийшов новий Publish, і файли
// старої збірки зникли з сервера (хеш у назві змінився). Перший же перехід на
// сторінку, яку браузер ще не вантажив, падав у ErrorBoundary — а лікування
// одне: перезавантажити сторінку, тоді прийде нова збірка.
//
// Vite сигналить про це подією `vite:preloadError` ДО того, як помилка стане
// необробленою. Ми перезавантажуємо сторінку раз на збірку (маркер у
// sessionStorage, запасний — у window.name, який теж переживає reload), щоб не
// зациклитись, якщо падає з іншої причини: другий збій з тим самим штампом іде
// у звичайний журнал помилок як справжня помилка.
import { BUILD_STAMP } from "@/lib/buildInfo";

const KEY = "otutorhub.staleBuildReload";

/** Вигляд помилки «модуль збірки не знайшовся» у Chrome / Safari / Firefox. */
export function isStaleChunkError(message: string): boolean {
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i
    .test(message);
}

function marker(): string {
  const want = `${KEY}=${BUILD_STAMP}`;
  try {
    if (sessionStorage.getItem(KEY) === BUILD_STAMP) return want;
  } catch { /* сховище недоступне — дивимось window.name */ }
  try {
    if (typeof window.name === "string" && window.name.includes(want)) return want;
  } catch { /* ні */ }
  return "";
}

function remember(): void {
  const want = `${KEY}=${BUILD_STAMP}`;
  try { sessionStorage.setItem(KEY, BUILD_STAMP); } catch { /* запасний варіант нижче */ }
  try {
    if (typeof window.name === "string" && !window.name.includes(want)) window.name = `${window.name}|${want}`;
  } catch { /* ні */ }
}

/** Чи вже перезавантажували цю вкладку заради цієї збірки. */
export function alreadyReloadedForThisBuild(): boolean {
  return marker() !== "";
}

export function installStaleBuildReload(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    if (alreadyReloadedForThisBuild()) return; // хай падає як справжня помилка — у журнал
    remember();
    event.preventDefault(); // не плодити «необроблену» помилку — ми її лікуємо
    window.location.reload();
  });
}
