import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { CalendarPlus, FileText, Search, Wallet, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRoleFlags } from "@/hooks/useRoleFlags";
import { studentMaterialsPath } from "@/lib/roleCapabilities";
import { isStudentDebtLesson } from "@/lib/financials";
import { formatPrice } from "@/lib/currency";
import { RemindDebtButton } from "@/components/RemindDebtButton";
import { useLastReminders } from "@/hooks/useLastReminders";

type Person = { id: string; name: string };
type Debt = { sum: number; count: number; tutorId: string; currency: string };

/**
 * ПОШУК-НАМІР — важіль 7 аудиту шляхів 24.09.
 *
 * Глобального пошуку в застосунку не було взагалі: щоб знайти людину, треба
 * знати розділ, а на сторінках учня немає навіть фільтра. Для репетитора з 40
 * учнями це єдина навігація, яка не росте разом зі списком.
 *
 * Тому пошук тут не «знаходить сторінку», а ВИКОНУЄ НАМІР: ввела «Оля» —
 * бачить людину, її борг і дії поруч: 🔔 нагадати · 📅 поставити урок ·
 * 💰 записати оплату · 📄 матеріали. Дії — ті самі канонічні компоненти й
 * маршрути, жодних других реалізацій.
 *
 * Скоуп визначає САМА база: RLS на `profiles` віддає репетитору його учнів, а
 * менеджеру — людей його школи. Тобто фільтрувати за роллю в клієнті не треба
 * і не можна — інакше зʼявиться друга правда про те, «хто мої люди».
 */
