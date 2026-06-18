/**
 * Тонка обгортка над RevenueCat (StoreKit / Play Billing) для нативних збірок.
 * У вебі плагін не вантажиться — усі методи безпечні no-op, тож код спільний.
 *
 * Налаштування (App Store Connect + RevenueCat) описане в docs/v1.1-IAP-PLAN.md.
 * Public SDK-ключ прокидається через VITE_REVENUECAT_IOS_KEY на збірці.
 */
import { isNativeApp } from "@/lib/platform";
import { Capacitor } from "@capacitor/core";

// Platform-specific RevenueCat public SDK key (App Store IAP on iOS, Play Billing on
// Android). Set VITE_REVENUECAT_IOS_KEY / VITE_REVENUECAT_ANDROID_KEY at build time.
const RC_KEY = (Capacitor.getPlatform() === "android"
  ? (import.meta.env.VITE_REVENUECAT_ANDROID_KEY as string | undefined)
  : (import.meta.env.VITE_REVENUECAT_IOS_KEY as string | undefined)) ?? "";
const ENTITLEMENT = "pro";

export type IapPlan = "monthly" | "yearly";

export interface IapOffer {
  monthlyPrice?: string; // локалізована ціна, напр. "330,00 ₴"
  yearlyPrice?: string;
}

let configured = false;

// Динамічний імпорт, щоб у веб-бандл плагін не потрапляв.
async function rc() {
  if (!isNativeApp()) return null;
  try {
    const mod = await import("@revenuecat/purchases-capacitor");
    return mod.Purchases;
  } catch {
    return null;
  }
}

/** Викликати один раз після логіну: appUserID = Supabase user.id (для вебхука). */
export async function configureIap(appUserId: string): Promise<void> {
  if (configured || !RC_KEY) return;
  const P = await rc();
  if (!P) return;
  try {
    await P.configure({ apiKey: RC_KEY, appUserID: appUserId });
    configured = true;
  } catch {
    /* ignore */
  }
}

/** Локалізовані ціни поточного offering (для показу на кнопці). */
export async function getIapOffer(): Promise<IapOffer> {
  const P = await rc();
  if (!P) return {};
  try {
    const offerings = await P.getOfferings();
    const cur = offerings.current;
    return {
      monthlyPrice: cur?.monthly?.product?.priceString,
      yearlyPrice: cur?.annual?.product?.priceString,
    };
  } catch {
    return {};
  }
}

/** Покупка. true — entitlement "pro" став активним. */
export async function purchaseIap(plan: IapPlan): Promise<boolean> {
  const P = await rc();
  if (!P) return false;
  const offerings = await P.getOfferings();
  const pkg = plan === "yearly" ? offerings.current?.annual : offerings.current?.monthly;
  if (!pkg) return false;
  const { customerInfo } = await P.purchasePackage({ aPackage: pkg });
  return !!customerInfo.entitlements.active[ENTITLEMENT];
}

/** Відновлення покупок — обовʼязкова кнопка за правилами Apple. */
export async function restoreIap(): Promise<boolean> {
  const P = await rc();
  if (!P) return false;
  const info = await P.restorePurchases();
  return !!info.customerInfo.entitlements.active[ENTITLEMENT];
}
