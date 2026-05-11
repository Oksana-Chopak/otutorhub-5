import { cn } from "@/lib/utils";
import { Building2, User } from "lucide-react";

export type LessonSource = "hub" | "independent";

interface Props {
  source: LessonSource;
  className?: string;
  showIcon?: boolean;
}

export function SourceBadge({ source, className, showIcon = true }: Props) {
  if (source === "hub") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-md bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning",
          className
        )}
        title="Учень із хабу oTutorHub"
      >
        {showIcon && <Building2 className="h-3 w-3" />}
        Хаб
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground",
        className
      )}
      title="Ваш власний учень"
    >
      {showIcon && <User className="h-3 w-3" />}
      Мій
    </span>
  );
}

/** CSS classes to tint a lesson row/card based on source. */
export function lessonSourceTint(source: LessonSource | null | undefined) {
  return source === "hub"
    ? "bg-warning/5"
    : "";
}
