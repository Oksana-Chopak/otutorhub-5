import { isNativeApp } from "./platform";

/** Канонічний веб-домен продукту (стор-лістинг, og:, privacy). */
export const WEB_ORIGIN = "https://otutorhub.com";

/**
 * Origin для ПОСИЛАНЬ, що мають жити поза застосунком (email-редіректи,
 * реферальні /join/*). У наативі window.location.origin = https://localhost —
 * такі лінки мертві для всіх. (М5 + реферали з реліз-аудиту.)
 */
export const appOrigin = (): string => (isNativeApp() ? WEB_ORIGIN : window.location.origin);
