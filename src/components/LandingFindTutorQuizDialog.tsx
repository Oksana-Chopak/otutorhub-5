import { useState } from "react";
import confetti from "canvas-confetti";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { SUBJECT_OPTIONS } from "@/lib/subjects";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

const SUBJECT_EMOJI: Record<string, string> = {
  "Математика (німецька програма)": "🧮",
  "Математика (польська програма)": "🧮",
  "Англійська мова": "🇬🇧",
  "Шведська мова": "🇸🇪",
  "Польська мова": "🇵🇱",
  "Німецька мова": "🇩🇪",
};

const LEVELS = [
  { value: "beginner", label: "Починаю з нуля", emoji: "🐣" },
  { value: "intermediate", label: "Є база", emoji: "📚" },
  { value: "advanced", label: "Хочу поглибити", emoji: "🚀" },
];

const SCHEDULE_SLOTS = [
  { value: "weekday_morning", label: "Будні ранок" },
  { value: "weekday_day", label: "Будні день" },
  { value: "weekday_evening", label: "Будні вечір" },
  { value: "weekend_morning", label: "Вихідні ранок" },
  { value: "weekend_day", label: "Вихідні день" },
  { value: "weekend_evening", label: "Вихідні вечір" },
];

const GOALS = [
  { value: "exam", label: "Підготовка до іспиту", emoji: "🎓" },
  { value: "work", label: "Для роботи", emoji: "💼" },
  { value: "self", label: "Для себе", emoji: "🌱" },
  { value: "olympiad", label: "Олімпіада", emoji: "🏆" },
  { value: "other", label: "Інше", emoji: "✏️" },
];

