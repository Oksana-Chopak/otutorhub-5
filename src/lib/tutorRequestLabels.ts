// Human-readable labels for tutor-referral-request enum values that come from the
// "find a tutor" quiz (preferred_level / preferred_times / preferred_days / for-whom).
// Without this, the manager's request cards show raw values like "advanced" or
// "weekend_evening". uk-primary (these requests originate from the Ukrainian quiz);
// unknown values fall back to a humanized form.

const LEVEL: Record<string, string> = {
  beginner: "Початковий рівень",
  intermediate: "Середній рівень",
  advanced: "Просунутий рівень",
};

const TIMES: Record<string, string> = {
  weekday_morning: "Будні, ранок",
  weekday_day: "Будні, день",
  weekday_evening: "Будні, вечір",
  weekend_morning: "Вихідні, ранок",
  weekend_day: "Вихідні, день",
  weekend_evening: "Вихідні, вечір",
  flexible: "Гнучкий графік",
};

const FORWHOM: Record<string, string> = {
  self: "Для себе",
  child: "Для дитини",
  other: "Для іншої людини",
};

const ALL: Record<string, string> = { ...LEVEL, ...TIMES, ...FORWHOM };

function humanize(v: string): string {
  return v.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Map one or more comma/space-separated enum values to a readable string. */
export function prettyRequestValue(v?: string | null): string {
  if (!v) return "";
  return v
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((part) => ALL[part] ?? humanize(part))
    .join(", ");
}
