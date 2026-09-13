import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { getLocale } from "@/lib/locale";
import { openExternal } from "@/lib/openExternal";
import { formatPrice } from "@/lib/currency";
import { IMPORT_CURRENCY } from "@/lib/importStudents";
import { Loader2, Paperclip, ChevronDown } from "lucide-react";

/**
 * Матеріали й історія уроків учня (рішення власниці 11.09, доопрацьовано 12.09).
 *
 * ЩО БУЛО НЕ ТАК (питання власниці 12.09): «наступний урок сьогодні о 12:30,
 * а домашку показує ніби з учорашнього — це я щось наплутала?». Ні, не
 * наплутала: картка показувала ЛИШЕ дату — без часу і без жодної ознаки, урок
 * уже відбувся чи ще попереду. Домашку можна (і нормально) написати наперед,
 * але тоді список зобовʼязаний це сказати, інакше майбутній урок виглядає як
 * запис про минуле. Тепер у шапці кожної картки — дата, ЧАС і статус.
 *
 * ДВІ ВКЛАДКИ:
 *   🗂 Матеріали — тільки уроки, де щось Є (конспект, домашка, нотатка, файл).
 *      Відповідає на «що взагалі є в цього учня».
 *   🕘 Історія   — УСІ уроки підряд: коли, проведено чи ні, оплачено чи ні.
 *      Відповідає на «що в нас із ним відбувалось».
 *
 * ЗГОРТАННЯ: картка складається в ОДИН рядок і розгортається назад. За
 * замовчуванням розгорнута лише найсвіжіша — решта згорнуті, бо при двадцяти
 * уроках розгорнутий список гортати неможливо. Довгі конспект і домашка
 * всередині мають власне «показати повністю ↔ згорнути» (раніше домашка не
 * згорталась узагалі й займала екран).
 *
 * Уроки без матеріалів у вкладці «Матеріали» не показуються — це перелік
 * того, що є, а не журнал відвідувань; журнал тепер поруч, в «Історії».
 *
 * Приватні нотатки (`lesson_tutor_notes`) бачить ЛИШЕ репетитор: RLS віддає
 * їх автору, і компонент не питає їх у режимі учня взагалі.
 */
export interface MaterialItem {
  lessonId: string;
  startsAt: string;
  subject: string | null;
  status: string;
  summary: string | null;
  homework: string | null;
  privateNote: string | null;
  files: { id: string; name: string; path: string }[];
  /** Гроші показуємо лише в «Історії» і лише коли ціна справді є. */
  price: number | null;
  currency: string | null;
  paid: boolean | null;
}

/**
 * Стан уроку так, як його читає репетитор, а не як він лежить у базі.
 * Чиста функція — саме вона відповідає на питання власниці 12.09 «це вже
 * було чи ще буде», тож вона під тестом, а не схована в рендері.
 */
export type LessonState = "cancelled" | "done" | "upcoming" | "unmarked";
export function lessonStateOf(status: string, startsAt: string, now: number = Date.now()): LessonState {
  if (status === "cancelled") return "cancelled";
  if (status === "completed") return "done";
  // Минулий і ДОСІ «заплановано» — той урок, що чекає відмітки.
  return new Date(startsAt).getTime() > now ? "upcoming" : "unmarked";
}

const MAX_LESSONS = 40;
/** Довший за це конспект/домашка складаються під «показати повністю». */
const LONG_TEXT = 260;
const CLAMP_PX = 120;

type Tab = "materials" | "history";

