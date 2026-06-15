import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import { isNativeApp } from "@/lib/platform";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, GraduationCap, BookOpenCheck, Mail, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { cn } from "@/lib/utils";
import i18n from "@/i18n";

const t = i18n.t.bind(i18n);

const REMEMBER_KEY = "tutorhub.rememberMe";

const signUpSchema = z.object({
  firstName: z.string().trim().min(1, t("authExtra.nameRequired")).max(50),
  lastName: z.string().trim().min(1, t("authExtra.lastNameRequired")).max(50),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  email: z.string().trim().email(t("authExtra.invalidEmail")).max(255),
  password: z.string().min(8, t("authExtra.minPassword")).max(128),
  role: z.enum(["student", "tutor"]),
});

const signInSchema = z.object({
  email: z.string().trim().email(t("authExtra.invalidEmail")).max(255),
  password: z.string().min(1, t("authExtra.passwordRequired")).max(128),
}).required();

type SignUpRole = "student" | "tutor";

// ── Isolated confirmed sign-in component — own state, no shared signInData ───
function ConfirmedSignIn({
  email,
  onSuccess,
  onResend,
}: {
  email: string;
  onSuccess: () => void;
  onResend: () => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (authError) {
      if (authError.message === "Email not confirmed") {
        setError(t("auth.emailNotConfirmed"));
      } else if (authError.message === "Invalid login credentials") {
        setError(t("auth.invalidCreds"));
      } else {
        setError(authError.message);
      }
      return;
    }
    onSuccess();
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8" style={{ background: "#F5F4F0" }}>
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-2 justify-center">
          <img src="/logo.png" alt="oTutorHub" className="h-11 w-11" />
          <span style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 26, letterSpacing: "-.02em", color: "#0f0f1a" }}>oTutorHub</span>
        </div>
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-8 shadow-sm">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-2xl">✅</div>
            <h2 className="font-display text-lg font-bold text-foreground">
              {t("authExtra.emailConfirmed")}
            </h2>
            {email && <span className="text-sm font-medium text-foreground">{email}</span>}
            <p className="text-sm text-muted-foreground">
              {t("authExtra.emailConfirmedDesc")}
            </p>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirmed-pw">{t("auth.password")}</Label>
              <Input
                id="confirmed-pw"
                type="password"
                autoFocus
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
                {error.includes("не підтверджено") || error.includes("not confirmed") ? (
                  <button
                    type="button"
                    className="ml-2 underline font-medium"
                    onClick={onResend}
                  >
                    {t("authExtra.resendEmail")}
                  </button>
                ) : null}
              </div>
            )}
            <Button type="submit" className="w-full h-12 rounded-[14px] text-[15.5px] font-bold shadow-[0_8px_20px_-8px_rgba(43,191,170,.6)]" disabled={loading || !password}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("auth.login")}
            </Button>
          </form>
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => window.location.href = "/auth"}
          >
            {t("authExtra.backToSignup")}
          </button>
        </div>
      </div>
    </div>
  );
}