export function GlobalSearch() {
  const { t } = useTranslation();
  const { user, roles } = useAuth();
  const { flags } = useRoleFlags();
  const navigate = useNavigate();
  const { lastRemindedAt, markReminded } = useLastReminders();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [debts, setDebts] = useState<Record<string, Debt>>({});
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const enabled = !!user && (roles.includes("tutor") || roles.includes("manager"));

  // ⌘K / Ctrl+K — десктопна звичка; на телефоні є кнопка в хедері.
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);

  /* Борги — ОДНИМ запитом на відкриття пошуку, а не по запиту на людину:
     інакше набір тексту породжував би десяток звернень до бази. Предикат —
     спільний isStudentDebtLesson (модель 04.09), без власної арифметики. */
  const loadDebts = useCallback(async () => {
    try {
      const sinceIso = new Date(Date.now() - 365 * 24 * 3600_000).toISOString();
      const { data, error } = await supabase
        .from("lessons_visible")
        .select("id, tutor_id, student_id, status, starts_at, student_price, tutor_payout, student_payment_status, tutor_payout_status, is_cancellation_fee, currency")
        .not("student_id", "is", null)
        .gte("starts_at", sinceIso)
        .limit(500);
      if (error) return;
      const map: Record<string, Debt> = {};
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        if (!isStudentDebtLesson(row as never)) continue;
        const sid = String(row.student_id);
        const cur = map[sid] ?? { sum: 0, count: 0, tutorId: String(row.tutor_id), currency: String(row.currency ?? "UAH") };
        cur.sum += Number(row.student_price ?? 0);
        cur.count += 1;
        map[sid] = cur;
      }
      setDebts(map);
    } catch { /* без боргів пошук усе одно працює */ }
  }, []);

  useEffect(() => { if (open) { void loadDebts(); setTimeout(() => inputRef.current?.focus(), 50); } }, [open, loadDebts]);

  // Пошук людей — із затримкою, щоб не стукати в базу на кожну літеру.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) { setPeople([]); return; }
    let alive = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const like = `%${term.replace(/[%_]/g, "")}%`;
        const { data, error } = await supabase
          .from("profiles")
          .select("id, first_name, last_name")
          .or(`first_name.ilike.${like},last_name.ilike.${like}`)
          .limit(20);
        if (!alive) return;
        if (error) { setPeople([]); return; }
        setPeople(
          ((data ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null }>)
            .map((p) => ({ id: p.id, name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || t("roles.student") }))
            .filter((p) => p.id !== user?.id),
        );
      } finally {
        if (alive) setLoading(false);
      }
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [q, open, user?.id, t]);

  const go = (path: string) => { setOpen(false); setQ(""); navigate(path); };

  const rows = useMemo(
    () => people.slice(0, 12).map((p) => ({ ...p, debt: debts[p.id] ?? null })),
    [people, debts],
  );

  if (!enabled) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("search.open")}
        className="flex h-11 w-11 items-center justify-center rounded-[14px]"
        style={{ background: "var(--ds-surface3,#f6f5f1)", color: "var(--sub,#62677E)", border: "1px solid var(--ds-border,#eceef3)", cursor: "pointer" }}
      >
        <Search className="h-5 w-5" />
      </button>

      <Dialog open={open} onOpenChange={(o) => { if (!o) { setOpen(false); setQ(""); } }}>
        <DialogContent aria-describedby={undefined} className="max-h-[92vh] w-full max-w-md overflow-y-auto p-5 rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto">
          <DialogTitle className="text-[19px] font-extrabold">{t("search.title")}</DialogTitle>
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("search.placeholder")}
              aria-label={t("search.title")}
              className="h-11 flex-1 rounded-xl border border-input px-3 text-[15px]"
              style={{ color: "var(--ds-txt,#0f0f1a)", background: "var(--ds-surface,#fff)" }}
            />
            {q && (
              <button type="button" onClick={() => setQ("")} aria-label={t("common.clear")}
                className="flex h-11 w-11 items-center justify-center rounded-xl"
                style={{ background: "var(--ds-surface3,#f6f5f1)", color: "var(--sub,#62677E)", border: "none", cursor: "pointer" }}>
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {q.trim().length < 2 && (
            <p className="text-[14px]" style={{ color: "var(--sub,#62677E)" }}>{t("search.hint")}</p>
          )}
          {q.trim().length >= 2 && !loading && rows.length === 0 && (
            <p className="text-[15px]" style={{ color: "var(--sub,#62677E)" }}>{t("search.nothing")}</p>
          )}

          <div className="space-y-2">
            {rows.map((p) => {
              const materials = studentMaterialsPath(flags, p.id);
              return (
                <div key={p.id} className="rounded-[14px] p-3" style={{ background: "var(--ds-surface3,#f6f5f1)" }}>
                  <p className="text-[15px] font-bold" style={{ color: "var(--ds-txt,#0f0f1a)" }}>{p.name}</p>
                  {p.debt ? (
                    <p className="mt-0.5 text-[14px] font-semibold" style={{ color: "var(--warning-text,#B45309)" }}>
                      {t("search.debt", { amount: formatPrice(p.debt.sum, p.debt.currency), count: p.debt.count })}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[14px]" style={{ color: "var(--sub,#62677E)" }}>{t("search.noDebt")}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {p.debt && (
                      <RemindDebtButton
                        studentId={p.id}
                        tutorId={flags.isManager ? p.debt.tutorId : undefined}
                        studentName={p.name}
                        lastRemindedAt={lastRemindedAt(p.id, flags.isManager ? p.debt.tutorId : undefined)}
                        onSent={() => markReminded(p.id, flags.isManager ? p.debt!.tutorId : undefined)}
                      />
                    )}
                    <button type="button" onClick={() => go(`/schedule?create=1&student=${p.id}`)}
                      className="flex h-11 items-center gap-1.5 rounded-[12px] px-3 text-[15px] font-bold"
                      style={{ background: "var(--ds-surface,#fff)", color: "var(--ds-txt,#0f0f1a)", border: "1px solid var(--ds-border,#eceef3)", cursor: "pointer" }}>
                      <CalendarPlus className="h-4 w-4" /> {t("search.actionLesson")}
                    </button>
                    <button type="button" onClick={() => go("/finances?record=1")}
                      className="flex h-11 items-center gap-1.5 rounded-[12px] px-3 text-[15px] font-bold"
                      style={{ background: "var(--ds-surface,#fff)", color: "var(--ds-txt,#0f0f1a)", border: "1px solid var(--ds-border,#eceef3)", cursor: "pointer" }}>
                      <Wallet className="h-4 w-4" /> {t("search.actionPayment")}
                    </button>
                    {materials && (
                      <button type="button" onClick={() => go(materials)}
                        className="flex h-11 items-center gap-1.5 rounded-[12px] px-3 text-[15px] font-bold"
                        style={{ background: "var(--ds-surface,#fff)", color: "var(--ds-txt,#0f0f1a)", border: "1px solid var(--ds-border,#eceef3)", cursor: "pointer" }}>
                        <FileText className="h-4 w-4" /> {t("search.actionMaterials")}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
