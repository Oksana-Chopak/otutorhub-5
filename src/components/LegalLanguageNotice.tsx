import { useTranslation } from "react-i18next";

/**
 * 47: Оферта і Політика — чинні юридичні документи українською
 * (ТОВ «КІДІУМ», ст. 641 ЦКУ). Машинний переклад зобов'язального договору
 * створює реальний ризик: розбіжність у формулюванні клаузули — це спір.
 * Тому текст лишається мовою оригіналу, а користувачеві інших мов чесно
 * пояснюємо, чому він бачить українську і який текст має силу.
 */
export function LegalLanguageNotice() {
  const { t, i18n } = useTranslation();
  if ((i18n.language || "uk").slice(0, 2) === "uk") return null;
  return (
    <div className="mb-6 rounded-[14px] border border-amber-300 bg-amber-50 px-4 py-3">
      <p className="text-[14px] font-semibold text-amber-900">{t("legalNotice.title")}</p>
      <p className="mt-1 text-[14px] text-amber-900/85">{t("legalNotice.body")}</p>
    </div>
  );
}