export function StudentMaterials({
  studentId,
  tutorId,
  onOpenLesson,
}: {
  studentId: string;
  /** Чиї уроки показуємо. Для репетитора — його власні. */
  tutorId: string;
  onOpenLesson?: (lessonId: string) => void;
}) {
  const { t } = useTranslation();
  const [all, setAll] = useState<MaterialItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>("materials");
  /** Розгорнуті КАРТКИ. Ключ — lessonId. */
  const [openCards, setOpenCards] = useState<Record<string, boolean>>({});
  /** Розгорнуті довгі тексти всередині картки. Ключ — `${lessonId}:summary|homework`. */
  const [openText, setOpenText] = useState<Record<string, boolean>>({});
  const [busyFile, setBusyFile] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setAll(null);
    setFailed(false);
    (async () => {
      try {
        // 07.09: перенесені борги — не уроки, матеріалів у них не буває.
        const base = (withCarried: boolean) => supabase
          .from("lessons_visible")
          .select(withCarried ? "id, starts_at, subject, status, carried_over" : "id, starts_at, subject, status")
          .eq("tutor_id", tutorId)
          .eq("student_id", studentId)
          .order("starts_at", { ascending: false })
          .limit(MAX_LESSONS);

        let les: any[];
        const first = await base(true);
        if (first.error) {
          // до міграції carried_over колонки немає — питаємо без неї
          const alt = await base(false);
          les = (alt.data as any[]) ?? [];
        } else {
          les = ((first.data as any[]) ?? []).filter((l) => l.carried_over !== true);
        }
        const ids = les.map((l) => l.id);
        if (ids.length === 0) { if (alive) setAll([]); return; }

        // 13.09: у lesson_details НЕМАЄ колонки currency (types.ts — живе дзеркало
        // схеми). Запит із нею падав на 400 цілком, і в картці учня зникали
        // конспекти, домашки й суми — «матеріали порожні» одразу після релізу
        // вкладок. Валюта пари живе в student_rates; за замовчуванням — валюта
        // імпорту (гривня). Помилку деталей більше не ковтаємо мовчки.
        const [det, notes, atts, rate] = await Promise.all([
          supabase.from("lesson_details")
            .select("lesson_id, summary, homework, student_price, student_payment_status")
            .in("lesson_id", ids),
          (supabase as any).from("lesson_tutor_notes").select("lesson_id, notes").in("lesson_id", ids),
          supabase.from("lesson_attachments").select("id, lesson_id, file_name, storage_path").in("lesson_id", ids),
          supabase.from("student_rates").select("currency").eq("tutor_id", tutorId).eq("student_id", studentId).limit(1).maybeSingle(),
        ]);
        if (det.error) throw det.error;
        const pairCurrency = (rate.data as { currency?: string } | null)?.currency || IMPORT_CURRENCY;

        const dMap: Record<string, any> = {};
        ((det.data as any[]) ?? []).forEach((d) => { dMap[d.lesson_id] = d; });
        const nMap: Record<string, string> = {};
        ((notes?.data as any[]) ?? []).forEach((n) => { if ((n.notes ?? "").trim()) nMap[n.lesson_id] = n.notes; });
        const fMap: Record<string, MaterialItem["files"]> = {};
        ((atts.data as any[]) ?? []).forEach((a) => {
          (fMap[a.lesson_id] ??= []).push({ id: a.id, name: a.file_name, path: a.storage_path });
        });

        const list: MaterialItem[] = les.map((l) => {
          const d = dMap[l.id];
          // ІНВАРІАНТ ГРОШЕЙ: відсутня ціна рендериться як ВІДСУТНЯ, ніколи
          // не підміняється сусіднім полем (CLAUDE.md, «виплата = оплата»).
          const rawPrice = d?.student_price;
          const price = rawPrice === null || rawPrice === undefined ? null : Number(rawPrice);
          return {
            lessonId: l.id,
            startsAt: l.starts_at,
            subject: l.subject ?? null,
            status: l.status,
            summary: (d?.summary ?? "").trim() || null,
            homework: (d?.homework ?? "").trim() || null,
            privateNote: nMap[l.id] ?? null,
            files: fMap[l.id] ?? [],
            price: price !== null && Number.isFinite(price) && price > 0 ? price : null,
            currency: pairCurrency,
            paid: d?.student_payment_status ? d.student_payment_status === "paid" : null,
          };
        });

        if (alive) setAll(list);
      } catch {
        if (alive) { setFailed(true); setAll([]); }
      }
    })();
    return () => { alive = false; };
  }, [studentId, tutorId]);

  const hasStuff = (i: MaterialItem) =>
    !!(i.summary || i.homework || i.privateNote || i.files.length > 0);

  const items = useMemo(
    () => (all ?? []).filter((i) => (tab === "materials" ? hasStuff(i) : true)),
    [all, tab],
  );

  // Найсвіжіша картка відкрита, решта згорнуті: при двадцяти уроках
  // розгорнутий список неможливо гортати, але й ховати ВСЕ — знову клікати.
  useEffect(() => {
    if (!all || all.length === 0) return;
    const newest = (tab === "materials" ? all.filter(hasStuff) : all)[0];
    if (newest) setOpenCards({ [newest.lessonId]: true });
  }, [all, tab]);

  const openFile = async (path: string, id: string) => {
    if (busyFile) return;
    setBusyFile(id);
    try {
      const { data } = await supabase.storage.from("lesson-attachments").createSignedUrl(path, 60);
      if (data?.signedUrl) void openExternal(data.signedUrl);
    } finally {
      setBusyFile(null);
    }
  };

  // Дата й час — ОКРЕМИМИ форматерами. Комбінований скелет «день+місяць+час»
  // у Chromium дає інший відмінок, ніж у Node, і тест цього не ловить
  // (пастка 11.09 з датою дайджесту).
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(getLocale(), { day: "numeric", month: "short" });
  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit" });

  const CHIP: Record<LessonState, { key: string; fg: string; bg: string }> = {
    cancelled: { key: "lessonCard.statusCancelled", fg: "var(--sub,#62677E)", bg: "rgba(147,152,176,.16)" },
    done:      { key: "lessonCard.statusCompleted", fg: "var(--success-text,#11803a)", bg: "rgba(34,197,94,.14)" },
    upcoming:  { key: "lessonCard.statusScheduled", fg: "var(--teal-text,#1a7a6c)", bg: "rgba(43,191,170,.14)" },
    unmarked:  { key: "studentMaterials.statusUnmarked", fg: "var(--warning-text,#B45309)", bg: "rgba(245,158,11,.16)" },
  };
  const chipOf = (i: MaterialItem) => {
    const c = CHIP[lessonStateOf(i.status, i.startsAt)];
    return { label: t(c.key), fg: c.fg, bg: c.bg };
  };

  /** Що всередині — видно НЕ розгортаючи. */
  const marks = (i: MaterialItem) => {
    const m: string[] = [];
    if (i.summary) m.push("✨");
    if (i.homework) m.push("📚");
    if (i.files.length) m.push(`📎${i.files.length > 1 ? i.files.length : ""}`);
    if (i.privateNote) m.push("🔒");
    return m;
  };

  const allOpen = items.length > 0 && items.every((i) => openCards[i.lessonId]);
  const toggleAll = () => {
    if (allOpen) setOpenCards({});
    else setOpenCards(Object.fromEntries(items.map((i) => [i.lessonId, true])));
  };

  if (all === null) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 2px", fontSize: 15, color: "var(--sub,#62677E)" }}>
        <Loader2 className="h-4 w-4 animate-spin" /> {t("studentMaterials.loading")}
      </div>
    );
  }
  if (failed) {
    return <p style={{ fontSize: 15, color: "var(--sub,#62677E)", padding: "10px 2px" }}>{t("studentMaterials.failed")}</p>;
  }

  const TEXT = { fontSize: 15, lineHeight: 1.55, color: "var(--ds-txt,#0f0f1a)", margin: 0, whiteSpace: "pre-wrap" as const };
  const LABEL = { fontSize: 14, fontWeight: 700, color: "var(--sub,#62677E)", marginBottom: 4 };

  /** Довгий текст із власним «показати повністю ↔ згорнути». */
  const LongText = ({ id, value }: { id: string; value: string }) => {
    const long = value.length > LONG_TEXT;
    const on = openText[id] ?? false;
    return (
      <>
        <p style={{ ...TEXT, maxHeight: long && !on ? CLAMP_PX : undefined, overflow: long && !on ? "hidden" : undefined }}>
          {value}
        </p>
        {long && (
          <button type="button" className="tap-44" onClick={() => setOpenText((p) => ({ ...p, [id]: !on }))}
            style={{ marginTop: 4, border: "none", background: "transparent", cursor: "pointer", padding: "4px 0", fontSize: 15, fontWeight: 700, color: "var(--teal-text,#1a7a6c)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            {on ? t("studentMaterials.less") : t("studentMaterials.more")}
            <ChevronDown size={15} style={{ transform: on ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
          </button>
        )}
      </>
    );
  };

  const tabBtn = (key: Tab, label: string) => {
    const on = tab === key;
    return (
      <button type="button" key={key} onClick={() => setTab(key)}
        style={{
          flex: 1, minHeight: 44, border: "none", cursor: "pointer", background: "transparent",
          fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15,
          color: on ? "var(--teal-text,#1a7a6c)" : "var(--sub,#62677E)",
          borderBottom: `2.5px solid ${on ? "#2BBFAA" : "transparent"}`,
        }}>
        {label}
      </button>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", borderBottom: "1px solid var(--ds-border,#eceef3)" }}>
        {tabBtn("materials", `🗂 ${t("studentMaterials.tabMaterials")}`)}
        {tabBtn("history", `🕘 ${t("studentMaterials.tabHistory")}`)}
      </div>

      {items.length > 1 && (
        <button type="button" className="tap-44" onClick={toggleAll}
          style={{ alignSelf: "flex-start", border: "none", background: "transparent", cursor: "pointer", padding: "4px 2px", fontSize: 15, fontWeight: 700, color: "var(--teal-text,#1a7a6c)" }}>
          {allOpen ? t("studentMaterials.collapseAll") : t("studentMaterials.expandAll")}
        </button>
      )}

      {items.length === 0 && (
        <p style={{ fontSize: 15, color: "var(--sub,#62677E)", padding: "10px 2px" }}>
          {tab === "materials" ? t("studentMaterials.empty") : t("studentMaterials.historyEmpty")}
        </p>
      )}

      {items.map((it) => {
        const on = openCards[it.lessonId] ?? false;
        const chip = chipOf(it);
        const mk = marks(it);
        return (
          <div key={it.lessonId}
            style={{ borderRadius: 16, border: "1px solid var(--ds-border,#eceef3)", background: "var(--ds-surface,#fff)", overflow: "hidden" }}>
            {/* ОДИН РЯДОК: уся шапка — перемикач згорнути/розгорнути */}
            <button type="button" onClick={() => setOpenCards((p) => ({ ...p, [it.lessonId]: !on }))}
              aria-expanded={on}
              style={{
                width: "100%", minHeight: 52, padding: "10px 12px", border: "none", background: "transparent",
                cursor: "pointer", display: "flex", alignItems: "center", gap: 9, textAlign: "left",
              }}>
              <ChevronDown size={18} style={{ flexShrink: 0, color: "var(--sub,#62677E)", transform: on ? "none" : "rotate(-90deg)", transition: "transform .2s" }} />
              {/* Дата й ЧАС — перший рядок і ніколи не обрізаються: саме вони
                  відповідають на «це вже було чи ще буде». Предмет і позначки
                  того, що всередині, — другий рядок. */}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15, color: "var(--ds-txt,#0f0f1a)", whiteSpace: "nowrap" }}>
                  {fmtDate(it.startsAt)}, {fmtTime(it.startsAt)}
                </span>
                <span style={{ display: "block", fontSize: 14, color: "var(--sub,#62677E)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {[it.subject, on ? null : (mk.length ? mk.join(" ") : t("studentMaterials.noContent"))].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span style={{ flexShrink: 0, fontSize: 13, fontWeight: 700, padding: "3px 9px", borderRadius: 999, color: chip.fg, background: chip.bg, whiteSpace: "nowrap" }}>
                {chip.label}
              </span>
            </button>

            {on && (
              <div style={{ padding: "0 14px 14px" }}>
                {tab === "history" && it.price !== null && (
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10, color: it.paid ? "var(--success-text,#11803a)" : "var(--warning-text,#B45309)" }}>
                    {formatPrice(it.price, it.currency)} · {it.paid ? t("studentMaterials.paid") : t("studentMaterials.unpaid")}
                  </div>
                )}

                {it.summary && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={LABEL}>✨ {t("studentMaterials.summary")}</div>
                    <LongText id={`${it.lessonId}:s`} value={it.summary} />
                  </div>
                )}

                {it.homework && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={LABEL}>📚 {t("studentMaterials.homework")}</div>
                    <LongText id={`${it.lessonId}:h`} value={it.homework} />
                  </div>
                )}

                {it.privateNote && (
                  <div style={{ marginBottom: 10, borderRadius: 12, background: "var(--ds-surface2,#FFFCF4)", border: "1px solid rgba(245,181,68,.35)", padding: "9px 12px" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--warning-text,#B45309)", marginBottom: 3 }}>🔒 {t("studentMaterials.privateNote")}</div>
                    <LongText id={`${it.lessonId}:n`} value={it.privateNote} />
                  </div>
                )}

                {it.files.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                    {it.files.map((f) => (
                      <button key={f.id} type="button" className="tap-44" disabled={busyFile === f.id} onClick={() => void openFile(f.path, f.id)}
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 40, padding: "0 13px", borderRadius: 11, cursor: "pointer",
                          border: "1px solid var(--ds-border,#eceef3)", background: "var(--ds-surface2,#fbfbfc)", color: "var(--ds-txt,#0f0f1a)", fontSize: 15, fontWeight: 600, maxWidth: "100%" }}>
                        {busyFile === f.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                      </button>
                    ))}
                  </div>
                )}

                {onOpenLesson && (
                  <button type="button" className="tap-44" onClick={() => onOpenLesson(it.lessonId)}
                    style={{ border: "none", background: "transparent", cursor: "pointer", padding: "4px 2px", fontSize: 15, fontWeight: 700, color: "var(--teal-text,#1a7a6c)", fontFamily: "Inter, system-ui, sans-serif" }}>
                    {t("studentMaterials.openLesson")} →
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
