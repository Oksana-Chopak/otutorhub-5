import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { parseStudentList, type ParsedStudent } from "@/lib/importStudents";
import { formatPrice } from "@/lib/currency";
import { logEvent } from "@/lib/analytics";
import { Loader2 } from "lucide-react";

/**
 * «Встав список — додамо всіх» (05.09, премортем п.2). Репетиторка тримає
 * учнів у зошиті/нотатках телефона; переносити по одному — це ті самі
 * пів години, на яких помирав тріал. Тут: вставила текст → превʼю з розбором
 * → одна кнопка. Запис іде через ТОЙ САМИЙ канонічний RPC
 * add_or_link_independent_student, що й одиночна форма (жодного паралельного
 * шляху створення — UI CANON). Додавання учнів НЕ під замком підписки:
 * саме воно веде людину до грошового «ага».
 */
export function ImportStudentsSheet({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onImported?: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const rows = useMemo(() => parseStudentList(text), [text]);
  const valid = rows.filter((r) => !r.error);
  const broken = rows.filter((r) => r.error);

  const runImport = async () => {
    if (!user || valid.length === 0 || busy) return;
    setBusy(true);
    setProgress({ done: 0, total: valid.length });
    let added = 0;
    let linked = 0;
    let failed = 0;
    // Послідовно, не Promise.all: RPC створює профілі, і паралельний шквал
    // лише збільшує шанс гонок/лімітів; 20 учнів = кілька секунд.
    for (let i = 0; i < valid.length; i++) {
      const r = valid[i];
      try {
        const { data, error } = await supabase.rpc("add_or_link_independent_student", {
          _first_name: r.firstName,
          _last_name: r.lastName,
          _email: "",
          _phone: "",
          _telegram: "",
          _subject: r.subject ?? t("importStudents.defaultSubject"),
          _price: r.price ?? 0,
          _currency: "UAH",
        } as never);
        if (error || !data) failed++;
        else if ((data as { action?: string }).action === "linked") linked++;
        else added++;
      } catch {
        failed++;
      }
      setProgress({ done: i + 1, total: valid.length });
    }
    setBusy(false);
    setProgress(null);
    logEvent("students_imported", { added, linked, failed, total: valid.length });
    if (added + linked > 0) {
      toast.success(t("importStudents.doneTitle", { count: added + linked }), {
        description: failed > 0 ? t("importStudents.doneFailed", { count: failed }) : undefined,
      });
      setText("");
      onOpenChange(false);
      onImported?.();
    } else {
      toast.error(t("importStudents.allFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent
        aria-describedby={undefined}
        className="w-full max-w-md p-0 gap-0 rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[92vh] flex flex-col [&>button.absolute]:hidden"
      >
        <DialogTitle className="sr-only">{t("importStudents.title")}</DialogTitle>
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden flex-shrink-0">
          <div className="h-1 w-9 rounded-full bg-border" />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: "12px 20px 20px" }}>
          <p className="text-[20px] font-extrabold text-foreground" style={{ fontFamily: "Inter, system-ui, sans-serif", letterSpacing: "-.01em" }}>
            📋 {t("importStudents.title")}
          </p>
          <p className="mt-1 text-[14px] text-muted-foreground">{t("importStudents.subtitle")}</p>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label={t("importStudents.title")}
            placeholder={t("importStudents.placeholder")}
            rows={6}
            disabled={busy}
            className="mt-3 w-full rounded-xl border-[0.5px] border-input bg-background p-3 text-[15px] text-foreground focus:outline-none"
            style={{ resize: "vertical", minHeight: 120 }}
          />

          {rows.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <p className="text-[13px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sub,#666b82)" }}>
                {t("importStudents.previewLabel", { count: valid.length })}
              </p>
              {valid.slice(0, 30).map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-[14px] text-foreground">
                  <span aria-hidden style={{ color: "var(--teal,#2BBFAA)" }}>✓</span>
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{r.firstName} {r.lastName}</span>
                    {r.subject && <span className="text-muted-foreground"> · {r.subject}</span>}
                    {r.price !== null && <span className="text-muted-foreground"> · {formatPrice(r.price, "UAH")}</span>}
                    {r.price === null && <span className="text-muted-foreground"> · {t("importStudents.noPrice")}</span>}
                  </span>
                </div>
              ))}
              {broken.map((r, i) => (
                <div key={`b${i}`} className="flex items-center gap-2 text-[14px] text-muted-foreground">
                  <span aria-hidden>⚠️</span>
                  <span className="min-w-0 truncate">{r.raw} — {t("importStudents.lineSkipped")}</span>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={runImport}
            disabled={busy || valid.length === 0}
            className="mt-4 flex h-[50px] w-full items-center justify-center gap-2 rounded-[14px] text-[16px] font-semibold text-white"
            style={{
              background: "linear-gradient(135deg,#2BBFAA,#25a896)",
              opacity: busy || valid.length === 0 ? 0.5 : 1,
              border: "none",
              cursor: busy || valid.length === 0 ? "default" : "pointer",
            }}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy && progress
              ? t("importStudents.progress", { done: progress.done, total: progress.total })
              : t("importStudents.addBtn", { count: valid.length })}
          </button>
          <p className="mt-2 text-[13px] text-muted-foreground">{t("importStudents.priceHint")}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
