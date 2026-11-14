import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { deviceTimeZone, sameClock, timeInZone, toInstant, zoneLabel } from "@/lib/timeZone";

/**
 * Позначка часового поясу під полем часу: «За твоїм часом: Стокгольм (GMT+1)».
 *
 * ОДИН компонент на всі місця, де час встановлюють (канон, як DateTimeField): форма уроку,
 * перенесення, копія уроку, заняття групи, запит на інший час, доступні години, імпорт розкладу,
 * час оплати.
 *
 * `others` — час стосується ще когось. Якщо пояси цих людей відомі (`people`), позначка каже
 * КОНКРЕТНО: «Ірина Коваль: 16:00 · Київ (GMT+2)» — для кожного, в кого на годиннику інший час.
 * Якщо в усіх той самий час, що й у тебе, другого рядка немає взагалі. Якщо чийсь пояс невідомий
 * (людина ще не заходила в застосунок) — лишається загальне «кожен учасник побачить урок за своїм
 * місцевим часом»: відсутнє рендериться як відсутнє, ми не вгадуємо.
 *
 * `at` — дата, на яку ставлять час: зсув залежить від неї (літній / зимовий час).
 * `tone="onDark"` — для темної картки часу у формі уроку.
 * `onlyIfDiffers` — показати позначку лише коли в когось справді інший час (деталі уроку).
 */
export interface ZonePerson { name: string; tz?: string | null }

export function TimeZoneNote({
  at, others = false, people, onlyIfDiffers = false, tone = "muted", className = "",
}: {
  at?: Date | string | null;
  others?: boolean;
  people?: ZonePerson[];
  onlyIfDiffers?: boolean;
  tone?: "muted" | "onDark";
  className?: string;
}) {
  const { t } = useTranslation();
  const mine = deviceTimeZone();
  const when = toInstant(at);
  const zone = zoneLabel(mine, when);

  const list = (people ?? []).filter((p) => p.name);
  const unknown = list.some((p) => !p.tz);
  // люди, в яких на годиннику інший час, — згруповані за поясом
  const byZone = new Map<string, string[]>();
  for (const p of list) {
    if (!p.tz || sameClock(p.tz, mine, when)) continue;
    byZone.set(p.tz, [...(byZone.get(p.tz) ?? []), p.name]);
  }
  const lines = Array.from(byZone.entries()).map(([tz, names]) => {
    const who = names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
    return { tz, text: `${who}: ${timeInZone(when, tz, mine)} · ${zoneLabel(tz, when)}` };
  });

  if (onlyIfDiffers && lines.length === 0) return null;
  // загальне речення — лише коли є кому його адресувати і ми не знаємо поясів усіх
  const generic = others && (list.length === 0 || unknown);

  return (
    <div
      data-tz-note=""
      className={`text-[13px] leading-snug ${tone === "onDark" ? "" : "text-muted-foreground"} ${className}`}
      style={tone === "onDark" ? { color: "rgba(255,255,255,.78)" } : undefined}
    >
      <p className="flex items-start gap-1.5">
        <Globe aria-hidden className="mt-[2px] h-3.5 w-3.5 shrink-0" />
        <span>
          {t("timeZone.yours", { zone })}
          {generic ? ` · ${t("timeZone.othersSee")}` : ""}
        </span>
      </p>
      {lines.map((l) => (
        <p key={l.tz} data-tz-person="" className={`mt-0.5 pl-5 font-semibold ${tone === "onDark" ? "" : "text-foreground"}`}
          style={tone === "onDark" ? { color: "#fff" } : undefined}>
          {l.text}
        </p>
      ))}
    </div>
  );
}
