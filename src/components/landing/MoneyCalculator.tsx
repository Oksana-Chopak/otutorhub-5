import { useMemo, useRef, useState, useEffect, useId } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { parseStudentList, IMPORT_CURRENCY } from "@/lib/importStudents";
import { calcMoneyPreview, CALC_WEEKS } from "@/lib/landingCalc";
import { formatPrice } from "@/lib/currency";
import { landingEvent, saveLandingDraft, peekLandingDraft } from "@/lib/landingFunnel";
import { metaTrack } from "@/lib/metaPixel";

/**
 * «Порахуй свої гроші» — перший екран замість опису продукту (рішення 09.09).
 *
 * Ідея власниці: не розповідати, а дати спробувати. Людина вставляє свій список
 * і бачить ЦИФРИ раніше, ніж форму реєстрації. Це лікує головну причину з
 * премортему — «ага» не наставало, бо цінність вимагала пів години міграції.
 *
 * Три рішення, які тут принципові:
 *  1. Рахує ТОЙ САМИЙ парсер і та сама грошова функція, що й імпорт усередині.
 *     Побачене на лендінгу дорівнює побаченому після реєстрації — інакше довіра
 *     згорає рівно там, де щойно народилась.
 *  2. Все — у браузері. Ми просимо чужі імена й чужі гроші; те, що дані нікуди
 *     не летять, сказано вголос, а не сховано в політиці приватності.
 *  3. Герой — БОРГ, а не заробіток. «Ти заробляєш 28 800» приємно й забувається;
 *     «тобі винні 4 200» — біль, який людина вже носить, і саме його лікує
 *     продукт нагадуваннями.
 */
