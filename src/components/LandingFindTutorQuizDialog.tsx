import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SUBJECT_OPTIONS, subjectEmoji } from "@/lib/subjects";
import { supabase } from "@/integrations/supabase/client";
import { burstConfetti } from "@/lib/confetti";
import { useHaptic } from "@/hooks/useHaptic";
import { mailboxFor } from "@/lib/mailbox";
import { ArrowLeft, ArrowRight, Check, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";

/**
 * Анкета підбору репетитора з /for-students.
 *
 * ПЕРЕЗІБРАНА 15.09 за скаргою власниці: «форми в старому дизайні, шрифти
 * дрібні і сірі». Було: типовий shadcn-діалог по центру, `text-sm` (14px)
 * сірим `text-muted-foreground` на кожному поясненні, кнопки `Button` за
 * замовчуванням — тобто єдина форма продукту, яку бачить НЕзареєстрована
 * людина, виглядала не так, як усі інші форми застосунку.
 *
 * Стало: канон нових форм (QuickAddStudentDialog / RecordPaymentSheet) —
 * нижній лист на мобільному з ручкою, 15px поля (менше 15px iOS ЗУМИТЬ усю
 * форму), 50px кнопки, теплий градієнт бренду, токени теми замість сірого
 * літерала (тож форма жива і в темній темі). Крокоміром став сегментований
 * індикатор: п'ять сегментів видно навіть на сонці, тонка смужка Progress — ні.
 *
 * Два інші пункти тієї ж скарги:
 * · «А кнопку-редірект поставити можна?» — на фінальному кроці тепер кнопка
 *   у ВЛАСНУ скриньку людини (див. lib/mailbox.ts), а не лише текст «перевірте
 *   пошту».
 * · «Після того, як я закрила форму, я знову на сторінці, де мені пропонують
 *   створити запит» — після УСПІШНОЇ відправки закриття кличе `onFinish`,
 *   а сторінка вирішує, куди вести (ForStudentsPage → на головну). Кинута
 *   на півдорозі анкета нікуди не веде: людина хотіла закрити, а не піти.
 *
 * Логіка відправки (auto sign-up → tutor_referral_requests → фолбек на edge
 * під service role → signOut) свідомо не змінена: вона працює і на ній
 * тримаються всі запити, які бачить менеджер.
 */

const LEVELS = [
  { value: "beginner", emoji: "🐣" },
  { value: "intermediate", emoji: "📚" },
  { value: "advanced", emoji: "🚀" },
] as const;

const SCHEDULE_SLOTS = [
  { value: "weekday_morning", group: "weekday", slot: "morning" },
  { value: "weekday_day", group: "weekday", slot: "day" },
  { value: "weekday_evening", group: "weekday", slot: "evening" },
  { value: "weekend_morning", group: "weekend", slot: "morning" },
  { value: "weekend_day", group: "weekend", slot: "day" },
  { value: "weekend_evening", group: "weekend", slot: "evening" },
] as const;

const GOALS = [
  { value: "exam", emoji: "🎓" },
  { value: "work", emoji: "💼" },
  { value: "self", emoji: "🌱" },
  { value: "olympiad", emoji: "🏆" },
  { value: "other", emoji: "✏️" },
] as const;

const TOTAL_STEPS = 5;

type Step = 1 | 2 | 3 | 4 | 5 | "submitting" | "done";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Кличеться при закритті ПІСЛЯ успішної відправки — сторінка вирішує, куди вести. */
  onFinish?: () => void;
}

