import "@/styles/landing-fonts.css";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LandingFindTutorQuizDialog } from "@/components/LandingFindTutorQuizDialog";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

/**
 * /for-students — окрема сторінка для учнів і батьків (рішення 10.09).
 *
 * Головна говорить із репетитором — платною персоною. Блок «Ви учень і
 * шукаєте репетитора?» посеред неї змушував сторінку говорити двома голосами
 * і розмивав шлях того, хто платить. Запити на підбір — справжні й потрібні,
 * тож вони переїхали сюди: на свою сторінку зі своїм заголовком, куди ведуть
 * посилання з головної (тонка смужка + футер) і куди можна вести рекламу для
 * учнів окремо від реклами для репетиторів.
 *
 * Анкета — та сама LandingFindTutorQuizDialog (tutor_referral_requests):
 * менеджер бачить запити там само, де й раніше.
 */
export default function ForStudentsPage() {
  const { t } = useTranslation();
  const [quizOpen, setQuizOpen] = useState(false);

  useEffect(() => {
    const prev = document.title;
    document.title = t("forStudents.docTitle");
    return () => { document.title = prev; };
  }, [t]);

  const steps = [
    { n: "1", title: t("forStudents.s1Title"), text: t("forStudents.s1Text") },
    { n: "2", title: t("forStudents.s2Title"), text: t("forStudents.s2Text") },
    { n: "3", title: t("forStudents.s3Title"), text: t("forStudents.s3Text") },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between gap-4">
          <Link to="/" className="font-bold text-lg" style={{ fontFamily: "'Unbounded', sans-serif" }}>
            oTutorHub
          </Link>
          <div className="flex items-center gap-3">
            <LanguageSwitcher variant="ghost" size="sm" />
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              {t("forStudents.forTutors")}
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12 md:py-16">
        <p className="text-[13px] font-bold tracking-[.12em] uppercase text-muted-foreground">{t("forStudents.label")}</p>
        <h1 className="mt-3 text-3xl md:text-5xl font-bold leading-tight" style={{ fontFamily: "'Unbounded', sans-serif" }}>
          {t("forStudents.title")}
        </h1>
        <p className="mt-4 text-[17px] text-muted-foreground leading-relaxed max-w-2xl">{t("forStudents.sub")}</p>

        <div className="mt-8 flex flex-col sm:flex-row sm:items-center gap-3">
          <button
            type="button"
            onClick={() => setQuizOpen(true)}
            className="h-12 px-6 rounded-full font-bold text-white text-[15px] transition-transform active:scale-[.98]"
            style={{ background: "linear-gradient(135deg,#0f0f1a,#1a1f3a)" }}
          >
            {t("forStudents.cta")}
          </button>
          <span className="text-sm text-muted-foreground">{t("forStudents.ctaHint")}</span>
        </div>

        <section className="mt-14" aria-labelledby="fs-how">
          <h2 id="fs-how" className="text-xl md:text-2xl font-bold" style={{ fontFamily: "'Unbounded', sans-serif" }}>
            {t("forStudents.howTitle")}
          </h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-3">
            {steps.map((s) => (
              <li key={s.n} className="rounded-2xl border border-border bg-card p-5">
                <div className="w-9 h-9 rounded-full flex items-center justify-center font-black text-white" style={{ background: "#2BBFAA" }}>{s.n}</div>
                <div className="mt-3 font-bold">{s.title}</div>
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-14 rounded-2xl border border-border bg-card p-6" aria-labelledby="fs-what">
          <h2 id="fs-what" className="text-lg font-bold" style={{ fontFamily: "'Unbounded', sans-serif" }}>{t("forStudents.whatTitle")}</h2>
          <ul className="mt-3 grid gap-2 text-[15px] text-muted-foreground">
            <li>✓ {t("forStudents.w1")}</li>
            <li>✓ {t("forStudents.w2")}</li>
            <li>✓ {t("forStudents.w3")}</li>
          </ul>
          <button
            type="button"
            onClick={() => setQuizOpen(true)}
            className="mt-6 h-12 px-6 rounded-full font-bold text-[15px] border border-border bg-background hover:bg-muted transition-colors"
          >
            {t("forStudents.cta")}
          </button>
        </section>

        <div className="mt-16 pt-8 border-t border-border text-sm text-muted-foreground flex flex-wrap gap-4 justify-between">
          <Link to="/" className="hover:text-foreground">{t("forStudents.forTutors")}</Link>
          <Link to="/privacy" className="hover:text-foreground">{t("legal.privacy")}</Link>
          <a href="mailto:hello@otutorhub.com" className="hover:text-foreground">hello@otutorhub.com</a>
        </div>
      </main>

      <LandingFindTutorQuizDialog open={quizOpen} onOpenChange={setQuizOpen} />
    </div>
  );
}
