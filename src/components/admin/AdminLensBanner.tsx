import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminLens } from "@/hooks/useAdminLens";
import { purgeLocalCaches } from "@/lib/localCaches";

/**
 * Смужка «на що я зараз дивлюсь» для суперадміна (11.11).
 *
 * Лінза перемикається в адмінці «Школи», а діє на КОЖЕН екран: «Люди», «Фінанси»,
 * розклад. Без постійного нагадування власниця платформи відкрила б «Фінанси»,
 * побачила чужі цифри й вирішила, що це її школа, — рівно та плутанина, заради
 * усунення якої лінзу зроблено. Тому, поки погляд не «своя школа», смужка стоїть
 * над кожною сторінкою і має одну дію — повернутись.
 *
 * Для всіх інших ролей (і для суперадміна у власній школі) не рендериться нічого.
 */
export function AdminLensBanner() {
  const { t } = useTranslation();
  const lens = useAdminLens();
  const [busy, setBusy] = useState(false);

  if (!lens.available || lens.mode === "own") return null;

  const back = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await lens.setLens("own");
      if (!ok) return;
      // читання йде крізь RLS — після зміни погляду все треба перечитати з нуля
      purgeLocalCaches();
      window.location.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="status"
      className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-[var(--warning-bg,#fff7e6)] px-4 py-2 text-[14px] font-semibold text-foreground dark:bg-[#3a2f12]"
    >
      <span className="min-w-0">
        👁{" "}
        {lens.mode === "all"
          ? t("adminLens.viewingAll")
          : t("adminLens.viewingHub", { name: lens.viewHubName ?? "—" })}
      </span>
      <button
        type="button"
        onClick={() => void back()}
        disabled={busy}
        className="h-11 shrink-0 rounded-[12px] border border-border bg-card px-3 text-[14px] font-semibold text-foreground disabled:opacity-60"
      >
        {t("adminLens.backToOwn")}
      </button>
    </div>
  );
}
