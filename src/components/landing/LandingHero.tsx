import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { openExternal } from "@/lib/openExternal";
import { isNativeApp } from "@/lib/platform";
import { parseStudentList, toCanonicalText, IMPORT_CURRENCY, type CanonicalWords } from "@/lib/importStudents";
import { calcMoneyPreview, digestPreview, CALC_WEEKS, formatDigestDay } from "@/lib/landingCalc";
import { formatPrice } from "@/lib/currency";
import { getLocale } from "@/lib/locale";
import { landingEvent, saveLandingDraft, peekLandingDraft, rememberHandoffToken } from "@/lib/landingFunnel";
import { metaTrack } from "@/lib/metaPixel";

/**
 * Герой лендінгу = ОДИН потік (переродження 12.09 після розносу власниці:
 * «одна дія, один вау-флоу, чіткість з першого рядка»).
 *
 *   заголовок-обіцянка → поле «хто вам винен» → дайджест, як прийде завтра
 *   о 07:30 → ОДНА кнопка «хай нагадує за мене».
 *
 * Що тут принципово:
 *  1. Поле читає список у режимі «debts»: «Артем 1500» — це борг, «Соня винна
 *     за 2 уроки» — борг уроками, «Даша не оплатила» — борг без суми. Це той
 *     самий парсер, що й імпорт у застосунку, тож число тут дорівнює числу
 *     після реєстрації; в естафету їде КАНОНІЧНИЙ текст (toCanonicalText),
 *     який імпорт читає однозначно.
 *  2. Без кнопки «порахувати»: дайджест перемальовується на кожен символ —
 *     на мобілці при першому розпізнаному учні сторінка сама підʼїжджає до
 *     бульбашки. «Натиснула — і нічого» більше неможливе.
 *  3. Порожнє поле — не порожній екран: бульбашка показує дайджест із
 *     прикладу (розібраного тим самим парсером), підписаний як приклад.
 *  4. Одна первинна дія — реєстрація зі списком усередині. Telegram до
 *     реєстрації лишився як другорядне посилання під кнопкою; після await
 *     посилання рендериться явно, бо блокувальники спливних вікон (Safari,
 *     iframe превʼю) мовчки ковтають window.open — саме так «кнопка нічого
 *     не робила» 12.09.
 *  5. Усе рахується в браузері; на сервер список іде лише коли людина сама
 *     тисне Telegram — і про це сказано під посиланням.
 */
