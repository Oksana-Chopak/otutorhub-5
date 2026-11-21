import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { CURRENCY_OPTIONS, currencySymbol, formatPrice } from "@/lib/currency";

export interface PairValue {
  tutorId: string;
  subject: string;
  price: string;
  currency: string;
}

export interface PairTutor {
  id: string;
  name: string;
  subjects: string[];
}

/** Порожня пара (валюта за замовчуванням — гривня). */
export const EMPTY_PAIR: PairValue = { tutorId: "", subject: "", price: "", currency: "UAH" };

/** Предмети, які ще можна дати цій парі: предмети репетитора (або спільний список), без уже заведених. */
export function availablePairSubjects(tutor: PairTutor | undefined, fallback: string[], taken: Set<string>): string[] {
  const own = tutor?.subjects ?? [];
  return (own.length > 0 ? own : fallback).filter((sb) => !taken.has(sb));
}

/**
 * Поля пари «учень — репетитор — предмет — ціна для учня» (менеджер школи).
 *
 * ОДНА копія на застосунок (21.11, рішення власниці п. 1): стоїть і у формі «Додати
 * репетитора до учня», і у формі «Новий учень», де менеджер одразу призначає репетитора
 * й ціну. Вигляд — канон форм 14.11: репетитор і валюта — рідний вибір телефона (спливні
 * списки «блимали й зникали»), предмет — кнопками в один дотик (48px), ціна — у золотій
 * картці, як у сусідній формі ціни.
 *
 * FINANCE INVARIANT: ціна учня НІКОЛИ не підставляється зі ставки репетитора — такий
 * префіл тихо зрівнював student_price з tutor_payout і обнуляв маржу школи. Ставку
 * показуємо лише підказкою поруч, разом із маржею.
 */
