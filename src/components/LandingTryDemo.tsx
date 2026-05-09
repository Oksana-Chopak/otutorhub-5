import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LandingFindTutorQuizDialog } from "@/components/LandingFindTutorQuizDialog";
import type { PersonaVars } from "@/pages/LandingPage";
import { cn } from "@/lib/utils";

type Tab = "client" | "session" | "payment";

type Props = {
  personaVars: PersonaVars;
  isAnimating?: boolean;
};

export function LandingTryDemo({ personaVars, isAnimating }: Props) {
  const { t } = useTranslation();
  const tp = (key: string) => t(key, personaVars);

  const [tab, setTab] = useState<Tab>("client");
  const [done, setDone] = useState<Tab | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);

  const [sName, setSName] = useState("");
  const [sSubject, setSSubject] = useState("");
  const [sPrice, setSPrice] = useState("");

  const [lStudent, setLStudent] = useState("");
  const [lDate, setLDate] = useState("");
  const [lTime, setLTime] = useState("");

  const [pStudent, setPStudent] = useState("");
  const [pAmount, setPAmount] = useState("");
  const [pLessons, setPLessons] = useState("");

  const sharedStudent = sName.trim() || lStudent.trim() || pStudent.trim();

  const tabs: { id: Tab; emoji: string; label: string }[] = [
    { id: "client", emoji: "➕", label: tp("landing.tryDemo.tabAddClient") },
    { id: "session", emoji: "📅", label: tp("landing.tryDemo.tabAddSession") },
    { id: "payment", emoji: "💰", label: tp("landing.tryDemo.tabAddPayment") },
  ];

  const switchTab = (id: Tab) => {
    setTab(id);
    setDone(null);
    if (id === "session" && !lStudent.trim() && sharedStudent) setLStudent(sharedStudent);
    if (id === "payment" && !pStudent.trim() && sharedStudent) setPStudent(sharedStudent);
    if (id === "payment" && !pAmount.trim() && sPrice.trim()) {
      const lessonsN = Number(pLessons) || 5;
      const priceN = Number(sPrice);
      if (priceN > 0) setPAmount(String(priceN * lessonsN));
    }
  };

  const persistDemo = () => {
    try {
      const payload = {
        student: sName.trim()
          ? { name: sName.trim(), subject: sSubject.trim() || null, price: sPrice.trim() ? Number(sPrice) : null }
          : null,
        lesson: lStudent.trim() && lDate && lTime
          ? { studentName: lStudent.trim(), date: lDate, time: lTime }
          : null,
        payment: pStudent.trim() && (pAmount || pLessons)
          ? { studentName: pStudent.trim(), amount: pAmount ? Number(pAmount) : null, lessons: pLessons ? Number(pLessons) : null }
          : null,
        savedAt: Date.now(),
      };
      if (payload.student || payload.lesson || payload.payment) {
        localStorage.setItem("tutorhub.demo", JSON.stringify(payload));
      }
    } catch {
      /* ignore */
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    persistDemo();
    setDone(tab);
  };

  const ctaName = sName.trim() || lStudent.trim() || pStudent.trim();
  const ctaText = ctaName
    ? t("landing.tryDemo.saveAndContinueWith", { name: ctaName })
    : t("landing.tryDemo.saveAndContinue");

  const valid =
    (tab === "client" && sName.trim() && sSubject.trim()) ||
    (tab === "session" && lStudent.trim() && lDate && lTime) ||
    (tab === "payment" && pStudent.trim() && (pAmount.trim() || pLessons.trim()));

  const successByTab: Record<Tab, { title: string; sub: string }> = {
    client: { title: tp("landing.tryDemo.successClientTitle"), sub: tp("landing.tryDemo.successClientSub") },
    session: { title: tp("landing.tryDemo.successSessionTitle"), sub: tp("landing.tryDemo.successSessionSub") },
    payment: { title: tp("landing.tryDemo.successPaymentTitle"), sub: tp("landing.tryDemo.successPaymentSub") },
  };

  return (
    <section className="ltd-section">
      <style>{styles}</style>
      <div className="ltd-inner">
        <div className="ltd-label">{t("landing.tryDemo.label")}</div>
        <h2 className={cn("ltd-title", isAnimating && "ltd-fade")}>
          {t("landing.tryDemo.title1")} <span className="ltd-accent">{t("landing.tryDemo.title2")}</span>
        </h2>
        <p className="ltd-sub">{t("landing.tryDemo.sub")}</p>

        <div className="ltd-card">
          <div className={cn("ltd-tabs", isAnimating && "ltd-fade")} role="tablist">
            {tabs.map((tb) => (
              <button
                key={tb.id}
                role="tab"
                aria-selected={tab === tb.id}
                className={`ltd-tab ${tab === tb.id ? "active" : ""}`}
                onClick={() => switchTab(tb.id)}
                type="button"
              >
                <span className="ltd-tab-emoji">{tb.emoji}</span>
                <span>{tb.label}</span>
              </button>
            ))}
          </div>

          <div className={cn("ltd-body", isAnimating && "ltd-fade")}>
            {done === tab ? (
              <div className="ltd-success">
                <div className="ltd-success-title">{successByTab[tab].title}</div>
                <p className="ltd-success-sub">{successByTab[tab].sub}</p>
                <Link to="/auth?signup=1&role=tutor&from_demo=1" className="ltd-btn-primary">
                  {ctaText}
                </Link>
                <button type="button" className="ltd-link" onClick={() => setDone(null)}>
                  {t("landing.tryDemo.retry")}
                </button>
              </div>
            ) : (
              <form onSubmit={submit} className="ltd-form">
                {tab === "client" && (
                  <>
                    <Field
                      label={tp("landing.tryDemo.fieldClientName")}
                      value={sName}
                      onChange={setSName}
                      placeholder={t("landing.tryDemo.fieldClientPlaceholder")}
                    />
                    <Field
                      label={t("landing.tryDemo.fieldSubject")}
                      value={sSubject}
                      onChange={setSSubject}
                      placeholder={t("landing.tryDemo.fieldSubjectPlaceholder")}
                    />
                    <Field
                      label={tp("landing.tryDemo.fieldPrice")}
                      value={sPrice}
                      onChange={setSPrice}
                      placeholder="500"
                      type="number"
                    />
                  </>
                )}
                {tab === "session" && (
                  <>
                    <Field
                      label={tp("landing.tryDemo.fieldClient")}
                      value={lStudent}
                      onChange={setLStudent}
                      placeholder={t("landing.tryDemo.fieldClientPlaceholder")}
                    />
                    <div className="ltd-row">
                      <Field label={t("landing.tryDemo.fieldDate")} value={lDate} onChange={setLDate} type="date" />
                      <Field label={t("landing.tryDemo.fieldTime")} value={lTime} onChange={setLTime} type="time" />
                    </div>
                  </>
                )}
                {tab === "payment" && (
                  <>
                    <Field
                      label={tp("landing.tryDemo.fieldClient")}
                      value={pStudent}
                      onChange={setPStudent}
                      placeholder={t("landing.tryDemo.fieldClientPlaceholder")}
                    />
                    <div className="ltd-row">
                      <Field label={t("landing.tryDemo.fieldAmount")} value={pAmount} onChange={setPAmount} placeholder="2500" type="number" />
                      <Field label={tp("landing.tryDemo.fieldSessionsCount")} value={pLessons} onChange={setPLessons} placeholder="5" type="number" />
                    </div>
                  </>
                )}

                <button type="submit" disabled={!valid} className="ltd-btn-primary ltd-submit">
                  {t("landing.tryDemo.submit")}
                </button>
              </form>
            )}
          </div>
        </div>

        <div className={cn("ltd-aside", isAnimating && "ltd-fade")}>
          <div className="ltd-aside-icon">🎓</div>
          <div className="ltd-aside-text">
            <strong>{tp("landing.tryDemo.asideTitle")}</strong>
            <span>{tp("landing.tryDemo.asideText")}</span>
          </div>
          <button type="button" onClick={() => setQuizOpen(true)} className="ltd-btn-ghost">
            {tp("landing.tryDemo.asideCta")}
          </button>
        </div>
      </div>
      <LandingFindTutorQuizDialog open={quizOpen} onOpenChange={setQuizOpen} />
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="ltd-field">
      <span className="ltd-field-label">{label}</span>
      <input
        className="ltd-input"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

const styles = `
.ltd-section { background: var(--bg2, #eeece6); padding: 72px 2rem; }
.ltd-inner { max-width: 720px; margin: 0 auto; text-align: center; }
.ltd-label { font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #0ABAB5; margin-bottom: 12px; }
.ltd-title { font-family: 'Unbounded', sans-serif; font-size: clamp(24px, 3vw, 36px); font-weight: 800; line-height: 1.15; color: #1a1a2e; margin-bottom: 12px; letter-spacing: -0.02em; transition: opacity 0.3s ease; }
.ltd-accent { color: #0ABAB5; }
.ltd-sub { font-size: 16px; color: #6b6b8a; margin-bottom: 32px; }
.ltd-fade { opacity: 0.55; transition: opacity 0.3s ease; }
.ltd-card { background: #fff; border-radius: 20px; border: 1px solid rgba(26,26,46,0.08); box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 12px 40px rgba(0,0,0,0.08); overflow: hidden; text-align: left; }
.ltd-tabs { display: grid; grid-template-columns: repeat(3, 1fr); background: #f7f6f2; border-bottom: 1px solid rgba(26,26,46,0.06); transition: opacity 0.3s ease; }
.ltd-tab { background: transparent; border: none; cursor: pointer; padding: 16px 8px; font-family: 'Golos Text', sans-serif; font-size: 14px; font-weight: 600; color: #6b6b8a; display: flex; align-items: center; justify-content: center; gap: 8px; transition: background 0.15s, color 0.15s; border-bottom: 2px solid transparent; }
.ltd-tab:hover { color: #1a1a2e; }
.ltd-tab.active { background: #fff; color: #0ABAB5; border-bottom-color: #0ABAB5; }
.ltd-tab-emoji { font-size: 18px; }
.ltd-body { padding: 28px 28px 32px; transition: opacity 0.3s ease; }
.ltd-form { display: flex; flex-direction: column; gap: 16px; }
.ltd-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.ltd-field { display: flex; flex-direction: column; gap: 6px; }
.ltd-field-label { font-size: 13px; font-weight: 600; color: #2d2d4a; }
.ltd-input { font-family: 'Golos Text', sans-serif; font-size: 15px; color: #1a1a2e; padding: 12px 14px; border: 1.5px solid rgba(26,26,46,0.1); border-radius: 10px; background: #fff; outline: none; transition: border-color 0.15s, box-shadow 0.15s; }
.ltd-input:focus { border-color: #0ABAB5; box-shadow: 0 0 0 3px rgba(10,186,181,0.15); }
.ltd-btn-primary { background: #0ABAB5; color: #fff; font-family: 'Golos Text', sans-serif; font-weight: 600; font-size: 16px; padding: 14px 28px; border-radius: 100px; text-decoration: none; border: none; cursor: pointer; transition: background 0.2s, transform 0.15s, box-shadow 0.2s; display: inline-block; text-align: center; box-shadow: 0 4px 16px rgba(10,186,181,0.3); }
.ltd-btn-primary:hover:not(:disabled) { background: #2dd4cf; transform: translateY(-1px); box-shadow: 0 6px 20px rgba(10,186,181,0.4); }
.ltd-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }
.ltd-submit { margin-top: 8px; }
.ltd-success { text-align: center; padding: 12px 0 4px; }
.ltd-success-title { font-family: 'Unbounded', sans-serif; font-size: 22px; font-weight: 800; color: #1a9e75; margin-bottom: 8px; }
.ltd-success-sub { font-size: 15px; color: #6b6b8a; margin-bottom: 24px; }
.ltd-link { display: block; margin: 16px auto 0; background: transparent; border: none; color: #6b6b8a; font-size: 13px; cursor: pointer; text-decoration: underline; font-family: 'Golos Text', sans-serif; }
.ltd-link:hover { color: #1a1a2e; }
.ltd-aside { margin-top: 24px; background: #fff; border: 1px solid rgba(26,26,46,0.08); border-radius: 16px; padding: 18px 20px; display: flex; align-items: center; gap: 16px; text-align: left; transition: opacity 0.3s ease; }
.ltd-aside-icon { font-size: 28px; flex-shrink: 0; }
.ltd-aside-text { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.ltd-aside-text strong { font-size: 14px; color: #1a1a2e; font-weight: 700; }
.ltd-aside-text span { font-size: 13px; color: #6b6b8a; line-height: 1.4; }
.ltd-btn-ghost { background: transparent; color: #0ABAB5; font-family: 'Golos Text', sans-serif; font-weight: 600; font-size: 14px; padding: 10px 18px; border-radius: 100px; text-decoration: none; border: 1.5px solid #0ABAB5; cursor: pointer; transition: all 0.2s; white-space: nowrap; flex-shrink: 0; }
.ltd-btn-ghost:hover { background: #0ABAB5; color: #fff; }

@media (max-width: 600px) {
  .ltd-section { padding: 48px 1rem; }
  .ltd-tab { font-size: 12px; padding: 12px 4px; flex-direction: column; gap: 4px; }
  .ltd-tab-emoji { font-size: 20px; }
  .ltd-body { padding: 22px 18px 24px; }
  .ltd-row { grid-template-columns: 1fr; }
  .ltd-aside { flex-direction: column; align-items: flex-start; gap: 12px; text-align: left; }
  .ltd-btn-ghost { width: 100%; text-align: center; }
}
`;