export function LandingHero({ signupHref }: { signupHref: string }) {
  const { t, i18n } = useTranslation();
  const taId = useId();
  const [text, setText] = useState(() => peekLandingDraft() ?? "");
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);

  const sample = t("landingHero.sample");
  const isExample = text.trim().length === 0;
  const source = isExample ? sample : text;

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 168), 420)}px`;
  }, [text]);

  const rows = useMemo(() => parseStudentList(source, { mode: "debts" }), [source]);
  const calc = useMemo(() => calcMoneyPreview(rows), [rows]);
  const digest = useMemo(() => digestPreview(rows), [rows]);
  const has = calc.students > 0;
  const dayLabel = useMemo(() => (digest.day ? formatDigestDay(digest.day.date, getLocale()) : ""), [digest.day]);
  const money = (n: number) => formatPrice(Math.round(n), IMPORT_CURRENCY);
  const MAX_NAMES = 4;

  // Канонічний текст для естафети — те, що імпорт прочитає рівно так само.
  const kw: CanonicalWords = useMemo(() => ({
    debt: t("importStudents.kwDebt"),
    prepay: t("importStudents.kwPrepay"),
    lessons: t("importStudents.kwLessons"),
    money: t("importStudents.kwMoney"),
    min: t("importStudents.kwMin"),
    day: (wd: number) => t(`importStudents.day${wd}`),
  }), [t]);
  const canonical = useMemo(() => (isExample ? "" : toCanonicalText(rows, kw)), [rows, kw, isExample]);

  // Воронка: побачив → почав вставляти → розпізнано → побачив цифри.
  useEffect(() => { landingEvent("landing_view"); metaTrack("PageView"); }, []);
  useEffect(() => { if (!isExample) landingEvent("landing_paste_started"); }, [isExample]);
  useEffect(() => {
    if (isExample || !has) return;
    landingEvent("landing_rows_parsed", { students: calc.students });
    if (calc.owed > 0 || calc.monthly > 0) {
      landingEvent("landing_numbers_shown", { owed: calc.owed, monthly: calc.monthly, students: calc.students });
      metaTrack("Lead", { students: calc.students, owed: calc.owed, monthly: calc.monthly });
    }
  }, [isExample, has, calc.students, calc.owed, calc.monthly]);

  // Мобілка: перший розпізнаний учень — сторінка сама підʼїжджає до відповіді.
  const scrolled = useRef(false);
  useEffect(() => {
    if (isExample || !has || scrolled.current) return;
    scrolled.current = true;
    if (window.matchMedia("(max-width: 959px)").matches) {
      setTimeout(() => bubbleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    }
  }, [isExample, has]);

  const debtorLabel = (d: { name: string; amount: number; lessons: number; unknown?: boolean }) =>
    d.unknown ? `${d.name} · ${t("landingHero.unknownDebt")}`
      : d.amount > 0 ? `${d.name} ${money(d.amount)}`
        : `${d.name} ${t("landingHero.debtLessons", { count: d.lessons })}`;

  // Текст для Telegram — рядок у рядок те, що в бульбашці.
  const digestText = useMemo(() => {
    if (!has) return "";
    const lines: string[] = [];
    lines.push(digest.day ? t("landingHero.greetDay", { day: dayLabel, count: digest.day.lessons.length }) : t("landingHero.greet"));
    if (digest.day) {
      for (const l of digest.day.lessons.slice(0, 8)) lines.push(`${l.time} ${l.name}`);
      if (digest.day.lessons.length > 8) lines.push(t("landingHero.more", { count: digest.day.lessons.length - 8 }));
    } else {
      lines.push(t("landingHero.noLessons"));
    }
    lines.push("");
    if (calc.owed > 0 || digest.debtors.length > 0) {
      lines.push(`💸 ${calc.owed > 0 ? `${t("landingHero.owedLabel")} ${money(calc.owed)}` : t("landingHero.owedNoSum")}`);
      const names = digest.debtors.slice(0, MAX_NAMES).map(debtorLabel);
      if (digest.debtors.length > MAX_NAMES) names.push(t("landingHero.more", { count: digest.debtors.length - MAX_NAMES }));
      lines.push(names.join(" · "));
      lines.push(t("landingHero.promise"));
    } else {
      lines.push(t("landingHero.zeroOwed"));
    }
    if (calc.prepaid > 0) lines.push(t("landingHero.prepaidLine", { amount: money(calc.prepaid), count: calc.prepaidStudents }));
    if (calc.lessonsPerMonth > 0) {
      lines.push("");
      lines.push(t("landingHero.monthLine", { weeks: CALC_WEEKS, amount: money(calc.monthly), lessons: t("landingHero.lessons", { count: calc.lessonsPerMonth }) }));
    }
    return lines.join("\n").slice(0, 3900);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [has, digest, dayLabel, calc, i18n.language]);

  const [tgBusy, setTgBusy] = useState(false);
  const [tgLink, setTgLink] = useState<string | null>(null);
  const [tgError, setTgError] = useState<string | null>(null);
  const sendToTelegram = async () => {
    if (tgBusy || !has || isExample) return;
    setTgBusy(true); setTgError(null);
    try {
      const lang = (["uk", "en", "sv"] as const).find((l) => i18n.language?.startsWith(l)) ?? "uk";
      const { data: token, error } = await (supabase as any).rpc("create_landing_handoff", { _list: canonical, _digest: digestText, _lang: lang });
      if (error || typeof token !== "string") {
        setTgError(/RATE_LIMITED/.test(String(error?.message ?? "")) ? t("landingHero.tgRateLimited") : t("landingHero.tgFailed"));
        return;
      }
      rememberHandoffToken(token);
      saveLandingDraft(canonical);
      landingEvent("landing_telegram_started", { students: calc.students, owed: calc.owed });
      const { data: bot } = await (supabase as any).rpc("landing_bot_username").catch(() => ({ data: null }));
      const url = `https://t.me/${typeof bot === "string" && bot ? bot : "oTutorHubBot"}?start=${token}`;
      setTgLink(url);
      // Мобілка: перехід у тій самій вкладці — єдине, що Safari не блокує після
      // await; Telegram відкриється сам. Десктоп: нова вкладка, а якщо її
      // заблокували — під кнопкою вже стоїть звичайне посилання.
      if (isNativeApp()) void openExternal(url);
      else if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) window.location.assign(url);
      else window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setTgBusy(false);
    }
  };

  const ctaLabel = isExample ? t("landingHero.ctaEmpty") : calc.owed > 0 || digest.debtors.length > 0 ? t("landingHero.ctaRemind") : t("landingHero.ctaDaily");
  const hint = !isExample && has
    ? calc.unvaluedDebtStudents > 0 ? t("landingHero.hintNoPrice", { count: calc.unvaluedDebtStudents })
      : calc.noScheduleStudents > 0 ? t("landingHero.hintNoSchedule") : null
    : null;

  return (
    <section className="hero" id="top">
      <div className="hero-grid">
        <div className="hero-copy">
          <div className="eyebrow">{t("landingHero.eyebrow")}</div>
          <h1 style={{ whiteSpace: "pre-line" }}>{t("landingHero.title")}</h1>
          <p className="hero-sub">{t("landingHero.sub")}</p>

          <div className="paste-card" id="calc">
            <label htmlFor={taId} className="paste-label">{t("landingHero.fieldLabel")}</label>
            <textarea
              ref={taRef}
              id={taId}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder={sample}
              spellCheck={false}
              className="paste-field"
            />
            <div className="paste-foot">
              <span className="paste-privacy">🔒 {t("landingHero.privacy")}</span>
              {isExample ? (
                <button type="button" className="paste-link" onClick={() => { setText(sample); taRef.current?.focus(); }}>
                  {t("landingHero.tryExample")}
                </button>
              ) : (
                <button type="button" className="paste-link" onClick={() => { setText(""); taRef.current?.focus(); }}>
                  {t("landingHero.clear")}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="hero-result">
          <div className="bubble-wrap" ref={bubbleRef} aria-live="polite">
            <div className={"bubble-tag" + (isExample ? " is-example" : "")}>
              {isExample ? t("landingHero.exampleTag") : t("landingHero.yoursTag")}
            </div>
            <div className="bubble-head">
              <span className="bubble-avatar" aria-hidden="true">☀️</span>
              <span className="bubble-sender">oTutorHub</span>
              <span className="bubble-time">{t("landingHero.time")}</span>
            </div>
            <div className="bubble" key={isExample ? "example" : "yours"}>
              <p className="bubble-greet">
                {digest.day ? t("landingHero.greetDay", { day: dayLabel, count: digest.day.lessons.length }) : t("landingHero.greet")}
              </p>
              {digest.day ? (
                <ul className="bubble-lessons">
                  {digest.day.lessons.slice(0, 5).map((l, i) => (
                    <li key={i}><span className="bubble-lesson-time">{l.time}</span>{l.name}</li>
                  ))}
                  {digest.day.lessons.length > 5 && <li className="bubble-muted">{t("landingHero.more", { count: digest.day.lessons.length - 5 })}</li>}
                </ul>
              ) : (
                <p className="bubble-muted">{t("landingHero.noLessons")}</p>
              )}

              <div className="bubble-block">
                {calc.owed > 0 || digest.debtors.length > 0 ? (
                  <>
                    <div className="bubble-owed-label">💸 {calc.owed > 0 ? t("landingHero.owedLabel") : t("landingHero.owedNoSum")}</div>
                    {calc.owed > 0 && <div className="bubble-owed">{money(calc.owed)}</div>}
                    <div className="bubble-names">
                      {digest.debtors.slice(0, MAX_NAMES).map((d, i) => (
                        <span key={i} className="bubble-name">{debtorLabel(d)}</span>
                      ))}
                      {digest.debtors.length > MAX_NAMES && (
                        <span className="bubble-name is-more">{t("landingHero.more", { count: digest.debtors.length - MAX_NAMES })}</span>
                      )}
                    </div>
                    <p className="bubble-promise">{t("landingHero.promise")}</p>
                  </>
                ) : (
                  <p className="bubble-zero">{t("landingHero.zeroOwed")}</p>
                )}
                {calc.prepaid > 0 && (
                  <p className="bubble-muted" style={{ marginTop: 10 }}>
                    {t("landingHero.prepaidLine", { amount: money(calc.prepaid), count: calc.prepaidStudents })}
                  </p>
                )}
              </div>

              {calc.lessonsPerMonth > 0 && (
                <p className="bubble-month">
                  {t("landingHero.monthLine", { weeks: CALC_WEEKS, amount: money(calc.monthly), lessons: t("landingHero.lessons", { count: calc.lessonsPerMonth }) })}
                </p>
              )}
            </div>
            {hint && <p className="bubble-hint">{hint}</p>}
          </div>

          <div className="hero-cta">
            <Link
              to={signupHref}
              className="btn-primary btn-big"
              onClick={() => {
                if (canonical) saveLandingDraft(canonical);
                landingEvent("landing_signup_started", { students: isExample ? 0 : calc.students, owed: isExample ? 0 : calc.owed });
              }}
            >
              {ctaLabel}
            </Link>
            <p className="cta-note">{t("landingHero.ctaNote")}</p>

            {!isExample && has && (
              <div className="tg-row">
                {tgLink ? (
                  <>
                    <a href={tgLink} target="_blank" rel="noopener noreferrer" className="tg-link">{t("landingHero.tgOpen")}</a>
                    <p className="cta-note">{t("landingHero.tgOpened")}</p>
                  </>
                ) : (
                  <>
                    <button type="button" className="tg-link" onClick={() => void sendToTelegram()} disabled={tgBusy} aria-busy={tgBusy}>
                      {tgBusy ? t("landingHero.tgOpening") : t("landingHero.tgLink")}
                    </button>
                    <p className="cta-note">{t("landingHero.tgHint")}</p>
                  </>
                )}
                {tgError && <p role="alert" className="cta-error">{tgError}</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