export default function AuthPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [showExtra, setShowExtra] = useState(false);
  const [remember, setRemember] = useState<boolean>(() => {
    const stored = localStorage.getItem(REMEMBER_KEY);
    return stored === null ? true : stored === "true";
  });

  // Invite-link / preselected tab support: ?signup=1&email=...&role=student|tutor
  const isConfirmed = searchParams.get("confirmed") === "1";
  const initialTab = searchParams.get("signup") === "1" ? "signup" : "signin";
  const [activeTab, setActiveTab] = useState<string>(isConfirmed ? "signin" : initialTab);
  const [pendingHint, setPendingHint] = useState<string | null>(null);
  const [showOptional, setShowOptional] = useState(false);
  const [confirmedNotice, setConfirmedNotice] = useState<boolean>(isConfirmed);
  const [emailSent, setEmailSent] = useState(false);
  const [sentEmail, setSentEmail] = useState("");

  const [signInData, setSignInData] = useState({
    email: searchParams.get("email") ?? "",
    password: "",
  });
  const [signUpData, setSignUpData] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: searchParams.get("email") ?? "",
    password: "",
    role: ((): SignUpRole => {
      const r = searchParams.get("role");
      return r === "student" ? "student" : "tutor";
    })(),
  });

  useEffect(() => {
    if (!authLoading && user) navigate("/", { replace: true });
  }, [user, authLoading, navigate]);

  useEffect(() => {
    localStorage.setItem(REMEMBER_KEY, String(remember));
  }, [remember]);

  // Обробка токенів із лінка підтвердження email.
  // Supabase-конфіг тут без detectSessionInUrl, тож токени з лінка не парсяться
  // автоматично — ловимо їх руками. Лінк може прийти у двох форматах:
  //   • PKCE:     ?code=...                (новий, обмінюємо exchangeCodeForSession)
  //   • implicit: #access_token=...&refresh_token=...  (старий, ставимо setSession)
  // Без цього виникав баг «email підтверджено, але вхід каже not confirmed».
  useEffect(() => {
    const hash = window.location.hash.startsWith("#")
      ? new URLSearchParams(window.location.hash.slice(1))
      : null;
    const code = searchParams.get("code");
    const accessToken = hash?.get("access_token");
    const refreshToken = hash?.get("refresh_token");

    if (!code && !accessToken) return;

    (async () => {
      try {
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
        }
        // Сесія створена — прибираємо токени з URL і йдемо в застосунок.
        window.history.replaceState({}, "", window.location.pathname);
        navigate("/", { replace: true });
      } catch (err) {
        console.error("[AuthPage] confirmation-link token exchange failed:", err);
        // Не вдалося — лишаємо користувача на формі входу з підказкою.
        toast({
          title: t("authExtra.emailConfirmed"),
          description: t("authExtra.emailConfirmedDesc"),
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If we arrived via invite link, immediately check whether the email
  // matches an existing ghost profile so the hint is visible upfront.
  useEffect(() => {
    const emailFromUrl = searchParams.get("email");
    if (searchParams.get("signup") === "1" && emailFromUrl) {
      (async () => {
        try {
          const { data } = await supabase.rpc("is_pending_email", { _email: emailFromUrl });
          if (data === true) setPendingHint(emailFromUrl);
        } catch (err) {
          console.error("[AuthPage] is_pending_email network error:", err);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Email confirmed redirect handling: ?confirmed=1
  useEffect(() => {
    if (!isConfirmed) return;
    if (authLoading) return;
    if (user) {
      // Active session — go to root, role-based routing happens there
      navigate("/", { replace: true });
      return;
    }
    // Лінк підтвердження міг принести токени в URL-хеші, які Supabase парсить
    // асинхронно. Дочекаймося сесії перш ніж просити пароль — інакше виникає
    // розсинхрон «email підтверджено, але вхід каже not confirmed».
    let cancelled = false;
    (async () => {
      // Дати Supabase обробити хеш (#access_token=...) із лінка підтвердження.
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session?.user) {
        navigate("/", { replace: true });
        return;
      }
      // Сесії немає — підтвердження пройшло, але входу нема: автозаповнюємо email.
      const emailFromConfirm = searchParams.get("email");
      if (emailFromConfirm) {
        setSignInData((prev) => ({ ...prev, email: emailFromConfirm }));
      }
      toast({
        title: t("authExtra.emailConfirmed"),
        description: t("authExtra.emailConfirmedDesc"),
      });
      setTimeout(() => {
        document.getElementById("signin-password")?.focus();
      }, 300);
    })();
    return () => { cancelled = true; };
  }, [isConfirmed, authLoading, user, navigate, searchParams]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = signInSchema.safeParse(signInData);
    if (!parsed.success) {
      toast({ title: t("auth.errorTitle"), description: parsed.error.errors[0].message, variant: "destructive" });
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    setLoading(false);
    if (error) {
      console.error("Sign-in failed", error);

      // Special-case: an "Invalid credentials" error might actually mean
      // the user was added by a tutor/manager but never registered.
      // Check via public RPC and guide them to sign up instead.
      if (error.message === "Invalid login credentials") {
        const { data: isPending } = await supabase.rpc("is_pending_email", {
          _email: parsed.data.email,
        });
        if (isPending === true) {
          setPendingHint(parsed.data.email);
          setSignUpData((prev) => ({ ...prev, email: parsed.data.email }));
          setActiveTab("signup");
          toast({
            title: t("auth.pendingToastTitle"),
            description: t("auth.pendingToastDesc"),
          });
          return;
        }
      }

      toast({
        title: t("auth.loginFailed"),
        description: error.message === "Invalid login credentials"
          ? t("auth.invalidCreds")
          : error.message === "Email not confirmed"
          ? t("auth.emailNotConfirmed")
          : t("auth.loginRetry"),
        variant: "destructive",
      });
      // Якщо email не підтверджено — для запрошених (pending) учнів одразу
      // підтверджуємо на сервері та ретраїмо логін; для звичайних — резендимо лист.
      if (error.message === "Email not confirmed") {
        try {
          const { data: isPending } = await supabase.rpc("is_pending_email", {
            _email: parsed.data.email,
          });
          if (isPending === true) {
            await supabase.functions.invoke("confirm-pending-signup", {
              body: { email: parsed.data.email },
            });
            const retry = await supabase.auth.signInWithPassword({
              email: parsed.data.email,
              password: parsed.data.password,
            });
            if (!retry.error) {
              navigate("/", { replace: true });
              return;
            }
          }
          await supabase.auth.resend({ type: "signup", email: parsed.data.email });
          toast({
            title: t("authExtra.confirmResent"),
            description: t("authExtra.confirmResentDesc", { email: parsed.data.email }),
          });
        } catch { /* ignore resend errors */ }
      }
      return;
    }
    navigate("/", { replace: true });
  };

  const handleForgotPassword = async () => {
    const emailParse = z.string().trim().email().safeParse(signInData.email);
    if (!emailParse.success) {
      toast({
        title: t("auth.enterEmailFirst"),
        description: t("auth.enterEmailFirstDesc"),
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(emailParse.data, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      toast({ title: t("auth.resetFailedTitle"), description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: t("auth.checkInbox"),
      description: t("auth.resetSentTo") + emailParse.data,
    });
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setLoading(false);
      toast({
        title: t("auth.googleFailed"),
        description: result.error.message ?? t("auth.tryAgain"),
        variant: "destructive",
      });
      return;
    }
    if (result.redirected) return;
    setLoading(false);
    navigate("/", { replace: true });
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = signUpSchema.safeParse(signUpData);
    if (!parsed.success) {
      toast({ title: t("common.error"), description: parsed.error.errors[0].message, variant: "destructive" });
      return;
    }
    setLoading(true);

    // Check if this email matches a pending ghost profile (invited by tutor/manager).
    // If yes — skip email confirmation entirely: auto-confirm on the server and
    // sign the user in immediately with the password they just typed. This
    // avoids the common breakage where repeated sign-up attempts invalidate the
    // previous confirmation link.
    let isPending = false;
    try {
      const { data } = await supabase.rpc("is_pending_email", { _email: parsed.data.email });
      isPending = data === true;
    } catch { /* ignore — fall back to normal flow */ }

    const { data: signUpResult, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth?confirmed=1&email=${encodeURIComponent(parsed.data.email)}`,
        data: {
          first_name: parsed.data.firstName,
          last_name: parsed.data.lastName,
          phone: parsed.data.phone || null,
          role: parsed.data.role,
          independent_workspace: parsed.data.role === "tutor",
        },
      },
    });

    if (!error && signUpResult?.user && signUpResult.user.identities?.length === 0) {
      setLoading(false);
      toast({
        title: t("authExtra.emailAlreadyUsed"),
        description: t("authExtra.emailAlreadyUsedDesc"),
        variant: "destructive",
      });
      setSignInData((prev) => ({ ...prev, email: parsed.data.email }));
      setActiveTab("signin");
      return;
    }
    if (error) {
      setLoading(false);
      console.error("Sign-up failed", error);
      toast({
        title: t("authExtra.signupFailed"),
        description: error.message === "User already registered"
          ? t("authExtra.userExists")
          : t("authExtra.signupRetry"),
        variant: "destructive",
      });
      return;
    }

    // Pending invite fast path: confirm email server-side, then sign in directly.
    if (isPending) {
      try {
        await supabase.functions.invoke("confirm-pending-signup", {
          body: { email: parsed.data.email },
        });
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: parsed.data.email,
          password: parsed.data.password,
        });
        setLoading(false);
        if (!signInErr) {
          navigate("/", { replace: true });
          return;
        }
        // Fallthrough to email-sent screen if direct sign-in failed.
        console.warn("[AuthPage] pending auto sign-in failed:", signInErr);
      } catch (err) {
        console.warn("[AuthPage] confirm-pending-signup failed:", err);
      }
    }

    setLoading(false);
    setSentEmail(parsed.data.email);
    setEmailSent(true);
  };

  const resendConfirmation = async () => {
    if (!sentEmail) return;
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: sentEmail,
      options: {
        emailRedirectTo: `${window.location.origin}/auth?confirmed=1&email=${encodeURIComponent(sentEmail)}`,
      },
    });
    if (!error) {
      toast({ title: t("authExtra.emailResent") });
    }
  };

  // ── Email sent screen ───────────────────────────────────────────────────────
  if (emailSent) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-8" style={{ background: "#F5F4F0" }}>
        <div className="w-full max-w-md text-center">
          <div className="mb-6 flex items-center gap-2 justify-center">
            <img src="/logo.png" alt="oTutorHub" className="h-10 w-10" />
            <span className="font-display text-2xl font-bold text-foreground">oTutorHub</span>
          </div>
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card p-8 shadow-sm">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-3xl">
              ✉️
            </div>
            <div>
              <h2 className="font-display text-xl font-bold text-foreground">
                {t("authExtra.checkEmail")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("authExtra.sentTo")}{" "}
                <span className="font-medium text-foreground">{sentEmail}</span>
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("authExtra.clickLinkToContinue")}
              </p>
            </div>
            <div className="mt-2 flex flex-col gap-2 w-full">
              <Button variant="outline" size="sm" className="w-full" onClick={resendConfirmation}>
                {t("authExtra.resendEmail")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                onClick={() => { setEmailSent(false); setSentEmail(""); }}
              >
                {t("authExtra.backToSignup")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Email confirmed — own isolated sign-in (no shared signInData state) ─────
  const emailFromUrl = searchParams.get("email") || "";
  if (isConfirmed && !user && !authLoading) {
    return (
      <ConfirmedSignIn
        email={emailFromUrl}
        onSuccess={() => navigate("/", { replace: true })}
        onResend={resendConfirmation}
      />
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8" style={{ background: "#F5F4F0" }}>
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="oTutorHub" className="h-10 w-10" />
            <span className="font-display text-2xl font-bold text-foreground">oTutorHub</span>
          </div>
          <LanguageSwitcher variant="ghost" size="sm" />
        </div>

        <Card className="rounded-[20px] border-[#eceef3] shadow-[0_14px_40px_-20px_rgba(15,15,26,.25)]">
          <CardHeader>
            <CardTitle style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 23, letterSpacing: "-.01em" }}>{t("auth.welcome")}</CardTitle>
            <CardDescription className="text-[14px]">{t("auth.welcomeSub")}</CardDescription>
          </CardHeader>
          <CardContent>
            {pendingHint && (
              <div className="mb-4 rounded-md border border-primary/30 bg-primary/5 p-3 text-[13px] text-foreground">
                <div className="mb-1 flex items-center gap-1.5 font-medium text-primary">
                  <Mail className="h-3.5 w-3.5" />
                  {t("auth.invitedByTutor")}
                </div>
                <p className="text-muted-foreground">
                  <Trans
                    i18nKey="auth.invitedByTutorDesc"
                    values={{ email: pendingHint }}
                    components={{ 1: <span className="font-medium text-foreground" /> }}
                  />
                </p>
              </div>
            )}
            <Tabs value={activeTab} onValueChange={(tab) => { setActiveTab(tab); setSignInData(p => ({ ...p, password: "" })); setSignUpData(p => ({ ...p, password: "" })); }} className="w-full">
              <TabsList className="grid w-full grid-cols-2 p-1 rounded-[12px] h-12" style={{ background: "rgba(15,15,26,.06)" }}>
                <TabsTrigger value="signin" className="rounded-md font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=inactive]:text-muted-foreground">{t("auth.tabSignIn")}</TabsTrigger>
                <TabsTrigger value="signup" className="rounded-md font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=inactive]:text-muted-foreground">{t("auth.tabSignUp")}</TabsTrigger>
              </TabsList>

              <div className="mt-4 space-y-3">
                {/* Google OAuth заборонений Google всередині webview (disallowed_useragent),
                    тож у нативних збірках показуємо лише email-вхід. */}
                {!isNativeApp() && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={loading}
                  onClick={handleGoogleSignIn}
                >
                  <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z"/>
                  </svg>
                  {t("auth.googleSignIn")}
                </Button>
                )}
                {!isNativeApp() && (
                <div className="relative">
                  <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                  <div className="relative flex justify-center text-[13px] uppercase">
                    <span className="bg-card px-2 text-muted-foreground">{t("common.or")}</span>
                  </div>
                </div>
                )}
              </div>

              <TabsContent value="signin">
                {confirmedNotice && (
                  <div className="mb-4 rounded-md border border-primary/30 bg-primary/10 p-3 text-sm">
                    {t("auth.emailConfirmedBanner")}
                  </div>
                )}
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signin-email">Email</Label>
                    <Input
                      id="signin-email"
                      type="email"
                      autoComplete="email"
                      value={signInData.email}
                      onChange={(e) => setSignInData({ ...signInData, email: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signin-password">{t("auth.password")}</Label>
                    <Input
                      id="signin-password"
                      type="password"
                      autoComplete="current-password"
                      value={signInData.password}
                      onChange={(e) => setSignInData({ ...signInData, password: e.target.value })}
                      required
                    />
                  </div>
                  <div className="flex items-center justify-between text-[13px]">
                    <label className="flex items-center gap-2 cursor-pointer text-muted-foreground hover:text-foreground">
                      <Checkbox
                        checked={remember}
                        onCheckedChange={(v) => setRemember(v === true)}
                        aria-label={t("auth.rememberMe")}
                      />
                      {t("auth.rememberMe")}
                    </label>
                  </div>
                  <Button type="submit" className="w-full h-12 rounded-[14px] text-[15.5px] font-bold shadow-[0_8px_20px_-8px_rgba(43,191,170,.6)]" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t("auth.login")}
                  </Button>
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="block w-full text-center text-[13px] text-muted-foreground hover:text-foreground hover:underline"
                  >
                    {t("auth.forgotPassword")}
                  </button>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-4">
                  {/* Role selector */}
                  <div className="space-y-2">
                    <Label>{t("auth.iAm")}</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setSignUpData({ ...signUpData, role: "tutor" })}
                        className={cn(
                          "flex flex-col items-center gap-1 rounded-lg border-2 p-3 text-center transition-colors",
                          signUpData.role === "tutor"
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/40"
                        )}
                      >
                        <BookOpenCheck className="h-5 w-5 text-primary" />
                        <span className="text-sm font-medium">{t("auth.roleTutor")}</span>
                        <span className="text-[13px] text-muted-foreground">{t("auth.tutorHint")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSignUpData({ ...signUpData, role: "student" })}
                        className={cn(
                          "flex flex-col items-center gap-1 rounded-lg border-2 p-3 text-center transition-colors",
                          signUpData.role === "student"
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/40"
                        )}
                      >
                        <GraduationCap className="h-5 w-5 text-primary" />
                        <span className="text-sm font-medium">{t("auth.roleStudent")}</span>
                        <span className="text-[13px] text-muted-foreground">{t("auth.studentHint")}</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="su-fn">{t("auth.firstName")}</Label>
                      <Input
                        id="su-fn"
                        value={signUpData.firstName}
                        onChange={(e) => setSignUpData({ ...signUpData, firstName: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="su-ln">{t("auth.lastName")}</Label>
                      <Input
                        id="su-ln"
                        value={signUpData.lastName}
                        onChange={(e) => setSignUpData({ ...signUpData, lastName: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowExtra((v) => !v)}
                    className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
                  >
                    {showExtra ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    {showExtra ? t("auth.hideOptional") : t("auth.showOptional")}
                  </button>
                  {showExtra && (
                    <div className="space-y-2">
                      <Label htmlFor="su-phone">{t("auth.phone")}</Label>
                      <Input
                        id="su-phone"
                        type="tel"
                        autoComplete="tel"
                        value={signUpData.phone}
                        onChange={(e) => setSignUpData({ ...signUpData, phone: e.target.value })}
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="su-email">Email</Label>
                    <Input
                      id="su-email"
                      type="email"
                      autoComplete="email"
                      value={signUpData.email}
                      onChange={(e) => setSignUpData({ ...signUpData, email: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="su-password">{t("auth.password")}</Label>
                    <Input
                      id="su-password"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      value={signUpData.password}
                      onChange={(e) => setSignUpData({ ...signUpData, password: e.target.value })}
                      required
                    />
                    <p className="text-[13px] text-muted-foreground">{t("auth.minPasswordHint")}</p>
                  </div>
                  <Button type="submit" className="w-full h-12 rounded-[14px] text-[15.5px] font-bold shadow-[0_8px_20px_-8px_rgba(43,191,170,.6)]" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t("auth.createAccount")}
                  </Button>
                  {signUpData.role === "tutor" && (
                    <p className="text-center text-[13px] text-muted-foreground">
                      {t("auth.tutorFreeHint")}
                    </p>
                  )}
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