type Step = 1 | 2 | 3 | 4 | 5 | "submitting" | "done";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LandingFindTutorQuizDialog({ open, onOpenChange }: Props) {
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
  };

  const finalSubjects = () => {
    const extra = otherSubjectActive && otherSubject.trim() ? [otherSubject.trim()] : [];
    return [...subjects, ...extra];
  };
  const canProceedSubjects = subjects.length > 0 || (otherSubjectActive && otherSubject.trim().length > 0);

  const handleOpenChange = (v: boolean) => {
    onOpenChange(v);
    if (!v) setTimeout(reset, 300);
  };

  const submit = async () => {
    if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error("Заповніть ім'я та коректний email");
      return;
    }
    setStep("submitting");

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
        emailRedirectTo: `${window.location.origin}/`,
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
        toast.error("Не вдалося надіслати запит. Спробуйте ще раз.");
        setStep(5);
        return;
      }
    }

    // 3) Sign out the freshly-created session so the landing visitor stays anonymous
    //    until they click the email confirmation link.
    if (userId && !alreadyExisted) {
      try { await supabase.auth.signOut(); } catch (_) { /* ignore */ }
    }

    confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
    setStep("done");
  };

  const progress =
    step === 1 ? 20 : step === 2 ? 40 : step === 3 ? 60 : step === 4 ? 80 : step === 5 ? 95 : 100;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Знайти репетитора</DialogTitle>
        </DialogHeader>

        {step !== "done" && step !== "submitting" && (
          <div className="mb-2">
            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>Крок {step} з 5</span>
              <span>Підберемо ідеального репетитора</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}

        {step === 1 && (
          <div className="animate-fade-in space-y-4">
            <h3 className="text-lg font-bold">Що вивчаємо?</h3>
            <p className="text-sm text-muted-foreground">Можна вибрати декілька</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {SUBJECT_OPTIONS.map((s) => {
                const active = subjects.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() =>
                      setSubjects((p) =>
                        p.includes(s) ? p.filter((x) => x !== s) : [...p, s],
                      )
                    }
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-xl border-2 p-3 text-center transition-all hover:scale-105 active:scale-95",
                      active
                        ? "border-primary bg-primary/5 shadow-md"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <span className="text-2xl">{SUBJECT_EMOJI[s] ?? "📖"}</span>
                    <span className="text-xs font-medium leading-tight">{s}</span>
                  </button>
                );
              })}
            </div>
            <Button
              className="w-full"
              disabled={subjects.length === 0}
              onClick={() => setStep(2)}
            >
              Далі <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="animate-fade-in space-y-4">
            <h3 className="text-lg font-bold">Який рівень?</h3>
            <div className="grid gap-3">
              {LEVELS.map((l) => {
                const active = level === l.value;
                return (
                  <button
                    key={l.value}
                    type="button"
                    onClick={() => {
                      setLevel(l.value);
                      setTimeout(() => setStep(3), 200);
                    }}
                    className={cn(
                      "flex items-center gap-4 rounded-xl border-2 p-4 text-left transition-all hover:scale-[1.02] active:scale-[0.98]",
                      active
                        ? "border-primary bg-primary/5 shadow-md"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <span className="text-3xl">{l.emoji}</span>
                    <span className="text-base font-medium">{l.label}</span>
                  </button>
                );
              })}
            </div>
            <Button variant="ghost" className="w-full" onClick={() => setStep(1)}>
              Назад
            </Button>
          </div>
        )}

        {step === 3 && (
          <div className="animate-fade-in space-y-4">
            <h3 className="text-lg font-bold">Коли зручно займатись?</h3>
            <p className="text-sm text-muted-foreground">Можна вибрати декілька</p>
            <div className="grid grid-cols-2 gap-3">
              {SCHEDULE_SLOTS.map((s) => {
                const active = schedule.includes(s.value);
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() =>
                      setSchedule((p) =>
                        p.includes(s.value) ? p.filter((x) => x !== s.value) : [...p, s.value],
                      )
                    }
                    className={cn(
                      "rounded-xl border-2 p-3 text-sm font-medium transition-all hover:scale-105 active:scale-95",
                      active
                        ? "border-primary bg-primary/5 text-foreground shadow-md"
                        : "border-border text-muted-foreground hover:border-primary/40",
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
              onClick={() => setStep(4)}
            >
              Далі <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setStep(2)}>
              Назад
            </Button>
          </div>
        )}

        {step === 4 && (
          <div className="animate-fade-in space-y-4">
            <h3 className="text-lg font-bold">Яка ціль?</h3>
            <div className="grid gap-3">
              {GOALS.map((g) => {
                const active = goal === g.value;
                return (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() => setGoal(g.value)}
                    className={cn(
                      "flex items-center gap-4 rounded-xl border-2 p-3 text-left transition-all hover:scale-[1.02] active:scale-[0.98]",
                      active
                        ? "border-primary bg-primary/5 shadow-md"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <span className="text-2xl">{g.emoji}</span>
                    <span className="text-base font-medium">{g.label}</span>
                  </button>
                );
              })}
            </div>
            {goal === "other" && (
              <Textarea
                placeholder="Розкажи про свою ціль…"
                value={goalOther}
                onChange={(e) => setGoalOther(e.target.value)}
                rows={3}
                className="animate-fade-in"
              />
            )}
            <Button
              className="w-full"
              disabled={!goal || (goal === "other" && goalOther.trim().length === 0)}
              onClick={() => setStep(5)}
            >
              Далі <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setStep(3)}>
              Назад
            </Button>
          </div>
        )}

        {step === 5 && (
          <div className="animate-fade-in space-y-4">
            <h3 className="text-lg font-bold">Як з вами зв'язатись?</h3>
            <p className="text-sm text-muted-foreground">
              Менеджер підбере репетитора протягом 24 годин.
            </p>
            <div className="space-y-2">
              <Label htmlFor="lead-name">Ім'я *</Label>
              <Input
                id="lead-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Як до вас звертатись"
                maxLength={80}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-email">Email *</Label>
              <Input
                id="lead-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                maxLength={200}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-phone">Телефон (опційно)</Label>
              <Input
                id="lead-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+380…"
                maxLength={40}
              />
            </div>
            <Button className="w-full" onClick={submit}>
              Знайти репетитора
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setStep(4)}>
              Назад
            </Button>
          </div>
        )}

        {step === "submitting" && (
          <div className="flex min-h-[260px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {step === "done" && (
          <div className="animate-scale-in space-y-5 py-4 text-center">
            <div className="text-6xl">🎉</div>
            <div className="inline-flex items-center gap-2 rounded-full bg-success/10 px-4 py-2 text-sm font-semibold text-success">
              <Check className="h-4 w-4" /> Готово!
            </div>
            <h3 className="text-xl font-bold">Ми отримали ваш запит</h3>
            <p className="text-muted-foreground">
              Менеджер підбере репетитора протягом 24 годин.<br />
              Перевірте <span className="font-semibold text-foreground">{email.trim().toLowerCase()}</span> — ми надіслали посилання для входу в особистий кабінет.
            </p>
            <Button className="w-full" onClick={() => handleOpenChange(false)}>
              Закрити
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
