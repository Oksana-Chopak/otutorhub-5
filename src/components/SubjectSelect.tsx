import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronDown, Plus, Search } from "lucide-react";
import { useSubjectCanon } from "@/hooks/useSubjectCanon";

/**
 * Єдиний селектор предмета: випадаючий список із реєстру subject_canon
 * (+ додаткові підказки поверхні), пошук, і «Додати новий» ЛИШЕ коли
 * точного збігу немає. Написання все одно канонізує БД-тригер.
 */
export function SubjectSelect({
  value, onChange, suggestions = [], placeholder,
}: { value: string; onChange: (v: string) => void; suggestions?: string[]; placeholder?: string }) {
  const { t } = useTranslation();
  const canon = useSubjectCanon();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of [...suggestions, ...canon]) {
      const k = s.trim().toLowerCase();
      if (k && !seen.has(k)) seen.set(k, s.trim());
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, "uk"));
  }, [canon, suggestions]);

  const filtered = useMemo(
    () => (q.trim() ? list.filter((s) => s.toLowerCase().includes(q.trim().toLowerCase())) : list),
    [list, q]
  );
  const exact = q.trim() && list.some((s) => s.toLowerCase() === q.trim().toLowerCase());

  const pick = (v: string) => { onChange(v); setQ(""); setOpen(false); };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <PopoverTrigger asChild>
        <button type="button"
          className="flex w-full items-center justify-between rounded-[15px] border-[1.5px] px-3.5 text-left"
          style={{ height: 58, background: "var(--ds-surface2,#fbfbfc)", borderColor: "var(--ds-border,#eceef3)", fontWeight: 700, fontSize: 17 }}>
          <span style={{ color: value ? "var(--txt,#0f0f1a)" : "var(--sub,#9398b0)" }} className="truncate">
            {value || placeholder || t("subjectSelect.placeholder")}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0" style={{ color: "var(--sub,#666b82)" }} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-1.5" style={{ minWidth: 260 }}>
        <div className="mb-1 flex items-center gap-2 rounded-[10px] border px-2.5"
          style={{ borderColor: "var(--border,var(--ds-border,#eceef3))", background: "var(--ds-surface,#fff)", height: 40 }}>
          <Search className="h-4 w-4 shrink-0" style={{ color: "var(--sub,#666b82)" }} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t("subjectSelect.search")}
            className="w-full bg-transparent text-[15px] outline-none"
            style={{ color: "var(--txt,#0f0f1a)" }} />
        </div>
        <div className="max-h-56 overflow-y-auto">
          {filtered.map((s) => (
            <button key={s} type="button" onClick={() => pick(s)}
              className="block w-full rounded-[8px] px-3 py-2.5 text-left text-[15px] font-semibold hover:bg-[#F5F4F0]"
              style={{ color: "var(--txt,#0f0f1a)" }}>
              {s}
            </button>
          ))}
          {filtered.length === 0 && !q.trim() && (
            <div className="px-3 py-2.5 text-[14px]" style={{ color: "var(--sub,#666b82)" }}>
              {t("subjectSelect.empty")}
            </div>
          )}
        </div>
        {q.trim() && !exact && (
          <button type="button" onClick={() => pick(q.trim())}
            className="mt-1 flex w-full items-center gap-2 rounded-[10px] border px-3 py-2.5 text-left text-[15px] font-bold"
            style={{ borderColor: "#F5B544", background: "#FFF7E6", color: "#9a6a12" }}>
            <Plus className="h-4 w-4" />
            {t("subjectSelect.addNew", { name: q.trim() })}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
