import { useState } from "react";
import confetti from "canvas-confetti";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { TelegramLinkCard } from "@/components/TelegramLinkCard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { SUBJECT_OPTIONS } from "@/lib/subjects";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Loader2, Check, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";

const SUBJECT_EMOJI: Record<string, string> = {
  "Математика": "🧮",
  "Англійська мова": "🇬🇧",
  "Шведська мова": "🇸🇪",
  "Польська мова": "🇵🇱",
  "Німецька мова": "🇩🇪",
};

interface Props {
  onComplete: () => void;
}

type Step = 1 | 2 | 3 | 4 | "submitting" | "success" | "telegram" | "done";

export function StudentOnboarding({ onComplete }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [step, setStep] = useState<Step>(1);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [customSubject, setCustomSubject] = useState("");
  const [customSubjects, setCustomSubjects] = useState<string[]>([]);
  const [level, setLevel] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<string[]>([]);
  const [goal, setGoal] = useState<string | null>(null);
  const [goalOther, setGoalOther] = useState("");
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const LEVELS = [
    { value: "beginner", label: t("studentOnboarding.levelZero"), emoji: "🐣" },
    { value: "intermediate", label: t("studentOnboarding.levelBase"), emoji: "📚" },
    { value: "advanced", label: t("studentOnboarding.levelDeepen"), emoji: "🚀" },
  ];

  const SCHEDULE_SLOTS = [
    { value: "weekday_morning", label: t("studentOnboarding.slotWeekMorning") },
    { value: "weekday_day", label: t("studentOnboarding.slotWeekDay") },
    { value: "weekday_evening", label: t("studentOnboarding.slotWeekEvening") },
    { value: "weekend_morning", label: t("studentOnboarding.slotWeekendMorning") },
    { value: "weekend_day", label: t("studentOnboarding.slotWeekendDay") },
    { value: "weekend_evening", label: t("studentOnboarding.slotWeekendEvening") },
  ];

  const GOALS = [
    { value: "exam", label: t("studentOnboarding.goalExam"), emoji: "🎓" },
    { value: "work", label: t("studentOnboarding.goalWork"), emoji: "💼" },
    { value: "self", label: t("studentOnboarding.goalSelf"), emoji: "🌱" },
    { value: "olympiad", label: t("studentOnboarding.goalOlympiad"), emoji: "🏆" },
    { value: "other", label: t("studentOnboarding.goalOther"), emoji: "✏️" },
  ];

  const ENCOURAGEMENTS = [
    t("studentOnboarding.enc1"),
    t("studentOnboarding.enc2"),
    t("studentOnboarding.enc3"),
    t("studentOnboarding.enc4"),
  ];

  const fireConfetti = () => {
    confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
    setTimeout(() => confetti({ particleCount: 80, spread: 100, origin: { y: 0.5 } }), 250);
  };

  const submit = async () => {
    if (!user) return;
    setStep("submitting");
    setSaveErr(null);
    const { error } = await supabase.from("student_intake_quiz").insert({
      student_id: user.id,
      subjects,
      level,
      schedule,
      goal,
      goal_other: goal === "other" ? goalOther.trim() || null : null,
    });
    if (error) {
      // Конкретна, помітна помилка замість мікро-тосту в кутку.
      const human = /duplicate|unique/i.test(error.message)
        ? t("studentOnboarding.errorDuplicate")
        : /row-level security|permission/i.test(error.message)
        ? t("studentOnboarding.errorNoAccess")
        : /network|fetch|timeout/i.test(error.message)
        ? t("studentOnboarding.errorConnection")
        : t("studentOnboarding.errorGeneric", { message: error.message });
      setSaveErr(human);
      setStep(4);
      return;
    }
    fireConfetti();
    setStep("success");
  };

  const goToStep = (n: 1 | 2 | 3 | 4) => {
    if (n <= 4) toast(ENCOURAGEMENTS[n - 1] ?? "");
    setStep(n);
  };

  const progress =
    step === 1 ? 25 : step === 2 ? 50 : step === 3 ? 75 : step === 4 ? 90 : 100;

  // ---------- Telegram step ----------
  if (step === "telegram") {
    return (
      <div className="mx-auto max-w-md animate-fade-in space-y-4">
        <div className="text-center">
          <div className="text-4xl">📱</div>
          <h2 className="mt-3 text-xl font-bold text-foreground">{t("studentOnboarding.connectTelegram")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("studentOnboarding.telegramHint")}
          </p>
        </div>
        <TelegramLinkCard />
        <Button className="w-full" onClick={() => setStep("done")}>
          {t("studentOnboarding.next")} <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
        <button
          onClick={() => setStep("done")}
          className="block w-full text-center text-[13px] text-muted-foreground hover:text-foreground"
        >
          {t("studentOnboarding.skip")}
        </button>
      </div>
    );
  }

  // ---------- Done step ----------
  if (step === "done") {
    return (
      <div className="mx-auto max-w-md animate-scale-in space-y-6 text-center">
        <div className="text-6xl">🚀</div>
        <h2 className="text-2xl font-bold text-foreground">{t("studentOnboarding.doneTitle")}</h2>
        <p className="text-muted-foreground">
          {t("studentOnboarding.doneDesc")}
        </p>
        <Button size="lg" className="w-full" onClick={onComplete}>
          {t("studentOnboarding.goToDashboard")}
        </Button>
      </div>
    );
  }

  // ---------- Success step ----------
  if (step === "success") {
    return (
      <div className="mx-auto max-w-md animate-scale-in space-y-6 text-center">
        <div className="text-6xl">🎉</div>
        <div className="inline-flex items-center gap-2 rounded-full bg-success/10 px-4 py-2 text-sm font-semibold text-success">
          <Check className="h-4 w-4" /> {t("studentOnboarding.profileFilled")}
        </div>
        <h2 className="text-2xl font-bold text-foreground">{t("studentOnboarding.thankYou")}</h2>
        <p className="text-muted-foreground">
          {t("studentOnboarding.thankYouDesc")}
        </p>
        <Button size="lg" className="w-full" onClick={() => setStep("telegram")}>
          {t("studentOnboarding.next")} <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    );
  }

  if (step === "submitting") {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ---------- Quiz steps ----------
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <div className="mb-2 flex items-center justify-between text-[13px] text-muted-foreground">
          <span>{t("studentOnboarding.stepOf", { step })}</span>
          <span>{t("studentOnboarding.findTutor")}</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      {step === 1 && (
        <div className="animate-fade-in space-y-4">
          <h2 className="text-xl font-bold text-foreground">{t("studentOnboarding.whatSubject")}</h2>
          <p className="text-sm text-muted-foreground">{t("studentOnboarding.selectMultiple")}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[...SUBJECT_OPTIONS, ...customSubjects].map((s) => {
              const active = subjects.includes(s);
              const isCustom = customSubjects.includes(s);
              return (
                <button
                  key={s}
                  onClick={() =>
                    setSubjects((prev) =>
                      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
                    )
                  }
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition-all hover:scale-105 active:scale-95",
                    active
                      ? "border-primary bg-primary/5 shadow-md"
                      : "border-border hover:border-primary/40"
                  )}
                >
                  <span className="text-3xl">{isCustom ? "✏️" : (SUBJECT_EMOJI[s] ?? "📖")}</span>
                  <span className="text-[13px] font-medium leading-tight">{s}</span>
                </button>
              );
            })}
          </div>

          {/* Додати свій предмет */}
          <div className="flex gap-2">
            <input
              value={customSubject}
              onChange={(e) => setCustomSubject(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const v = customSubject.trim();
                  if (v.length >= 2 && ![...SUBJECT_OPTIONS, ...customSubjects].some((x) => x.toLowerCase() === v.toLowerCase())) {
                    setCustomSubjects((p) => [...p, v]);
                    setSubjects((p) => [...p, v]);
                    setCustomSubject("");
                  }
                }
              }}
              placeholder={t("studentOnboarding.addOwnSubject")}
              maxLength={40}
              className="flex-1 rounded-xl border-2 border-border px-4 py-2.5 text-[14px] outline-none focus:border-primary/50"
              style={{ fontFamily: "'Plus Jakarta Sans', system-ui" }}
            />
            <button
              type="button"
              onClick={() => {
                const v = customSubject.trim();
                if (v.length >= 2 && ![...SUBJECT_OPTIONS, ...customSubjects].some((x) => x.toLowerCase() === v.toLowerCase())) {
                  setCustomSubjects((p) => [...p, v]);
                  setSubjects((p) => [...p, v]);
                  setCustomSubject("");
                }
              }}
              disabled={customSubject.trim().length < 2}
              className="rounded-xl px-4 text-white font-bold text-[14px] disabled:opacity-40"
              style={{ background: "linear-gradient(135deg,#2BBFAA,#25a896)", fontFamily: "Inter, system-ui" }}
            >
              +
            </button>
          </div>
          <Button
            className="w-full"
            disabled={subjects.length === 0}
            onClick={() => goToStep(2)}
          >
            {t("studentOnboarding.next")} <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="animate-fade-in space-y-4">
          <h2 className="text-xl font-bold text-foreground">{t("studentOnboarding.whatLevel")}</h2>
          <div className="grid gap-3">
            {LEVELS.map((l) => {
              const active = level === l.value;
              return (
                <button
                  key={l.value}
                  onClick={() => {
                    setLevel(l.value);
                    setTimeout(() => goToStep(3), 250);
                  }}
                  className={cn(
                    "flex items-center gap-4 rounded-xl border-2 p-4 text-left transition-all hover:scale-[1.02] active:scale-[0.98]",
                    active
                      ? "border-primary bg-primary/5 shadow-md"
                      : "border-border hover:border-primary/40"
                  )}
                >
                  <span className="text-3xl">{l.emoji}</span>
                  <span className="text-base font-medium">{l.label}</span>
                </button>
              );
            })}
          </div>
          <Button variant="ghost" className="w-full" onClick={() => goToStep(1)}>
            {t("studentOnboarding.back")}
          </Button>
        </div>
      )}

      {step === 3 && (
        <div className="animate-fade-in space-y-4">
          <h2 className="text-xl font-bold text-foreground">{t("studentOnboarding.whenConvenient")}</h2>
          <p className="text-sm text-muted-foreground">{t("studentOnboarding.selectMultiple")}</p>
          <div className="grid grid-cols-2 gap-3">
            {SCHEDULE_SLOTS.map((s) => {
              const active = schedule.includes(s.value);
              return (
                <button
                  key={s.value}
                  onClick={() =>
                    setSchedule((prev) =>
                      prev.includes(s.value)
                        ? prev.filter((x) => x !== s.value)
                        : [...prev, s.value]
                    )
                  }
                  className={cn(
                    "rounded-xl border-2 p-4 text-sm font-medium transition-all hover:scale-105 active:scale-95",
                    active
                      ? "border-primary bg-primary/5 shadow-md text-foreground"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  )}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          <Button
            className="w-full"
            disabled={schedule.length === 0}
            onClick={() => goToStep(4)}
          >
            {t("studentOnboarding.next")} <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => goToStep(2)}>
            {t("studentOnboarding.back")}
          </Button>
        </div>
      )}

      {step === 4 && (
        <div className="animate-fade-in space-y-4">
          <h2 className="text-xl font-bold text-foreground">{t("studentOnboarding.whatGoal")}</h2>
          <div className="grid gap-3">
            {GOALS.map((g) => {
              const active = goal === g.value;
              return (
                <button
                  key={g.value}
                  onClick={() => setGoal(g.value)}
                  className={cn(
                    "flex items-center gap-4 rounded-xl border-2 p-4 text-left transition-all hover:scale-[1.02] active:scale-[0.98]",
                    active
                      ? "border-primary bg-primary/5 shadow-md"
                      : "border-border hover:border-primary/40"
                  )}
                >
                  <span className="text-3xl">{g.emoji}</span>
                  <span className="text-base font-medium">{g.label}</span>
                </button>
              );
            })}
          </div>
          {goal === "other" && (
            <div className="animate-fade-in">
              <Textarea
                placeholder={t("studentOnboarding.goalPlaceholder")}
                value={goalOther}
                onChange={(e) => { setGoalOther(e.target.value); if (saveErr) setSaveErr(null); }}
                rows={3}
                maxLength={300}
              />
              <p className="mt-1 text-right text-[13px]" style={{ color: "#6b7088" }}>{goalOther.trim().length}/300</p>
            </div>
          )}

          {/* Помітне попередження про помилку збереження */}
          {saveErr && (
            <div className="flex items-start gap-3 rounded-[14px] p-3.5 animate-fade-in" style={{ background: "rgba(224,85,47,.08)", border: "1.5px solid rgba(224,85,47,.35)" }}>
              <span style={{ fontSize: 20, lineHeight: 1 }}>⚠️</span>
              <div>
                <p className="text-[14px] font-bold" style={{ color: "#b3441f", fontFamily: "Inter, system-ui" }}>{t("studentOnboarding.saveFailedTitle")}</p>
                <p className="text-[13px] mt-0.5" style={{ color: "#9a4a35", lineHeight: 1.5 }}>{saveErr}</p>
              </div>
            </div>
          )}

          <Button
            className="w-full"
            disabled={!goal || (goal === "other" && goalOther.trim().length === 0)}
            onClick={submit}
          >
            {t("studentOnboarding.finish")}
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => goToStep(3)}>
            {t("studentOnboarding.back")}
          </Button>
        </div>
      )}
    </div>
  );
}
