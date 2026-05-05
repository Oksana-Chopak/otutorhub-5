import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSubjects } from "@/hooks/useSubjects";

interface Props {
  value: string;
  onValueChange: (name: string, id?: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Extra subject names that aren't in the canonical list — kept selectable for legacy data. */
  extraOptions?: string[];
}

/**
 * Dropdown of canonical subjects from the `subjects` table. Stores the
 * subject name as value (for backward compatibility with text columns) and
 * also exposes the id via the second arg of onValueChange.
 */
export function SubjectSelect({
  value,
  onValueChange,
  placeholder = "Оберіть предмет",
  disabled,
  extraOptions = [],
}: Props) {
  const { subjects, loading } = useSubjects();

  const known = new Set(subjects.map((s) => s.name));
  const extras = extraOptions.filter((s) => s && !known.has(s));
  // Include current value if it's not in canonical list (legacy data)
  if (value && !known.has(value) && !extras.includes(value)) extras.push(value);

  return (
    <Select
      value={value || undefined}
      onValueChange={(name) => {
        const found = subjects.find((s) => s.name === name);
        onValueChange(name, found?.id);
      }}
      disabled={disabled || loading}
    >
      <SelectTrigger>
        <SelectValue placeholder={loading ? "Завантаження…" : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {subjects.map((s) => (
          <SelectItem key={s.id} value={s.name}>
            {s.emoji ? `${s.emoji} ` : ""}
            {s.name}
          </SelectItem>
        ))}
        {extras.map((name) => (
          <SelectItem key={`extra-${name}`} value={name}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
