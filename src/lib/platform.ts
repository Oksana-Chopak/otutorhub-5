/**
 * Платформенні хелпери для нативних збірок (Capacitor).
 * Працюють і у вебі (там Capacitor відсутній — усе повертає false),
 * тож код безпечно ділити між web / Android / iOS.
 */

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

function cap(): CapacitorGlobal | undefined {
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** Застосунок запущено всередині нативної обгортки (iOS або Android). */
export function isNativeApp(): boolean {
  try {
    return cap()?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/** Саме iOS-збірка — для правил App Store (IAP 3.1.1: без зовнішніх покупок). */
export function isIosApp(): boolean {
  try {
    return isNativeApp() && cap()?.getPlatform?.() === "ios";
  } catch {
    return false;
  }
}
