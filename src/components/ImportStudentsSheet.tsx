import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCoreLock } from "@/hooks/useCoreLock";
import {
  IMPORT_CURRENCY,
  IMPORT_SCHEDULE_WEEKS,
  parseStudentList,
  netDebtAndPrepay,
  scheduleToStarts,
  applyOverride,
  unsureNote,
  resolveUnsure,
  unrecognizedShape,
  type ParsedStudent,
  type ImportWarning,
  type RowOverride,
  type UnsureChoice,
  type ScheduleSlot,
} from "@/lib/importStudents";
import { currencySymbol, formatPrice } from "@/lib/currency";
import { logEvent } from "@/lib/analytics";
import { Loader2 } from "lucide-react";

/** Грошове поле, яке людина може поправити дотиком. */
type EditableField = "price" | "debtAmount" | "debtLessons" | "prepayAmount" | "prepayLessons";
const FIELD_LABEL_KEY: Record<EditableField, string> = {
  price: "fieldPrice", debtAmount: "fieldDebt", debtLessons: "fieldDebtLessons", prepayAmount: "fieldPrepay", prepayLessons: "fieldPrepayLessons",
};

/**
 * Чип превʼю з правкою дотиком (13.09, екран підтвердження). Дотик → поле
 * вводу прямо в чипі; Enter/дотик поза — зберегти; Esc — скасувати; порожнє —
 * прибрати значення. 44px зони дотику і 15px шрифт у полі (iOS не зумить).
 */
