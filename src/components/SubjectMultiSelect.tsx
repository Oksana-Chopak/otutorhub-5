import { Check, Plus } from "lucide-react";
import { useState, KeyboardEvent } from "react";
import { GENERIC_SUBJECT_OPTIONS } from "@/lib/subjects";
import { useSchoolSubjects } from "@/hooks/useSchoolSubjects";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  className?: string;
}

/**
 * Compact multi-select for tutor subjects. Click chip to toggle.
 * Allows adding custom subjects via inline input.
 */
export function SubjectMultiSelect({ value, onChange, className }: Props) {
  const { t } = useTranslation();
  const [custom, setCustom] = useState("");

  const toggle = (s: string) => {
    if (value.includes(s)) onChange(value.filter((v) => v !== s));
    else onChange([...value, s]);
  };

  const addCustom = () => {
    const trimmed = custom.trim();
    if (!trimmed) return;
    if (!value.includes(trimmed)) {
      onChange([...value, trimmed]);
    }
    setCustom("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addCustom();
    }
  };

  // 11.11: підказки — предмети СВОЄЇ школи; поки їх немає — загальний список
  // (не вшиті предмети школи власниці платформи).
  const school = useSchoolSubjects();
  const options: readonly string[] = school && school.length > 0 ? school : GENERIC_SUBJECT_OPTIONS;
  // Preserve any custom subjects not in the suggestions
  const extras = value.filter((v) => !options.includes(v));

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap gap-2">
        {options.map((s) => {
          const active = value.includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggle(s)}
              className={cn(
                // 11.09: py-1 давало чип 31px — на мобілці це промах за промахом.
                "inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 py-2 text-[15px] font-semibold transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
              )}
            >
              {active && <Check className="h-3 w-3" />}
              {s}
            </button>
          );
        })}
        {extras.map((s) => (
          <Badge
            key={s}
            variant="secondary"
            className="cursor-pointer"
            onClick={() => toggle(s)}
            title={t("subjectSelect.removeItem")}
          >
            {s} ✕
          </Badge>
        ))}
      </div>
      <div className="flex gap-2">
        <Input aria-label={t("subjectSelect.customPlaceholder")}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("subjectSelect.customPlaceholder")}
          // 11.09: 14px у полі вводу змушує iOS зумити форму при фокусі
          // (інваріант «поля ≥15px»); h-10 → h-11 = 44px дотику.
          className="h-11 text-[15px]"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addCustom}
          disabled={!custom.trim()}
          className="tap-44 h-11 shrink-0"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          {t("subjectSelect.addBtn")}
        </Button>
      </div>
    </div>
  );
}
