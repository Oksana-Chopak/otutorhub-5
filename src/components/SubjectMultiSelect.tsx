import { Check } from "lucide-react";
import { SUBJECT_OPTIONS } from "@/lib/subjects";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  className?: string;
}

/**
 * Compact multi-select for tutor subjects. Click chip to toggle.
 * Allows custom subjects to remain (preserves unknown values selected previously).
 */
export function SubjectMultiSelect({ value, onChange, className }: Props) {
  const toggle = (s: string) => {
    if (value.includes(s)) onChange(value.filter((v) => v !== s));
    else onChange([...value, s]);
  };

  // Preserve any custom subjects not in canonical list
  const extras = value.filter((v) => !SUBJECT_OPTIONS.includes(v as any));

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {SUBJECT_OPTIONS.map((s) => {
        const active = value.includes(s);
        return (
          <button
            key={s}
            type="button"
            onClick={() => toggle(s)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
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
          title="Натисніть щоб видалити"
        >
          {s} ✕
        </Badge>
      ))}
    </div>
  );
}
