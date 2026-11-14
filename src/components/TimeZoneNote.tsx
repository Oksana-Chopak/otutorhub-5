import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { deviceTimeZone, toInstant, zoneLabel } from "@/lib/timeZone";

/**
 * Позначка часового поясу під полем часу: «За твоїм часом: Стокгольм (GMT+1)».
 *
 * ОДИН компонент на всі місця, де час встановлюють (канон, як DateTimeField): форма уроку,
 * перенесення, копія уроку, заняття групи, запит на інший час, доступні години, імпорт розкладу,
 * час оплати. `others` додає друге речення там, де час стосується ще когось («кожен учасник
 * побачить урок за своїм місцевим часом») — саме це було незрозуміло менеджерці в Стокгольмі,
 * яка ставить урок репетиторці в Києві й учневі в Берліні.
 *
 * `at` — дата, на яку ставлять час: зсув залежить від неї (літній / зимовий час).
 * `tone="onDark"` — для темної картки часу у формі уроку.
 */
export function TimeZoneNote({
  at, others = false, tone = "muted", className = "",
}: {
  at?: Date | string | null;
  others?: boolean;
  tone?: "muted" | "onDark";
  className?: string;
}) {
  const { t } = useTranslation();
  const zone = zoneLabel(deviceTimeZone(), toInstant(at));
  return (
    <p
      data-tz-note=""
      className={`flex items-start gap-1.5 text-[13px] leading-snug ${tone === "onDark" ? "" : "text-muted-foreground"} ${className}`}
      style={tone === "onDark" ? { color: "rgba(255,255,255,.78)" } : undefined}
    >
      <Globe aria-hidden className="mt-[2px] h-3.5 w-3.5 shrink-0" />
      <span>
        {t("timeZone.yours", { zone })}
        {others ? ` · ${t("timeZone.othersSee")}` : ""}
      </span>
    </p>
  );
}
