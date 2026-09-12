import { useMemo, useRef, useState, useEffect, useId } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { openExternal } from "@/lib/openExternal";
import { parseStudentList, IMPORT_CURRENCY } from "@/lib/importStudents";
import { calcMoneyPreview, digestPreview, CALC_WEEKS, formatDigestDay } from "@/lib/landingCalc";
import { formatPrice } from "@/lib/currency";
import { getLocale } from "@/lib/locale";
import { landingEvent, saveLandingDraft, peekLandingDraft, rememberHandoffToken } from "@/lib/landingFunnel";
import { shareCardBlob } from "@/lib/shareCard";
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
 *  4. (10.09) Результат — не таблиця цифр, а ТВІЙ ЗАВТРАШНІЙ РАНОК: той самий
 *     дайджест, що приходитиме в Telegram, з іменами й часом із твого списку.
 *     Це те, що пересилають колезі: застосунок говорить про твій понеділок ще
 *     до реєстрації. Кнопка під ним — не «зареєструйся», а перша дія в
 *     продукті: нагадати всім про борг (список уже чекає всередині — естафета).
 *  5. (11.09) «Отримати це в Telegram» — той самий дайджест приходить у
 *     месенджер ДО реєстрації: список + готовий текст лягають під токен
 *     (create_landing_handoff, 24 год), відкривається бот із deep-link, а
 *     кнопка «Створити акаунт» у боті несе той самий токен — Telegram буде
 *     прив'язаний до акаунта автоматично. Це єдиний момент, коли список іде
 *     на сервер, і про це сказано під кнопкою.
 */
