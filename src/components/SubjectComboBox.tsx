import { useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { SUBJECT_OPTIONS } from "@/lib/subjects";
import { useTranslation } from "react-i18next";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Extra subject names (e.g. legacy values from data) shown in the list. */
  extraOptions?: string[];
}

/**
 * Combobox for subjects: searchable list of canonical subjects with the
 * ability to add a custom free-text value. Drop-in replacement for the
 * single-value SubjectSelect.
 */
export function SubjectComboBox({
  value,
  onChange,
  placeholder,
  className,
  disabled,
  extraOptions = [],
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const allOptions = Array.from(
    new Set([...(SUBJECT_OPTIONS as readonly string[]), ...extraOptions.filter(Boolean)])
  );
  const filtered = query
    ? allOptions.filter((s) => s.toLowerCase().includes(query.toLowerCase()))
    : allOptions;
  const showAddCustom =
    query.trim().length > 1 &&
    !allOptions.some((s) => s.toLowerCase() === query.trim().toLowerCase());

  const handleSelect = (subject: string) => {
    onChange(subject);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-11 w-full justify-between text-base font-normal",
            !value && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate">
            {value || placeholder || t("subjectComboBox.selectPlaceholder")}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput
            placeholder={t("subjectComboBox.searchPlaceholder")}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {filtered.length === 0 && !showAddCustom && (
              <CommandEmpty>{t("subjectComboBox.noResults")}</CommandEmpty>
            )}
            {filtered.length > 0 && (
              <CommandGroup heading={t("subjectComboBox.popular")}>
                {filtered.slice(0, 20).map((s) => (
                  <CommandItem key={s} value={s} onSelect={() => handleSelect(s)}>
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === s ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {s}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {showAddCustom && (
              <CommandGroup>
                <CommandItem
                  value={`add-${query}`}
                  onSelect={() => handleSelect(query.trim())}
                  className="text-primary"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t("subjectComboBox.addCustom", { subject: query.trim() })}
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