export function MoneyCalculator({ signupHref }: { signupHref: string }) {
  const { t } = useTranslation();
  const taId = useId();
  const [text, setText] = useState(() => peekLandingDraft() ?? "");
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Поле росте під вставлений список: людина мусить БАЧИТИ, що вставила,
  // інакше перший учень ховається за скролом рівно тоді, коли вона звіряє
  // цифри. Стеля — щоб список на 40 імен не з'їв усю сторінку.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 420)}px`;
  }, [text]);

  const rows = useMemo(() => parseStudentList(text), [text]);
  const calc = useMemo(() => calcMoneyPreview(rows), [rows]);
  const has = calc.students > 0;

  // Знаменник воронки: скільки взагалі побачили пропозицію порахувати.
  useEffect(() => { landingEvent("landing_view"); metaTrack("PageView"); }, []);
  useEffect(() => {
    if (text.trim().length > 0) landingEvent("landing_paste_started");
  }, [text]);
  useEffect(() => {
    if (calc.students > 0) landingEvent("landing_rows_parsed", { students: calc.students });
    if (calc.students > 0 && (calc.owed > 0 || calc.monthly > 0)) {
      landingEvent("landing_numbers_shown", { owed: calc.owed, monthly: calc.monthly, students: calc.students });
      // Для реклами «побачив свої цифри» — і є той момент цінності, під який
      // варто оптимізувати покази. Реєстрація йде далі, окремою подією.
      metaTrack("Lead", { students: calc.students, owed: calc.owed, monthly: calc.monthly });
    }
  }, [calc.students, calc.owed, calc.monthly]);

  const money = (n: number) => formatPrice(Math.round(n), IMPORT_CURRENCY);

  return (
    <section className="l-section" id="calc" style={{ background: "var(--bg)" }}>
      <div className="section-inner" style={{ maxWidth: 760 }}>
        <div className="section-label">{t("landingCalc.label")}</div>
        <h2>{t("landingCalc.title")}</h2>
        <p style={{ fontSize: 16, color: "var(--l-muted, #666b82)", marginTop: 8, marginBottom: 18 }}>
          {t("landingCalc.sub")}
        </p>

        <label htmlFor={taId} className="sr-only">{t("landingCalc.fieldLabel")}</label>
        <textarea
          ref={taRef}
          id={taId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder={t("landingCalc.placeholder")}
          spellCheck={false}
          style={{
            width: "100%", borderRadius: 16, border: "0.5px solid var(--border,#e6e8ef)",
            background: "var(--surface,#fff)", color: "var(--txt,#0f0f1a)",
            padding: "14px 16px", fontSize: 16, lineHeight: 1.5, resize: "vertical",
            fontFamily: "'Golos Text', system-ui, sans-serif",
          }}
        />
        <p style={{ fontSize: 13, color: "var(--l-muted,#666b82)", marginTop: 8 }}>
          {t("landingCalc.privacy")}
        </p>

        {has && (
          <div style={{ marginTop: 22 }}>
            {/* ГЕРОЙ — борг. Якщо боргів немає, місце не пустує: кажемо це вголос. */}
            <div style={{
              borderRadius: 18, padding: "20px 22px", color: "#fff",
              background: "linear-gradient(135deg,#0f0f1a,#1a1f3a)",
              boxShadow: "0 16px 38px -20px rgba(15,15,26,.75)",
            }}>
              {calc.owed > 0 ? (
                <>
                  <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "rgba(255,255,255,.6)" }}>
                    {t("landingCalc.owedLabel")}
                  </div>
                  <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.1, marginTop: 6 }}>{money(calc.owed)}</div>
                  <div style={{ fontSize: 15, color: "rgba(255,255,255,.75)", marginTop: 4 }}>
                    {t("landingCalc.owedFrom", { count: calc.owedStudents })}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 17, fontWeight: 600 }}>{t("landingCalc.zeroOwed")}</div>
              )}
              {/* Передоплата — дзеркало боргу: гроші вже в кишені, а уроки ще ні.
                  Без цього рядка людина з самими передоплатами бачила «боргів немає»
                  і жодної своєї цифри. */}
              {calc.prepaid > 0 && (
                <div style={{ fontSize: 15, color: "rgba(255,255,255,.75)", marginTop: calc.owed > 0 ? 10 : 6, paddingTop: calc.owed > 0 ? 10 : 0, borderTop: calc.owed > 0 ? "1px solid rgba(255,255,255,.14)" : "none" }}>
                  {t(calc.owed > 0 ? "landingCalc.prepaidLine" : "landingCalc.prepaidOnly", { amount: money(calc.prepaid), count: calc.prepaidStudents })}
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
              <div style={{ borderRadius: 16, border: "0.5px solid var(--border,#e6e8ef)", background: "var(--surface,#fff)", padding: "14px 16px" }}>
                <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--l-muted,#666b82)" }}>
                  {t("landingCalc.monthlyLabel", { weeks: CALC_WEEKS })}
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "var(--txt,#0f0f1a)", marginTop: 4 }}>{money(calc.monthly)}</div>
                <div style={{ fontSize: 14, color: "var(--l-muted,#666b82)", marginTop: 2 }}>
                  {t("landingCalc.lessons", { count: calc.lessonsPerMonth })}
                </div>
              </div>
              <div style={{ borderRadius: 16, border: "0.5px solid var(--border,#e6e8ef)", background: "var(--surface,#fff)", padding: "14px 16px" }}>
                <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--l-muted,#666b82)" }}>
                  {t("landingCalc.studentsLabel")}
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "var(--txt,#0f0f1a)", marginTop: 4 }}>{calc.students}</div>
                {calc.withoutPrice > 0 && (
                  <div style={{ fontSize: 14, color: "var(--l-muted,#666b82)", marginTop: 2 }}>
                    {t("landingCalc.noPriceHint", { count: calc.withoutPrice })}
                  </div>
                )}
              </div>
            </div>

            {/* Припущення НЕ ховаємо: людина мусить бачити, з чого вийшло число. */}
            {calc.noScheduleStudents > 0 && (
              <p style={{ fontSize: 14, color: "var(--l-muted,#666b82)", marginTop: 10 }}>
                {t("landingCalc.noSchedule", { count: calc.noScheduleStudents })}
              </p>
            )}
            {calc.unvaluedDebtStudents > 0 && (
              <p style={{ fontSize: 14, color: "var(--l-muted,#666b82)", marginTop: 6 }}>
                {t("landingCalc.unvalued", { count: calc.unvaluedDebtStudents })}
              </p>
            )}

            <div style={{ marginTop: 18 }}>
              <Link
                to={signupHref}
                className="btn-primary"
                onClick={() => { saveLandingDraft(text); landingEvent("landing_signup_started", { students: calc.students, owed: calc.owed }); }}
              >
                {t("landingCalc.cta")}
              </Link>
              <p style={{ fontSize: 14, color: "var(--l-muted,#666b82)", marginTop: 10 }}>
                {t("landingCalc.ctaHint")}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