export function MoneyCalculator({ signupHref }: { signupHref: string }) {
  const { t, i18n } = useTranslation();
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
  const digest = useMemo(() => digestPreview(rows), [rows]);
  const has = calc.students > 0;
  const dayLabel = useMemo(() => {
    if (!digest.day) return "";
    return formatDigestDay(digest.day.date, getLocale());
  }, [digest.day]);
  const MAX_NAMES = 3;

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

  // Текст для Telegram — ТЕ САМЕ, що в бульбашці нижче, рядок у рядок:
  // бот лише пересилає, тож число в месенджері дорівнює числу на екрані.
  const digestText = useMemo(() => {
    if (!has) return "";
    const lines: string[] = [];
    lines.push(digest.day
      ? t("landingCalc.digestDay", { day: dayLabel, count: digest.day.lessons.length })
      : t("landingCalc.digestNoDay"));
    if (digest.day) {
      for (const l of digest.day.lessons.slice(0, 8)) lines.push(`${l.time} ${l.name}`);
      if (digest.day.lessons.length > 8) lines.push(t("landingCalc.digestMore", { count: digest.day.lessons.length - 8 }));
    }
    lines.push("");
    if (calc.owed > 0) {
      lines.push(`💸 ${t("landingCalc.owedLabel")}: ${money(calc.owed)}`);
      const names = digest.debtors.slice(0, MAX_NAMES).map((d) =>
        d.amount > 0 ? `${d.name} ${money(d.amount)}` : `${d.name} ${t("landingCalc.debtLessons", { count: d.lessons })}`);
      if (digest.debtors.length > MAX_NAMES) names.push(t("landingCalc.digestMore", { count: digest.debtors.length - MAX_NAMES }));
      lines.push(names.join(" · "));
    } else {
      lines.push(`✅ ${t("landingCalc.zeroOwed")}`);
    }
    if (calc.prepaid > 0) {
      lines.push(t(calc.owed > 0 ? "landingCalc.prepaidLine" : "landingCalc.prepaidOnly", { amount: money(calc.prepaid), count: calc.prepaidStudents }));
    }
    lines.push("");
    lines.push(`📈 ${t("landingCalc.digestMonth", {
      weeks: CALC_WEEKS, amount: money(calc.monthly),
      lessons: t("landingCalc.lessons", { count: calc.lessonsPerMonth }),
      students: t("landingCalc.students", { count: calc.students }),
    })}`);
    return lines.join("\n").slice(0, 3900);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [has, digest, dayLabel, calc, i18n.language]);

  // Картка «мій тиждень» (12.09): без імен і без грошей — лише кількості,
  // дні й час, і обіцянка продукту. Web Share на телефоні; на десктопі — файл.
  const [shareBusy, setShareBusy] = useState(false);
  const [shareDone, setShareDone] = useState(false);
  const shareCard = async () => {
    if (shareBusy || !has) return;
    setShareBusy(true); setShareDone(false);
    try {
      const byDay = new Map<number, string[]>();
      for (const r of rows) {
        if (r.error) continue;
        for (const sl of r.schedule) {
          const arr = byDay.get(sl.weekday) ?? [];
          if (!arr.includes(sl.time)) arr.push(sl.time);
          byDay.set(sl.weekday, arr);
        }
      }
      const scheduleLines = [...byDay.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([wd, times]) => `${t(`importStudents.day${wd}`)} · ${times.sort().join(", ")}`);
      const blob = await shareCardBlob({
        title: t("landingShare.title"),
        students: t("landingCalc.students", { count: calc.students }),
        lessons: t("landingShare.lessons", { weeks: CALC_WEEKS, lessons: t("landingCalc.lessons", { count: calc.lessonsPerMonth }) }),
        scheduleTitle: t("landingShare.schedule"),
        scheduleLines,
        promise: t("landingShare.promise"),
        site: "otutorhub.com",
      });
      if (!blob) return;
      landingEvent("landing_share_card", { students: calc.students });
      const file = new File([blob], "otutorhub-week.png", { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
        try { await nav.share({ files: [file], title: t("landingShare.title"), text: t("landingShare.shareText") }); } catch { /* скасовано */ }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = "otutorhub-week.png"; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
      setShareDone(true);
    } finally {
      setShareBusy(false);
    }
  };

  const [tgBusy, setTgBusy] = useState(false);
  const [tgLink, setTgLink] = useState<string | null>(null);
  const [tgError, setTgError] = useState<string | null>(null);
  const sendToTelegram = async () => {
    if (tgBusy || !has) return;
    setTgBusy(true); setTgError(null);
    try {
      const lang = (["uk", "en", "sv"] as const).find((l) => i18n.language?.startsWith(l)) ?? "uk";
      const { data: token, error } = await (supabase as any).rpc("create_landing_handoff", { _list: text, _digest: digestText, _lang: lang });
      if (error || typeof token !== "string") {
        setTgError(/RATE_LIMITED/.test(String(error?.message ?? "")) ? t("landingCalc.tgRateLimited") : t("landingCalc.tgFailed"));
        return;
      }
      rememberHandoffToken(token);
      saveLandingDraft(text);
      landingEvent("landing_telegram_started", { students: calc.students, owed: calc.owed });
      // Ім'я бота — з бази (бот записує його сам); до першого опитування — типове.
      const { data: bot } = await (supabase as any).rpc("landing_bot_username").catch(() => ({ data: null }));
      const url = `https://t.me/${typeof bot === "string" && bot ? bot : "oTutorHubBot"}?start=${token}`;
      setTgLink(url);
      void openExternal(url);
    } finally {
      setTgBusy(false);
    }
  };

  return (
    <section className="l-section" id="calc" style={{ background: "var(--bg)" }}>
      <style>{styles}</style>
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
          <div className="mc-result" style={{ marginTop: 22 }}>
            {/* Дайджест «як у Telegram»: те саме повідомлення, що приходитиме
                щоранку, — але вже з іменами й часом із цього списку. */}
            <div className="mc-bubble-wrap" aria-live="polite">
              <div className="mc-bubble-head">
                <span className="mc-avatar" aria-hidden="true">☀️</span>
                <span className="mc-sender">oTutorHub</span>
                <span className="mc-time">07:30</span>
              </div>
              <div className="mc-bubble">
                <p className="mc-greet">
                  {digest.day
                    ? t("landingCalc.digestDay", { day: dayLabel, count: digest.day.lessons.length })
                    : t("landingCalc.digestNoDay")}
                </p>
                {digest.day && (
                  <ul className="mc-lessons">
                    {digest.day.lessons.slice(0, 4).map((l, i) => (
                      <li key={i}><span className="mc-lesson-time">{l.time}</span> {l.name}</li>
                    ))}
                    {digest.day.lessons.length > 4 && (
                      <li className="mc-more">{t("landingCalc.digestMore", { count: digest.day.lessons.length - 4 })}</li>
                    )}
                  </ul>
                )}

                <div className="mc-owed-block">
                  {calc.owed > 0 ? (
                    <>
                      <div className="mc-owed-label">💸 {t("landingCalc.owedLabel")}</div>
                      <div className="mc-owed">{money(calc.owed)}</div>
                      <div className="mc-debtors">
                        {digest.debtors.slice(0, MAX_NAMES).map((d) =>
                          d.amount > 0 ? `${d.name} ${money(d.amount)}` : `${d.name} ${t("landingCalc.debtLessons", { count: d.lessons })}`,
                        ).join(" · ")}
                        {digest.debtors.length > MAX_NAMES && ` · ${t("landingCalc.digestMore", { count: digest.debtors.length - MAX_NAMES })}`}
                      </div>
                    </>
                  ) : (
                    <div className="mc-zero">✅ {t("landingCalc.zeroOwed")}</div>
                  )}
                  {/* Передоплата — дзеркало боргу: гроші вже в кишені, а уроки ще ні.
                      Без цього рядка людина з самими передоплатами бачила «боргів немає»
                      і жодної своєї цифри. */}
                  {calc.prepaid > 0 && (
                    <div className="mc-prepaid">
                      {t(calc.owed > 0 ? "landingCalc.prepaidLine" : "landingCalc.prepaidOnly", { amount: money(calc.prepaid), count: calc.prepaidStudents })}
                    </div>
                  )}
                </div>

                <p className="mc-month">
                  📈 {t("landingCalc.digestMonth", {
                    weeks: CALC_WEEKS,
                    amount: money(calc.monthly),
                    lessons: t("landingCalc.lessons", { count: calc.lessonsPerMonth }),
                    students: t("landingCalc.students", { count: calc.students }),
                  })}
                </p>
              </div>
              <p className="mc-caption">{t("landingCalc.digestCaption")}</p>
            </div>

            {/* Припущення НЕ ховаємо: людина мусить бачити, з чого вийшло число. */}
            {calc.noScheduleStudents > 0 && (
              <p style={{ fontSize: 14, color: "var(--l-muted,#666b82)", marginTop: 12 }}>
                {t("landingCalc.noSchedule", { count: calc.noScheduleStudents })}
              </p>
            )}
            {calc.withoutPrice > 0 && (
              <p style={{ fontSize: 14, color: "var(--l-muted,#666b82)", marginTop: 6 }}>
                {t("landingCalc.noPriceHint", { count: calc.withoutPrice })}
              </p>
            )}
            {calc.unvaluedDebtStudents > 0 && (
              <p style={{ fontSize: 14, color: "var(--l-muted,#666b82)", marginTop: 6 }}>
                {t("landingCalc.unvalued", { count: calc.unvaluedDebtStudents })}
              </p>
            )}

            <div style={{ marginTop: 18 }}>
              {/* Перша дія в продукті, а не «зареєструйся»: список уже чекає
                  всередині (естафета), тож кнопка обіцяє рівно те, що станеться. */}
              <Link
                to={signupHref}
                className="btn-primary"
                onClick={() => { saveLandingDraft(text); landingEvent("landing_signup_started", { students: calc.students, owed: calc.owed }); }}
              >
                {t(calc.owed > 0 ? "landingCalc.ctaRemind" : "landingCalc.ctaDaily")}
              </Link>
              <p style={{ fontSize: 14, color: "var(--l-muted,#666b82)", marginTop: 10 }}>
                {t("landingCalc.ctaHint")}
              </p>

              {/* Дайджест у Telegram ДО реєстрації: застосунок уже працює на людину,
                  а вона ще ніде не реєструвалась. */}
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: "0.5px solid var(--border,#e6e8ef)" }}>
                {tgLink ? (
                  /* Після await блокувальники спливних вікон часто не пускають
                     window.open — тому прямий лінк, який спрацьовує від дотику завжди. */
                  <>
                    <a href={tgLink} target="_blank" rel="noopener noreferrer" className="btn-ghost">
                      {t("landingCalc.tgOpen")}
                    </a>
                    <p style={{ fontSize: 13, color: "var(--l-muted,#666b82)", marginTop: 8 }}>
                      {t("landingCalc.tgOpened")}
                    </p>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => void sendToTelegram()}
                      disabled={tgBusy}
                      aria-busy={tgBusy}
                    >
                      {tgBusy ? t("landingCalc.tgOpening") : t("landingCalc.tgCta")}
                    </button>
                    <p style={{ fontSize: 13, color: "var(--l-muted,#666b82)", marginTop: 8 }}>
                      {t("landingCalc.tgHint")}
                    </p>
                  </>
                )}
                {tgError && (
                  <p role="alert" style={{ fontSize: 14, marginTop: 6, color: "#b42318" }}>{tgError}</p>
                )}
                <div style={{ marginTop: 14 }}>
                  <button type="button" className="btn-ghost" onClick={() => void shareCard()} disabled={shareBusy} aria-busy={shareBusy}>
                    {t("landingShare.cta")}
                  </button>
                  <p style={{ fontSize: 13, color: "var(--l-muted,#666b82)", marginTop: 8 }}>
                    {shareDone ? t("landingShare.done") : t("landingShare.hint")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* Бульбашка «як у Telegram»: темна картка (як був герой-борг), але з іменами
   і часом, тобто з тим, що людина справді отримає о 07:30. */
const styles = `
.mc-bubble-wrap { max-width: 520px; }
.mc-bubble-head { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--l-muted,#666b82); margin:0 0 6px 4px; }
.mc-avatar { width:26px; height:26px; border-radius:50%; background:linear-gradient(135deg,#ffd166,#f4a261); display:inline-flex; align-items:center; justify-content:center; font-size:14px; }
.mc-sender { font-weight:700; color:var(--txt,#0f0f1a); }
.mc-time { margin-left:auto; }
.mc-bubble { border-radius:18px 18px 18px 6px; padding:18px 20px; color:#fff;
  background:linear-gradient(135deg,#0f0f1a,#1a1f3a); box-shadow:0 16px 38px -20px rgba(15,15,26,.75); font-size:15px; line-height:1.5; }
.mc-greet { margin:0; font-weight:600; }
.mc-lessons { list-style:none; margin:8px 0 0; padding:0; display:grid; gap:2px; color:rgba(255,255,255,.85); }
.mc-lesson-time { display:inline-block; min-width:52px; font-variant-numeric:tabular-nums; color:rgba(255,255,255,.6); }
.mc-more { color:rgba(255,255,255,.6); }
.mc-owed-block { margin-top:14px; padding-top:12px; border-top:1px solid rgba(255,255,255,.14); }
.mc-owed-label { font-size:13px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:rgba(255,255,255,.6); }
.mc-owed { font-size:38px; font-weight:800; line-height:1.1; margin-top:4px; }
.mc-debtors { margin-top:6px; color:rgba(255,255,255,.8); }
.mc-zero { font-weight:600; }
.mc-prepaid { margin-top:8px; color:rgba(255,255,255,.75); font-size:14px; }
.mc-month { margin:12px 0 0; padding-top:12px; border-top:1px solid rgba(255,255,255,.14); color:rgba(255,255,255,.85); }
.mc-caption { font-size:13px; color:var(--l-muted,#666b82); margin:8px 0 0 4px; }
`;