function EditChip({
  label, value, unit, editing, onEdit, onCommit, onCancel, tone, editLabel, doneLabel,
}: {
  label: string;
  value: number | null;
  unit: string;
  editing: boolean;
  onEdit: () => void;
  onCommit: (v: number | null) => void;
  onCancel: () => void;
  tone?: "warn";
  editLabel: string;
  doneLabel: string;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  useEffect(() => { if (editing) setDraft(value === null ? "" : String(value)); }, [editing, value]);
  const commit = () => {
    const n = Number(draft.replace(/\s/g, "").replace(",", "."));
    onCommit(draft.trim() === "" || !Number.isFinite(n) || n <= 0 ? null : n);
  };
  if (editing) {
    return (
      <span className="inline-flex h-11 items-center gap-1 rounded-full border-[0.5px] border-primary bg-background pl-3 pr-1">
        <input
          autoFocus
          inputMode="decimal"
          aria-label={editLabel}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") onCancel(); }}
          onBlur={commit}
          className="w-[72px] bg-transparent text-[15px] text-foreground focus:outline-none"
        />
        <span className="text-[14px] text-muted-foreground">{unit}</span>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={commit}
          className="ml-1 h-9 rounded-full px-3 text-[14px] font-semibold text-primary">
          {doneLabel}
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={editLabel}
      className={
        "inline-flex h-11 items-center gap-1 rounded-full border-[0.5px] border-dashed px-3 text-[14px] " +
        (tone === "warn"
          ? "border-amber-500 text-amber-700 dark:text-amber-400"
          : value === null ? "border-border text-muted-foreground" : "border-border bg-secondary text-foreground")
      }
    >
      {label}<span aria-hidden className="text-muted-foreground">✎</span>
    </button>
  );
}

/** Скільки тижнів розкладу створюємо наперед (рішення власниці 07.09: 4). */
// Горизонт живе в @/lib/importStudents — тут лише реекспорт для старих імпортів.
export { IMPORT_SCHEDULE_WEEKS } from "@/lib/importStudents";

/**
 * «Перенести все, що є» (05.09 — учні; 07.09 — борги, передоплати, розклад,
 * контакти). Репетиторка тримає учнів у зошиті/нотатках/таблиці; переносити
 * по одному — ті самі пів години, на яких помирав тріал. Тут: вставила текст
 * (або таблицю з Excel) → превʼю з розбором → одна кнопка. Запис іде через
 * ОДИН серверний RPC на учня (import_student_bundle), який усередині кличе
 * канонічні add_or_link_independent_student / update_lesson_details_safe /
 * wallet_topup — жодного паралельного шляху створення (UI CANON).
 *
 * Замок (рішення 07.09): самі імена — завжди безкоштовно (це веде до
 * грошового «ага»); борги/передоплати/розклад після простроченого тріалу —
 * PaywallSheet, як і будь-який інший грошовий запис. Сервер перевіряє те саме.
 */
/** Підсумок імпорту — онбордингу треба знати, ЩО саме приїхало, щоб нарахувати XP чесно. */
export interface ImportResult {
  students: number;
  debtTotal: number;
  scheduled: number;
  failed: number;
}

export function ImportStudentsSheet({
  open,
  onOpenChange,
  onImported,
  initialText,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onImported?: (result: ImportResult) => void;
  /** Список, який людина набрала ще на лендінгу, до реєстрації. */
  initialText?: string;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const lock = useCoreLock();
  const [text, setText] = useState(initialText ?? "");

  // Чернетка з лендінгу приїжджає асинхронно (сторінка встигає змонтуватись
  // раніше). Підставляємо її, лише поки людина сама нічого не набрала —
  // інакше затерли б її ввід.
  useEffect(() => {
    if (initialText && !text) setText(initialText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialText]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const parsed = useMemo(() => parseStudentList(text), [text]);
  // 13.09, екран підтвердження: правки дотиком живуть окремо від тексту, з ключем
  // по оригінальному рядку — зміниш рядок у полі, і правка до нього відпаде сама.
  const [overrides, setOverrides] = useState<Record<string, RowOverride>>({});
  const [editing, setEditing] = useState<{ raw: string; field: EditableField } | null>(null);
  const resolvedLog = useRef<Array<{ shape: string; chosen: UnsureChoice }>>([]);
  const rows = useMemo(() => parsed.map((r) => applyOverride(r, overrides[r.raw])), [parsed, overrides]);
  // 14.09: «математика на середу о 18:00» — урок без учня. У застосунку такий
  // рядок не створює учня «математика»: людина каже, чий це урок, і слот
  // доклеюється до того учня; без відповіді урок чесно пропускається.
  const dayName = (wd: number) => t(`importStudents.day${wd}`);
  const orphans = rows.filter((r) => !r.error && r.scheduleOnly);
  const valid = rows.filter((r) => !r.error && !r.scheduleOnly);
  const broken = rows.filter((r) => r.error);
  const assignedSlots = useMemo(() => {
    const m = new Map<string, ScheduleSlot[]>();
    for (const o of orphans) {
      const to = overrides[o.raw]?.assignTo;
      if (!to) continue;
      m.set(to, [...(m.get(to) ?? []), ...o.schedule]);
    }
    return m;
  }, [orphans, overrides]);
  const scheduleOf = (r: ParsedStudent): ScheduleSlot[] => [...r.schedule, ...(assignedSlots.get(r.raw) ?? [])];
  const assignedTo = (r: ParsedStudent) => orphans.filter((o) => overrides[o.raw]?.assignTo === r.raw);
  // Предмет уроку без учня («математика на середу») не губиться: учень без
  // предмета бере його собі, а якщо предмет у нього вже інший — урок іде під
  // предметом учня (RPC веде одну ставку), і слово лишається в нотатці.
  const subjectOf = (r: ParsedStudent): string | null => {
    if (r.subject) return r.subject;
    const subs = Array.from(new Set(assignedTo(r).map((o) => o.subject).filter((s): s is string => !!s)));
    return subs.length === 1 ? subs[0] : null;
  };
  const subjectNotesOf = (r: ParsedStudent): string[] => {
    const own = subjectOf(r);
    return assignedTo(r)
      .filter((o) => o.subject && o.subject !== own)
      .map((o) => `${o.subject} — ${o.schedule.map((s) => `${dayName(s.weekday)} ${s.time}`).join(", ")}`);
  };
  const orphansSkipped = orphans.filter((o) => !overrides[o.raw]?.assignTo).length;
  const unsureOf = (r: ParsedStudent) => unsureNote(parsed.find((p) => p.raw === r.raw) ?? r, overrides[r.raw]);
  const unsureCount = valid.filter((r) => unsureOf(r)).length + broken.length;
  const setField = (raw: string, field: EditableField, v: number | null) =>
    setOverrides((o) => ({ ...o, [raw]: { ...(o[raw] ?? {}), [field]: v } }));
  const answerUnsure = (r: ParsedStudent, choice: UnsureChoice) => {
    const base = parsed.find((p) => p.raw === r.raw) ?? r;
    const u = unsureNote(base, overrides[r.raw]);
    if (u) resolvedLog.current.push({ shape: unrecognizedShape(u.fragment), chosen: choice });
    setOverrides((o) => ({ ...o, [r.raw]: resolveUnsure(base, o[r.raw], choice) }));
  };
  const sym = currencySymbol(IMPORT_CURRENCY);

  const hasMoneyOrSchedule = (r: ParsedStudent) =>
    r.debtAmount !== null || r.debtLessons !== null || r.prepayLessons !== null || r.prepayAmount !== null || scheduleOf(r).length > 0;
  const needsPro = valid.some(hasMoneyOrSchedule);

  // Підсумок для кнопки: борги (нетто), уроків на 4 тижні.
  const summary = useMemo(() => {
    let debt = 0;
    let lessons = 0;
    let prepay = 0;
    for (const r of valid) {
      const n = netDebtAndPrepay(r);
      debt += n.debtAmount + (r.price ?? 0) * n.debtLessons;
      prepay += n.prepayAmount + (r.price ?? 0) * n.prepayLessons;
      lessons += scheduleOf(r).length * IMPORT_SCHEDULE_WEEKS;
    }
    return { debt, prepay, lessons };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scheduleOf читає assignedSlots
  }, [valid, assignedSlots]);

  const runImport = async () => {
    if (lock.locked && needsPro) { lock.openPaywall(); return; }
    if (!user || valid.length === 0 || busy) return;
    setBusy(true);
    setProgress({ done: 0, total: valid.length });
    let added = 0;
    let linked = 0;
    let failed = 0;
    let noDebt = 0;
    let debtTotal = 0;
    let scheduled = 0;
    const failedNames: string[] = [];
    const notes: Array<{ student_id: string; note: string }> = [];
    // Послідовно, не Promise.all: RPC створює профілі й уроки, і паралельний
    // шквал лише збільшує шанс гонок/лімітів; 20 учнів = кілька секунд.
    for (let i = 0; i < valid.length; i++) {
      const r = valid[i];
      const net = netDebtAndPrepay(r);
      const starts = scheduleToStarts(scheduleOf(r), IMPORT_SCHEDULE_WEEKS).map((d) => d.toISOString());
      // 13.09: «Олена — борг 2 уроки» без ціни. RPC відкидає такий борг
      // (DEBT_LESSONS_NEED_PRICE), і раніше учень МОВЧКИ не створювався —
      // з зеленою галочкою в превʼю. Тепер учня створюємо, а борг уроками
      // лишається словами в нотатці, поки не буде ціни.
      const debtLessonsNoPrice = net.debtLessons > 0 && !(r.price && r.price > 0);
      const rowNote = [r.note, debtLessonsNoPrice ? t("importStudents.noteDebtLessons", { count: net.debtLessons }) : null, ...subjectNotesOf(r)]
        .filter(Boolean).join(" · ");
      if (debtLessonsNoPrice) noDebt++;
      try {
        // cast: import_student_bundle потрапляє у згенеровані типи після міграції
        const { data, error } = await (supabase as any).rpc("import_student_bundle", {
          _first_name: r.firstName,
          _last_name: r.lastName,
          _email: r.email ?? "",
          _phone: r.phone ?? "",
          _telegram: r.telegram ?? "",
          _subject: subjectOf(r) ?? t("importStudents.defaultSubject"),
          _price: r.price ?? 0,
          _currency: IMPORT_CURRENCY,
          _debt_amount: net.debtAmount,
          _debt_lessons: debtLessonsNoPrice ? 0 : net.debtLessons,
          _prepay_lessons: net.prepayLessons,
          _prepay_amount: net.prepayAmount,
          _lesson_starts: starts,
          _duration_minutes: r.durationMinutes ?? 60,
          _wallet_note: t("importStudents.walletNote"),
        });
        if (error || !data) {
          const msg = String(error?.message ?? "");
          if (/SUBSCRIPTION_REQUIRED/.test(msg)) { setBusy(false); setProgress(null); lock.openPaywall(); return; }
          failed++;
          failedNames.push(r.firstName);
        } else {
          const d = data as { student_id?: string; action?: string; debt_total?: number; scheduled?: number };
          if (d.action === "linked") linked++; else added++;
          debtTotal += Number(d.debt_total ?? 0);
          scheduled += Number(d.scheduled ?? 0);
          if (rowNote && d.student_id) notes.push({ student_id: d.student_id, note: rowNote });
        }
      } catch {
        failed++;
        failedNames.push(r.firstName);
      }
      setProgress({ done: i + 1, total: valid.length });
    }
    // Нерозпізнані хвости («мама платить 1 числа») — у приватну нотатку про
    // учня (та сама tutor_student_notes, що й у формі додавання), best-effort.
    for (const n of notes) {
      await (supabase as any)
        .from("tutor_student_notes")
        .upsert({ tutor_id: user.id, student_id: n.student_id, notes: n.note }, { onConflict: "tutor_id,student_id" });
    }
    setBusy(false);
    setProgress(null);
    logEvent("students_imported", { added, linked, failed, total: valid.length, debtTotal, scheduled });
    // 13.09: анонімні «форми» невпізнаного — щоб словник парсера ріс із реальних
    // нотаток. Жодних імен і сум: цифри → #, слова з великої → Х; рядки без
    // імені — лише структура. Це те, на чому вирішуватимемо, чи потрібен AI.
    const shapes = [
      ...resolvedLog.current.map((x) => ({ shape: x.shape, chosen: x.chosen })),
      ...valid.map((r) => unsureOf(r)).filter(Boolean).map((u) => ({ shape: unrecognizedShape(u!.fragment), chosen: "unresolved" })),
      ...broken.map((r) => ({ shape: `no_name:${r.raw.split(/\s+/).length}w:${(r.raw.match(/\d+/g) ?? []).length}n`, chosen: "skipped" })),
    ];
    if (shapes.length) logEvent("import_unrecognized", { shapes: shapes.slice(0, 40) });
    resolvedLog.current = [];
    if (added + linked > 0) {
      const parts: string[] = [];
      if (debtTotal > 0) parts.push(t("importStudents.doneDebts", { sum: formatPrice(debtTotal, IMPORT_CURRENCY) }));
      if (scheduled > 0) parts.push(t("importStudents.doneLessons", { count: scheduled }));
      if (noDebt > 0) parts.push(t("importStudents.doneNoDebt", { count: noDebt }));
      if (failed > 0) parts.push(t("importStudents.doneFailed", { count: failed }));
      if (orphansSkipped > 0) parts.push(t("importStudents.doneOrphansSkipped", { count: orphansSkipped }));
      toast.success(t("importStudents.doneTitle", { count: added + linked }), {
        description: parts.length ? parts.join(" · ") : undefined,
      });
      // Хто саме не додався — по імені, а не «N не вдалося»: людина мусить
      // знати, кого дописати вручну.
      if (failed > 0) toast.error(t("importStudents.failedNames", { names: failedNames.join(", ") }));
      setText("");
      onOpenChange(false);
      onImported?.({ students: added + linked, debtTotal, scheduled, failed });
    } else {
      toast.error(t("importStudents.allFailed"), { description: failedNames.length ? failedNames.join(", ") : undefined });
    }
  };

  const warnText = (w: ImportWarning) => t(`importStudents.warn_${w}`);

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
            <div className="mt-3 space-y-3">
              <p className="text-[13px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sub,#62677E)" }}>
                {t("importStudents.confirmLabel", { count: valid.length })}
                {unsureCount > 0 && <span className="ml-2 normal-case tracking-normal text-amber-700 dark:text-amber-400">· 🤔 {t("importStudents.unsureCount", { count: unsureCount })}</span>}
              </p>
              <p className="text-[13px] text-muted-foreground">{t("importStudents.tapToFix")}</p>
              {valid.slice(0, 40).map((r, idx) => {
                const isEd = (f: EditableField) => editing?.raw === r.raw && editing.field === f;
                const chip = (field: EditableField, label: string, value: number | null, unit: string, tone?: "warn") => (
                  <EditChip
                    key={field}
                    label={label}
                    value={value}
                    unit={unit}
                    tone={tone}
                    editing={isEd(field)}
                    editLabel={t("importStudents.editLabel", { field: t(`importStudents.${FIELD_LABEL_KEY[field]}`) })}
                    doneLabel={t("importStudents.editDone")}
                    onEdit={() => setEditing({ raw: r.raw, field })}
                    onCancel={() => setEditing(null)}
                    onCommit={(v) => { setField(r.raw, field, v); setEditing(null); }}
                  />
                );
                const u = unsureOf(r);
                const info: string[] = [];
                const slots = scheduleOf(r);
                if (slots.length > 0) info.push(slots.map((s) => `${dayName(s.weekday)} ${s.time}`).join(", "));
                for (const sn of subjectNotesOf(r)) info.push(`📝 ${sn}`);
                if (r.phone) info.push("📞");
                if (r.email) info.push("✉️");
                // Аудит 09.09: нерозпізнаний хвіст їде в приватну нотатку — людина
                // мусить бачити, що він прийнявся (📝), а не губити свій коментар.
                if (r.note && !u) info.push(`📝 ${r.note}`);
                if (r.note && u && u.rest) info.push(`📝 ${u.rest}`);
                return (
                  <div key={`${idx}:${r.raw}`} className="text-[14px] text-foreground">
                    <div className="flex items-start gap-2">
                      <span aria-hidden style={{ color: "var(--teal,#2BBFAA)" }}>✓</span>
                      <span className="min-w-0 font-semibold">{r.firstName} {r.lastName}</span>
                      {subjectOf(r) && <span className="text-muted-foreground">· {subjectOf(r)}</span>}
                    </div>
                    <div className="ml-6 mt-1.5 flex flex-wrap items-center gap-1.5">
                      {chip("price", r.price !== null ? t("importStudents.chipPrice", { sum: formatPrice(r.price, IMPORT_CURRENCY) }) : t("importStudents.noPrice"), r.price, sym)}
                      {(r.debtAmount !== null || r.debtFlag) && chip("debtAmount",
                        r.debtAmount !== null ? t("importStudents.chipDebt", { sum: formatPrice(r.debtAmount, IMPORT_CURRENCY) }) : t("importStudents.chipDebtUnknown"),
                        r.debtAmount, sym, r.debtAmount === null ? "warn" : undefined)}
                      {r.debtLessons !== null && chip("debtLessons", t("importStudents.chipDebtLessons", { count: r.debtLessons }), r.debtLessons, t("importStudents.unitLessons"))}
                      {r.prepayAmount !== null && chip("prepayAmount", t("importStudents.chipPrepay", { sum: formatPrice(r.prepayAmount, IMPORT_CURRENCY) }), r.prepayAmount, sym)}
                      {r.prepayLessons !== null && chip("prepayLessons", t("importStudents.chipPrepayLessonsShort", { count: r.prepayLessons }), r.prepayLessons, t("importStudents.unitLessons"))}
                      {info.map((s, i) => <span key={i} className="text-muted-foreground">{s}</span>)}
                    </div>
                    {r.warnings.map((w) => (
                      <p key={w} className="ml-6 mt-1 text-[13px] text-amber-700 dark:text-amber-400">⚠️ {warnText(w)}</p>
                    ))}
                    {u && (
                      <div className="ml-6 mt-1.5">
                        <p className="text-[14px] text-amber-700 dark:text-amber-400">🤔 {t("importStudents.unsureQuestion", { fragment: u.fragment })}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {/* Те саме правило, що в парсері: ≤ 30 — це уроки, більше — гроші.
                              «борг 800 уроків» і «борг 2 грн» як варіанти лише збивають. */}
                          {([
                            ...(u.value > 30 ? [
                              ["debtAmount", t("importStudents.unsureDebt", { sum: formatPrice(u.value, IMPORT_CURRENCY) })],
                              ["prepayAmount", t("importStudents.unsurePrepay", { sum: formatPrice(u.value, IMPORT_CURRENCY) })],
                              ["price", t("importStudents.unsurePrice", { sum: formatPrice(u.value, IMPORT_CURRENCY) })],
                            ] : [
                              ["debtLessons", t("importStudents.unsureDebtLessons", { count: u.value })],
                              ["prepayLessons", t("importStudents.unsurePrepayLessons", { count: u.value })],
                            ]),
                            ["note", t("importStudents.unsureNote")],
                          ] as Array<[UnsureChoice, string]>).map(([choice, label]) => (
                            <button key={choice} type="button" onClick={() => answerUnsure(r, choice)}
                              className={"h-11 rounded-full border-[0.5px] px-3 text-[14px] " + (choice === "note" ? "border-border text-muted-foreground" : "border-primary text-primary font-semibold")}>
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {valid.length > 40 && <p className="text-[13px] text-muted-foreground">{t("importStudents.moreRows", { count: valid.length - 40 })}</p>}
              {orphans.length > 0 && (
                <div className="mt-2 rounded-[16px] border-[0.5px] border-border bg-secondary/50 p-3">
                  <p className="text-[14px] font-semibold text-foreground">🗓 {t("importStudents.orphanTitle")}</p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">{t("importStudents.orphanHint")}</p>
                  {orphans.map((o, i) => {
                    const label = `${o.subject ? o.subject.charAt(0).toUpperCase() + o.subject.slice(1) : t("importStudents.orphanLesson")} · ${o.schedule.map((s) => `${dayName(s.weekday)} ${s.time}`).join(", ")}`;
                    const cur = overrides[o.raw]?.assignTo;
                    return (
                      <div key={`o${i}:${o.raw}`} className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-[14px] text-foreground">{label}</span>
                        <select
                          aria-label={label}
                          value={cur === undefined ? "" : cur === "" ? "__skip" : cur}
                          onChange={(e) => {
                            const v = e.target.value;
                            setOverrides((prev) => ({ ...prev, [o.raw]: { ...(prev[o.raw] ?? {}), assignTo: v === "" ? undefined : v === "__skip" ? "" : v } }));
                          }}
                          className={"h-11 rounded-xl border-[0.5px] bg-background px-3 text-[15px] " + (cur ? "border-primary text-foreground" : "border-amber-500 text-amber-700 dark:text-amber-400")}
                        >
                          <option value="">{t("importStudents.orphanPick")}</option>
                          {valid.map((st) => (
                            <option key={st.raw} value={st.raw}>{[st.firstName, st.lastName].filter(Boolean).join(" ")}</option>
                          ))}
                          <option value="__skip">{t("importStudents.orphanSkip")}</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}
              {broken.map((r, i) => (
                <div key={`b${i}`} className="flex items-start gap-2 text-[14px] text-amber-700 dark:text-amber-400">
                  <span aria-hidden>🤔</span>
                  <span className="min-w-0">{t("importStudents.noNameLine", { line: r.raw.length > 60 ? r.raw.slice(0, 59) + "…" : r.raw })}</span>
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
          {valid.length > 0 && (summary.debt > 0 || summary.lessons > 0 || summary.prepay > 0) && (
            <p className="mt-2 text-[13px] text-muted-foreground">
              {[
                summary.debt > 0 ? t("importStudents.sumDebt", { sum: formatPrice(summary.debt, IMPORT_CURRENCY) }) : null,
                summary.prepay > 0 ? t("importStudents.sumPrepay", { sum: formatPrice(summary.prepay, IMPORT_CURRENCY) }) : null,
                summary.lessons > 0 ? t("importStudents.sumLessons", { count: summary.lessons, weeks: IMPORT_SCHEDULE_WEEKS }) : null,
              ].filter(Boolean).join(" · ")}
            </p>
          )}
          <p className="mt-2 text-[13px] text-muted-foreground">{t("importStudents.priceHint")}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
