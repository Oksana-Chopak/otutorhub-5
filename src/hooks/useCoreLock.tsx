import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";

/**
 * ЗАМОК ПІСЛЯ ТРІАЛУ (рішення власниці 05.09).
 *
 * Джерело правди стану — coreLocked з useWorkspaceSettings (один предикат на
 * весь застосунок; тут ЛИШЕ UI-механіка). Цей хук дає точкам запису дві речі:
 *   - locked      — чи замкнене ядро для поточної людини;
 *   - openPaywall — показати шит підписки замість дії.
 *
 * Патерн використання в обробнику дії (2 рядки, на самому початку):
 *   if (lock.locked) { lock.openPaywall(); return; }
 *
 * Замикаються ЛИШЕ нові уроки та позначення оплат/гаманець (ядро цінності).
 * Читання, історія, учні, чати, конспекти — відкриті: дані людини не беруться
 * в заручники, і кабінети її учнів продовжують працювати.
 * roleReady/workspaceUnknown уже враховані в предикаті (persona-readiness).
 */
const PaywallCtx = createContext<{ open: () => void } | null>(null);

export function PaywallProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const openPaywall = useCallback(() => setOpen(true), []);
  const value = useMemo(() => ({ open: openPaywall }), [openPaywall]);
  return (
    <PaywallCtx.Provider value={value}>
      {children}
      <PaywallSheet open={open} onOpenChange={setOpen} />
    </PaywallCtx.Provider>
  );
}

export function useCoreLock() {
  const { coreLocked } = useWorkspaceSettings();
  const ctx = useContext(PaywallCtx);
  return {
    locked: coreLocked,
    // Без провайдера (тест/сторінка поза AppLayout) — тихий no-op, дія просто зупиняється.
    openPaywall: ctx?.open ?? (() => {}),
  };
}

/** Теплий шит: що лишається, що чекає, одна кнопка. Bottom-sheet за каноном. */
function PaywallSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="w-full max-w-md p-0 gap-0 rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto [&>button.absolute]:hidden"
      >
        <DialogTitle className="sr-only">{t("paywallSheet.title")}</DialogTitle>
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden">
          <div className="h-1 w-9 rounded-full bg-border" />
        </div>
        <div style={{ padding: "16px 22px 22px" }}>
          <div style={{ fontSize: 40, lineHeight: 1 }}>🌱</div>
          <p className="mt-2 text-[20px] font-extrabold text-foreground" style={{ fontFamily: "Inter, system-ui, sans-serif", letterSpacing: "-.01em" }}>
            {t("paywallSheet.title")}
          </p>
          <p className="mt-1 text-[15px] text-muted-foreground">{t("paywallSheet.subtitle")}</p>

          <div className="mt-4 space-y-2">
            {(["keep1", "keep2"] as const).map((k) => (
              <div key={k} className="flex items-start gap-2.5 text-[14px] text-foreground">
                <span aria-hidden className="mt-[1px]" style={{ color: "var(--teal,#2BBFAA)" }}>✓</span>
                <span>{t(`paywallSheet.${k}`)}</span>
              </div>
            ))}
            {(["lock1", "lock2"] as const).map((k) => (
              <div key={k} className="flex items-start gap-2.5 text-[14px] text-muted-foreground">
                <span aria-hidden className="mt-[1px]">🔒</span>
                <span>{t(`paywallSheet.${k}`)}</span>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => { onOpenChange(false); navigate("/subscription"); }}
            className="mt-5 h-[50px] w-full rounded-[14px] text-[16px] font-semibold text-white"
            style={{ background: "linear-gradient(135deg,#2BBFAA,#25a896)", border: "none", cursor: "pointer", boxShadow: "0 8px 20px -8px rgba(43,191,170,.7)" }}
          >
            {t("paywallSheet.cta")}
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="tap-44 mt-2 h-11 w-full rounded-[12px] text-[14px] font-semibold text-muted-foreground"
            style={{ background: "transparent", border: "none", cursor: "pointer" }}
          >
            {t("paywallSheet.later")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