export function LandingFindTutorQuizDialog({ open, onOpenChange, onFinish }: Props) {
  const { t } = useTranslation();
  const haptic = useHaptic();
  const [step, setStep] = useState<Step>(1);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [level, setLevel] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<string[]>([]);
  const [goal, setGoal] = useState<string | null>(null);
  const [goalOther, setGoalOther] = useState("");
  const [otherSubject, setOtherSubject] = useState("");
  const [otherSubjectActive, setOtherSubjectActive] = useState(false);
  const [wishes, setWishes] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [sentEmail, setSentEmail] = useState("");

  const reset = () => {
    setStep(1);
    setSubjects([]);
    setLevel(null);
    setSchedule([]);
    setGoal(null);
    setGoalOther("");
    setOtherSubject("");
    setOtherSubjectActive(false);
    setWishes("");
    setName("");
    setEmail("");
    setPhone("");
    setSentEmail("");
  };

  const finalSubjects = () => {
    const extra = otherSubjectActive && otherSubject.trim() ? [otherSubject.trim()] : [];
    return [...subjects, ...extra];
  };
  const canProceedSubjects = subjects.length > 0 || (otherSubjectActive && otherSubject.trim().length > 0);

  const handleOpenChange = (v: boolean) => {
    // Успішно надіслали → закриття веде далі (на головну). Кинули анкету →
    // просто закриваємо: людина хотіла прибрати вікно, а не покинути сторінку.
    const wasDone = step === "done";
    onOpenChange(v);
    if (!v) {
      setTimeout(reset, 300);
      if (wasDone) onFinish?.();
    }
  };

  const submit = async () => {
    if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error(t("leadQuiz.contactsInvalid"));
      return;
    }
    setStep("submitting");
    try {
      await submitInner();
    } catch (e) {
      console.error("[find-tutor] unexpected error", e);
      toast.error(t("leadQuiz.sendFailed"));
      setStep(5);
    }
  };

  const submitInner = async () => {
    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();
    const cleanPhone = phone.trim() || null;

    const quiz = {
      subjects: finalSubjects(),
      level,
      schedule,
      goal,
      goal_other: goal === "other" ? goalOther.trim() || null : null,
      wishes: wishes.trim() || null,
    };

    // Save quiz to localStorage so we can populate student_intake_quiz after first sign-in.
    try {
      localStorage.setItem(
        "otutorhub_lead_quiz",
        JSON.stringify({ ...quiz, name: cleanName, email: cleanEmail, phone: cleanPhone, savedAt: new Date().toISOString() }),
      );
    } catch (_) { /* ignore */ }

    // 1) Auto sign-up — creates auth user, profile, student role (via handle_new_user trigger).
    let userId: string | null = null;
    let alreadyExisted = false;
    const randomPassword = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: cleanEmail,
      password: randomPassword,
      options: {
        // 14.09: мова їде в посиланні — лист відкривають з пошти, де localStorage порожній.
        emailRedirectTo: `${window.location.origin}/?lng=${(localStorage.getItem("otutorhub_lang") ?? "uk").slice(0, 2)}`,
        data: {
          first_name: cleanName,
          role: "student",
          phone: cleanPhone ?? undefined,
        },
      },
    });

    if (signUpError) {
      const msg = (signUpError.message || "").toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        alreadyExisted = true;
      } else {
        console.error("[find-tutor] signUp error", signUpError);
        // Fall through — we still try to save the lead via the edge function below.
      }
    } else {
      userId = signUpData.user?.id ?? null;
    }

    // 2) Save the request. Try direct insert first (works only if we have a session).
    //    If that fails (anon / RLS), fall back to the edge function which uses the
    //    service role key and can insert without an authenticated session.
    let saved = false;
    if (userId) {
      const { error: insertErr } = await supabase.from("tutor_referral_requests").insert({
        student_id: userId,
        subject: quiz.subjects[0] ?? null,
        preferred_level: quiz.level,
        message: [
          quiz.subjects.length ? `Предмети: ${quiz.subjects.join(", ")}` : null,
          quiz.level ? `Рівень: ${quiz.level}` : null,
          quiz.schedule.length ? `Зручний час: ${quiz.schedule.join(", ")}` : null,
          quiz.goal ? `Ціль: ${quiz.goal}${quiz.goal === "other" && quiz.goal_other ? ` — ${quiz.goal_other}` : ""}` : null,
          quiz.wishes ? `Побажання: ${quiz.wishes}` : null,
          cleanPhone ? `Телефон: ${cleanPhone}` : null,
        ].filter(Boolean).join("\n") || null,
        source: "landing_quiz",
        lead_name: cleanName,
        lead_email: cleanEmail,
        lead_phone: cleanPhone,
        quiz_data: quiz,
        status: "open",
      });
      if (!insertErr) saved = true;
      else console.warn("[find-tutor] direct insert failed, falling back to edge function", insertErr);
    }

    if (!saved) {
      const { error: fnError } = await supabase.functions.invoke("landing-find-tutor-quiz", {
        body: { name: cleanName, email: cleanEmail, phone: cleanPhone, quiz },
      });
      if (fnError) {
        console.error("[find-tutor] edge function fallback failed", fnError);
        toast.error(t("leadQuiz.sendFailed"));
        setStep(5);
        return;
      }
    }

    // 3) Sign out the freshly-created session so the landing visitor stays anonymous
    //    until they click the email confirmation link.
    if (userId && !alreadyExisted) {
      try { await supabase.auth.signOut(); } catch (_) { /* ignore */ }
    }

    setSentEmail(cleanEmail);
    haptic.success();
    burstConfetti({ count: 24, originY: 40 });
    setStep("done");
  };

  // ── токени теми (той самий набір, що в канонічних формах) ───────────────────
  const F = {
    teal: "var(--teal,#2BBFAA)", tealL: "var(--teal-l,#f0fdf9)",
    border: "var(--ds-border,#eceef3)", bg: "var(--ds-surface2,#fbfbfc)",
    surface: "var(--ds-surface,#fff)", txt: "var(--ds-txt,#0f0f1a)",
    sub: "var(--sub,#62677E)", tealTxt: "var(--teal-text,#1a7a6c)",
    display: "Inter, system-ui, sans-serif",
    body: "'Plus Jakarta Sans', system-ui, sans-serif",
  };

  const inpSt: React.CSSProperties = {
    width: "100%", height: 48, borderRadius: 13, padding: "0 14px",
    fontSize: 15, fontFamily: F.body, color: F.txt, background: F.bg,
    border: `1.5px solid ${F.border}`, outline: "none", boxSizing: "border-box",
  };
  const taSt: React.CSSProperties = {
    ...inpSt, height: "auto", padding: "12px 14px", lineHeight: 1.5, resize: "none",
  };
  const lblSt: React.CSSProperties = {
    fontFamily: F.display, fontSize: 14, fontWeight: 700, color: F.sub, marginBottom: 7, display: "block",
  };
  const focusOn = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = F.teal;
    e.target.style.boxShadow = "0 0 0 3px rgba(43,191,170,.12)";
  };
  const focusOff = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = F.border;
    e.target.style.boxShadow = "none";
  };

  /** Обрана/необрана пігулка вибору — одна форма на всі чотири питання. */
  const optSt = (active: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 12, width: "100%",
    minHeight: 56, padding: "10px 14px", borderRadius: 14, cursor: "pointer",
    textAlign: "left", boxSizing: "border-box",
    background: active ? F.tealL : F.bg,
    border: `2px solid ${active ? F.teal : F.border}`,
    boxShadow: active ? "0 6px 16px -10px rgba(43,191,170,.7)" : "none",
    transition: "background .15s, border-color .15s",
  });
  const optLabelSt = (active: boolean): React.CSSProperties => ({
    fontFamily: F.display, fontSize: 15, fontWeight: active ? 700 : 600,
    color: F.txt, lineHeight: 1.3, flex: 1, minWidth: 0,
  });

  const primaryBtn = (disabled: boolean): React.CSSProperties => ({
    width: "100%", height: 52, borderRadius: 14, border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    background: disabled ? "var(--ds-surface3,#f6f5f1)" : "linear-gradient(135deg,#2BBFAA,#25a896)",
    color: disabled ? F.sub : "#0f0f1a",
    fontFamily: F.display, fontWeight: 700, fontSize: 16,
    boxShadow: disabled ? "none" : "0 8px 20px -8px rgba(43,191,170,.55)",
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
  });
  const ghostBtn: React.CSSProperties = {
    width: "100%", height: 48, borderRadius: 14, cursor: "pointer",
    border: `1px solid ${F.border}`, background: F.surface,
    fontFamily: F.display, fontWeight: 700, fontSize: 15, color: F.sub,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
  };

  const stepNo = typeof step === "number" ? step : TOTAL_STEPS;
  const mailbox = sentEmail ? mailboxFor(sentEmail) : null;

  const Back = ({ to }: { to: Step }) => (
    <button type="button" style={ghostBtn} onClick={() => setStep(to)}>
      <ArrowLeft size={16} /> {t("leadQuiz.back")}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[480px] p-0 gap-0 rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] max-h-[92vh] overflow-y-auto">
        <DialogTitle className="sr-only">{t("leadQuiz.title")}</DialogTitle>

        {/* Ручка нижнього листа */}
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden">
          <div style={{ width: 38, height: 4, borderRadius: 999, background: "rgba(15,15,26,.14)" }} />
        </div>

        {/* Шапка. На фінальному екрані її немає: «Знайти репетитора · кілька
            питань» над «🎉 ми отримали ваш запит» кличе зробити те, що людина
            щойно зробила. Назва діалогу для читалок лишається — вона sr-only. */}
        {step !== "done" && (
        <div style={{ padding: "14px 22px 0" }}>
          <p style={{ fontFamily: F.display, fontWeight: 800, fontSize: 21, color: F.txt, lineHeight: 1.2, letterSpacing: "-0.01em" }}>
            {t("leadQuiz.title")}
          </p>
          <p style={{ fontSize: 15, color: F.sub, marginTop: 4, lineHeight: 1.45, fontFamily: F.body }}>
            {t("leadQuiz.subtitle")}
          </p>

          {step !== "submitting" && (
            <div style={{ marginTop: 14 }}>
              {/* Сегментований крокомір: п'ять окремих смужок видно на сонці,
                  тонка суцільна лінія Progress — ні (ТЗ доступності). */}
              <div style={{ display: "flex", gap: 5 }} role="presentation">
                {Array.from({ length: TOTAL_STEPS }, (_, i) => (
                  <span key={i} style={{
                    flex: 1, height: 6, borderRadius: 999,
                    background: i < stepNo ? F.teal : F.border,
                    transition: "background .25s",
                  }} />
                ))}
              </div>
              <p style={{ marginTop: 8, fontSize: 14, fontWeight: 700, color: F.tealTxt, fontFamily: F.display }}>
                {t("leadQuiz.stepOf", { step: stepNo, total: TOTAL_STEPS })}
              </p>
            </div>
          )}
        </div>
        )}

        <div style={{ padding: "16px 22px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          {step === 1 && (
            <>
              <div>
                <h3 style={{ fontFamily: F.display, fontSize: 19, fontWeight: 800, color: F.txt, lineHeight: 1.25 }}>
                  {t("leadQuiz.q1Title")}
                </h3>
                <p style={{ fontSize: 14, color: F.sub, marginTop: 4, fontFamily: F.body }}>{t("leadQuiz.multiHint")}</p>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 10 }}>
                {SUBJECT_OPTIONS.map((s) => {
                  const active = subjects.includes(s);
                  return (
                    <button key={s} type="button" aria-pressed={active} style={optSt(active)}
                      onClick={() => setSubjects((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]))}>
                      <span style={{ fontSize: 22, lineHeight: 1 }} aria-hidden>{subjectEmoji(s)}</span>
                      <span style={optLabelSt(active)}>{s}</span>
                      {active && <Check size={17} strokeWidth={3} style={{ color: F.tealTxt, flexShrink: 0 }} />}
                    </button>
                  );
                })}
                <button type="button" aria-pressed={otherSubjectActive} style={optSt(otherSubjectActive)}
                  onClick={() => setOtherSubjectActive((v) => !v)}>
                  <span style={{ fontSize: 22, lineHeight: 1 }} aria-hidden>✏️</span>
                  <span style={optLabelSt(otherSubjectActive)}>{t("leadQuiz.otherSubject")}</span>
                  {otherSubjectActive && <Check size={17} strokeWidth={3} style={{ color: F.tealTxt, flexShrink: 0 }} />}
                </button>
              </div>
              {otherSubjectActive && (
                <input aria-label={t("leadQuiz.otherSubjectPlaceholder")} style={inpSt}
                  value={otherSubject} onChange={(e) => setOtherSubject(e.target.value)}
                  placeholder={t("leadQuiz.otherSubjectPlaceholder")} maxLength={80}
                  onFocus={focusOn} onBlur={focusOff} />
              )}
              <button type="button" style={primaryBtn(!canProceedSubjects)} disabled={!canProceedSubjects}
                onClick={() => setStep(2)}>
                {t("leadQuiz.next")} <ArrowRight size={17} />
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <h3 style={{ fontFamily: F.display, fontSize: 19, fontWeight: 800, color: F.txt, lineHeight: 1.25 }}>
                {t("leadQuiz.q2Title")}
              </h3>
              <div style={{ display: "grid", gap: 10 }}>
                {LEVELS.map((l) => {
                  const active = level === l.value;
                  return (
                    <button key={l.value} type="button" aria-pressed={active} style={optSt(active)}
                      onClick={() => { setLevel(l.value); setTimeout(() => setStep(3), 180); }}>
                      <span style={{ fontSize: 26, lineHeight: 1 }} aria-hidden>{l.emoji}</span>
                      <span style={optLabelSt(active)}>{t(`leadQuiz.levels.${l.value}`)}</span>
                      {active && <Check size={17} strokeWidth={3} style={{ color: F.tealTxt, flexShrink: 0 }} />}
                    </button>
                  );
                })}
              </div>
              <Back to={1} />
            </>
          )}

          {step === 3 && (
            <>
              <div>
                <h3 style={{ fontFamily: F.display, fontSize: 19, fontWeight: 800, color: F.txt, lineHeight: 1.25 }}>
                  {t("leadQuiz.q3Title")}
                </h3>
                <p style={{ fontSize: 14, color: F.sub, marginTop: 4, fontFamily: F.body }}>{t("leadQuiz.multiHint")}</p>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {(["weekday", "weekend"] as const).map((group) => (
                  <div key={group} style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                    <div style={{ fontFamily: F.display, fontSize: 13, fontWeight: 700, letterSpacing: ".07em",
                      textTransform: "uppercase", color: F.sub }}>
                      {t(`leadQuiz.groups.${group}`)}
                    </div>
                    {SCHEDULE_SLOTS.filter((s) => s.group === group).map((s) => {
                      const active = schedule.includes(s.value);
                      return (
                        <button key={s.value} type="button" aria-pressed={active}
                          style={{ ...optSt(active), minHeight: 48, justifyContent: "center", gap: 6, padding: "10px 8px" }}
                          onClick={() => setSchedule((p) => (p.includes(s.value) ? p.filter((x) => x !== s.value) : [...p, s.value]))}>
                          <span style={{ ...optLabelSt(active), flex: "0 1 auto", textAlign: "center" }}>
                            {t(`leadQuiz.slots.${s.slot}`)}
                          </span>
                          {active && <Check size={15} strokeWidth={3} style={{ color: F.tealTxt, flexShrink: 0 }} />}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
              <button type="button" style={primaryBtn(schedule.length === 0)} disabled={schedule.length === 0}
                onClick={() => setStep(4)}>
                {t("leadQuiz.next")} <ArrowRight size={17} />
              </button>
              <Back to={2} />
            </>
          )}

          {step === 4 && (
            <>
              <h3 style={{ fontFamily: F.display, fontSize: 19, fontWeight: 800, color: F.txt, lineHeight: 1.25 }}>
                {t("leadQuiz.q4Title")}
              </h3>
              <div style={{ display: "grid", gap: 10 }}>
                {GOALS.map((g) => {
                  const active = goal === g.value;
                  return (
                    <button key={g.value} type="button" aria-pressed={active} style={optSt(active)}
                      onClick={() => setGoal(g.value)}>
                      <span style={{ fontSize: 24, lineHeight: 1 }} aria-hidden>{g.emoji}</span>
                      <span style={optLabelSt(active)}>{t(`leadQuiz.goals.${g.value}`)}</span>
                      {active && <Check size={17} strokeWidth={3} style={{ color: F.tealTxt, flexShrink: 0 }} />}
                    </button>
                  );
                })}
              </div>
              {goal === "other" && (
                <textarea aria-label={t("leadQuiz.goalOtherPlaceholder")} rows={3} style={taSt}
                  placeholder={t("leadQuiz.goalOtherPlaceholder")}
                  value={goalOther} onChange={(e) => setGoalOther(e.target.value)}
                  onFocus={focusOn} onBlur={focusOff} />
              )}
              <button type="button" disabled={!goal || (goal === "other" && goalOther.trim().length === 0)}
                style={primaryBtn(!goal || (goal === "other" && goalOther.trim().length === 0))}
                onClick={() => setStep(5)}>
                {t("leadQuiz.next")} <ArrowRight size={17} />
              </button>
              <Back to={3} />
            </>
          )}

          {step === 5 && (
            <>
              <div>
                <h3 style={{ fontFamily: F.display, fontSize: 19, fontWeight: 800, color: F.txt, lineHeight: 1.25 }}>
                  {t("leadQuiz.q5Title")}
                </h3>
                <p style={{ fontSize: 15, color: F.sub, marginTop: 4, lineHeight: 1.45, fontFamily: F.body }}>
                  {t("leadQuiz.q5Sub")}
                </p>
              </div>
              <div>
                <label htmlFor="lead-name" style={lblSt}>
                  {t("leadQuiz.nameLabel")} <span style={{ color: F.tealTxt }}>*</span>
                </label>
                <input id="lead-name" style={inpSt} value={name} maxLength={80}
                  placeholder={t("leadQuiz.namePlaceholder")}
                  onChange={(e) => setName(e.target.value)} onFocus={focusOn} onBlur={focusOff} />
              </div>
              <div>
                <label htmlFor="lead-email" style={lblSt}>
                  {t("leadQuiz.emailLabel")} <span style={{ color: F.tealTxt }}>*</span>
                </label>
                <input id="lead-email" type="email" inputMode="email" autoComplete="email"
                  style={inpSt} value={email} maxLength={200} placeholder="you@example.com"
                  onChange={(e) => setEmail(e.target.value)} onFocus={focusOn} onBlur={focusOff} />
              </div>
              <div>
                <label htmlFor="lead-phone" style={lblSt}>{t("leadQuiz.phoneLabel")}</label>
                <input id="lead-phone" type="tel" inputMode="tel" autoComplete="tel"
                  style={inpSt} value={phone} maxLength={40} placeholder="+380…"
                  onChange={(e) => setPhone(e.target.value)} onFocus={focusOn} onBlur={focusOff} />
              </div>
              <div>
                <label htmlFor="lead-wishes" style={lblSt}>{t("leadQuiz.wishesLabel")}</label>
                <textarea id="lead-wishes" rows={3} style={taSt} value={wishes} maxLength={1000}
                  placeholder={t("leadQuiz.wishesPlaceholder")}
                  onChange={(e) => setWishes(e.target.value)} onFocus={focusOn} onBlur={focusOff} />
              </div>
              <button type="button" style={primaryBtn(false)} onClick={submit}>
                {t("leadQuiz.submit")}
              </button>
              <Back to={4} />
            </>
          )}

          {step === "submitting" && (
            <div style={{ minHeight: 260, display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", gap: 14, textAlign: "center" }}>
              <Loader2 size={34} className="animate-spin" style={{ color: F.teal }} />
              <div>
                <p style={{ fontFamily: F.display, fontSize: 17, fontWeight: 800, color: F.txt }}>
                  {t("leadQuiz.sending")}
                </p>
                <p style={{ fontSize: 15, color: F.sub, marginTop: 6, lineHeight: 1.45, fontFamily: F.body }}>
                  {t("leadQuiz.sendingDesc")}
                </p>
              </div>
            </div>
          )}

          {step === "done" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14, textAlign: "center", paddingTop: 4 }}>
              <div style={{ fontSize: 54, lineHeight: 1 }} aria-hidden>🎉</div>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999,
                  padding: "7px 16px", background: F.tealL, color: F.tealTxt,
                  fontFamily: F.display, fontWeight: 700, fontSize: 14 }}>
                  <Check size={15} strokeWidth={3} /> {t("leadQuiz.doneChip")}
                </span>
              </div>
              <h3 style={{ fontFamily: F.display, fontSize: 21, fontWeight: 800, color: F.txt, lineHeight: 1.25 }}>
                {t("leadQuiz.doneTitle")}
              </h3>
              <p style={{ fontSize: 15, color: F.sub, lineHeight: 1.5, fontFamily: F.body }}>
                {t("leadQuiz.doneManager")}
              </p>
              <p style={{ fontSize: 15, color: F.sub, lineHeight: 1.5, fontFamily: F.body }}>
                {t("leadQuiz.doneMail")}{" "}
                <span style={{ fontWeight: 700, color: F.txt, wordBreak: "break-all" }}>{sentEmail}</span>
              </p>
              {/* Кнопка-редірект: тільки коли ми ЗНАЄМО скриньку цієї людини.
                  Незнайомий провайдер лишається без кнопки — див. lib/mailbox.ts. */}
              {mailbox && (
                <a href={mailbox.url} target="_blank" rel="noopener noreferrer"
                  style={{ ...primaryBtn(false), textDecoration: "none" }}>
                  <Mail size={18} /> {t("leadQuiz.openMailbox", { provider: mailbox.label })}
                </a>
              )}
              <button type="button" style={mailbox ? ghostBtn : primaryBtn(false)}
                onClick={() => handleOpenChange(false)}>
                {t("leadQuiz.toLanding")}
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
