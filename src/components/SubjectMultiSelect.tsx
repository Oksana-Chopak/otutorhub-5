import { Check, Plus } from "lucide-react";
import { useState, KeyboardEvent } from "react";
import { SUBJECT_OPTIONS } from "@/lib/subjects";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

  // Preserve any custom subjects not in canonical list
  const extras = value.filter((v) => !SUBJECT_OPTIONS.includes(v as any));

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap gap-2">
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
      <div className="flex gap-2">
        <Input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Свій предмет..."
          className="h-8 text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addCustom}
          disabled={!custom.trim()}
          className="h-8 shrink-0"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Додати
        </Button>
      </div>
    </div>
  );
}
