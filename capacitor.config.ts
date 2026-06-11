import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Нативна обгортка oTutorHub (App Store / Play Market).
 * Веб-білд (`npm run build` → dist/) пакується в застосунок;
 * Supabase лишається віддаленим API, тож логіка спільна з вебом.
 */
const config: CapacitorConfig = {
  appId: "ua.otutorhub.app",
  appName: "oTutorHub",
  webDir: "dist",
  backgroundColor: "#F5F4F0",
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: "automatic",
  },
};

export default config;