export function PairFields({
  idPrefix, tutors, fallbackSubjects, takenSubjects, tutorRate, value, onChange, tutorHint,
}: {
  /** Префікс id полів: `add-tutor` → `add-tutor-tutor`, `add-tutor-price` (на них стоять проходи). */
  idPrefix: string;
  tutors: PairTutor[];
  fallbackSubjects: string[];
  /** Предмети, які в цієї пари вже є (форма «додати ще репетитора / предмет»). */
  takenSubjects?: (tutorId: string) => Set<string>;
  tutorRate: (tutorId: string, subject: string) => number | undefined;
  value: PairValue;
  onChange: (next: PairValue) => void;
  /** Сірий хвостик біля підпису «Репетитор» — напр. «можна пізніше». */
  tutorHint?: string;
}) {
  const { t } = useTranslation();
  const tutor = tutors.find((tu) => tu.id === value.tutorId);
  const available = value.tutorId
    ? availablePairSubjects(tutor, fallbackSubjects, takenSubjects?.(value.tutorId) ?? new Set())
    : [];
  const rate = value.tutorId && value.subject ? tutorRate(value.tutorId, value.subject) : undefined;
  const sp = Number(value.price);
  const margin = rate !== undefined && rate > 0 && Number.isFinite(sp) && sp > 0 ? sp - rate : null;
  const set = (patch: Partial<PairValue>) => onChange({ ...value, ...patch });

  return (
    <>
      <div>
        <label htmlFor={`${idPrefix}-tutor`} style={{ display: "block", marginBottom: 6, fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 14, color: "var(--sub,#62677E)" }}>
          {t("roles.tutor")}
          {tutorHint ? <span style={{ marginLeft: 4, fontWeight: 600 }}>{tutorHint}</span> : null}
        </label>
        <select
          id={`${idPrefix}-tutor`}
          value={value.tutorId}
          onChange={(e) => {
            const tid = e.target.value;
            // Один предмет у репетитора — обираємо його самі: на один вибір менше.
            const next = tid ? availablePairSubjects(tutors.find((tu) => tu.id === tid), fallbackSubjects, takenSubjects?.(tid) ?? new Set()) : [];
            set({ tutorId: tid, subject: next.length === 1 ? next[0] : "" });
          }}
          style={{ width: "100%", height: 58, borderRadius: 15, padding: "0 14px", background: "var(--ds-surface2,#fbfbfc)", border: "1.5px solid var(--ds-border,#eceef3)", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 17, color: value.tutorId ? "var(--ds-txt,#0f0f1a)" : "var(--ds-muted,#6f7489)" }}
        >
          <option value="">{t("people.selectTutorPlaceholder")}</option>
          {tutors.map((tu) => (
            <option key={tu.id} value={tu.id}>{tu.name}</option>
          ))}
        </select>
      </div>
      {value.tutorId && (available.length === 0 ? (
        <p style={{ fontSize: 15, lineHeight: 1.45, color: "var(--sub,#62677E)", margin: 0 }}>
          {t("people.allSubjectsAdded")}
        </p>
      ) : (
        <>
          <div>
            <div id={`${idPrefix}-subject-label`} style={{ marginBottom: 8, fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 14, color: "var(--sub,#62677E)" }}>
              {t("people.labelSubject").replace(":", "")}
            </div>
            <div role="radiogroup" aria-labelledby={`${idPrefix}-subject-label`} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {available.map((sb) => {
                const sel = sb === value.subject;
                return (
                  <button
                    key={sb}
                    type="button"
                    role="radio"
                    aria-checked={sel}
                    data-subject-chip=""
                    // FINANCE INVARIANT: ціну учня НІКОЛИ не префілимо ставкою репетитора.
                    onClick={() => set({ subject: sb })}
                    style={{ minHeight: 48, padding: "0 16px", borderRadius: 14, cursor: "pointer", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15, border: sel ? "1.5px solid var(--teal,#2BBFAA)" : "1.5px solid var(--ds-border,#eceef3)", background: sel ? "var(--teal-l,#f0fdf9)" : "var(--ds-surface2,#fbfbfc)", color: sel ? "var(--teal-text,#0F6E56)" : "var(--ds-txt,#0f0f1a)" }}
                  >
                    {sb}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ borderRadius: 16, padding: 14, background: "linear-gradient(135deg,#FFF7E6,#FFEFD0)", border: "1px solid rgba(245,181,68,.4)" }}>
            <label htmlFor={`${idPrefix}-price`} style={{ display: "block", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 14, color: "#7a5410", marginBottom: 8 }}>
              {t("people.priceForStudent", { currency: currencySymbol(value.currency) })}
            </label>
            <div className="grid grid-cols-[1fr_7.5rem] gap-2">
              <Input
                id={`${idPrefix}-price`}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={value.price}
                onChange={(e) => set({ price: e.target.value })}
                placeholder={t("people.pricePlaceholder")}
                className="h-[52px] bg-card text-[18px] font-bold rounded-[13px]"
                style={{ fontFamily: "Inter, system-ui, sans-serif" }}
              />
              <select
                aria-label={t("quickAddStudent.currency")}
                value={value.currency}
                onChange={(e) => set({ currency: e.target.value })}
                className="bg-card text-foreground"
                style={{ height: 52, borderRadius: 13, padding: "0 10px", border: "0.5px solid hsl(var(--input))", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 16 }}
              >
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
            </div>
            {rate !== undefined && rate > 0 && (
              <p style={{ margin: "10px 0 0", fontSize: 14, lineHeight: 1.45, color: "#7a5410" }}>
                {t("people.tutorRateForSubject")}{" "}
                <span style={{ fontWeight: 700 }}>{formatPrice(rate, "UAH")}</span>
                {margin !== null && value.currency === "UAH" && (
                  <>
                    {" · "}{t("people.hubMarginLabel")}{" "}
                    <span style={{ fontWeight: 800, color: margin > 0 ? "#7a5410" : "#B42318" }}>
                      {formatPrice(margin, "UAH")}
                    </span>
                  </>
                )}
              </p>
            )}
          </div>
        </>
      ))}
    </>
  );
}
