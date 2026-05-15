import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
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
import { Loader2, GraduationCap, BookOpenCheck, Mail } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { cn } from "@/lib/utils";

const REMEMBER_KEY = "tutorhub.rememberMe";

const signUpSchema = z.object({
  firstName: z.string().trim().min(1, "ÐÐ²ÐµÐ´ÑÑÑ ÑÐ¼'Ñ").max(50),
  lastName: z.string().trim().min(1, "ÐÐ²ÐµÐ´ÑÑÑ Ð¿ÑÑÐ·Ð²Ð¸ÑÐµ").max(50),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  email: z.string().trim().email("ÐÐµÐºÐ¾ÑÐµÐºÑÐ½Ð¸Ð¹ email").max(255),
  password: z.string().min(8, "ÐÑÐ½ÑÐ¼ÑÐ¼ 8 ÑÐ¸Ð¼Ð²Ð¾Ð»ÑÐ²").max(128),
  role: z.enum(["student", "tutor"]),
});

const signInSchema = z.object({
  email: z.string().trim().email("ÐÐµÐºÐ¾ÑÐµÐºÑÐ½Ð¸Ð¹ email").max(255),
  password: z.string().min(1, "ÐÐ²ÐµÐ´ÑÑÑ Ð¿Ð°ÑÐ¾Ð»Ñ").max(128),
}).required();

type SignUpRole = "student" | "tutor";

export default function AuthPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState<boolean>(() => {
    const stored = localStorage.getItem(REMEMBER_KEY);
    return stored === null ? true : stored === "true";
  });

  // Invite-link / preselected tab support: ?signup=1&email=...&role=student|tutor
  const isConfirmed = searchParams.get("confirmed") === "1";
  const initialTab = searchParams.get("signup") === "1" ? "signup" : "signin";
  const [activeTab, setActiveTab] = useState<string>(isConfirmed ? "signin" : initialTab);
  const [pendingHint, setPendingHint] = useState<string | null>(null);
  const [confirmedNotice, setConfirmedNotice] = useState<boolean>(isConfirmed);

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

  // If we arrived via invite link, immediately check whether the email
  // matches an existing ghost profile so the hint is visible upfront.
  useEffect(() => {
    const emailFromUrl = searchParams.get("email");
    if (searchParams.get("signup") === "1" && emailFromUrl) {
      supabase
        .rpc("is_pending_email", { _email: emailFromUrl })
        .then(({ data }) => {
          if (data === true) {
            setPendingHint(emailFromUrl);
          }
        })
      .catch((err: unknown) => console.error("[AuthPage] is_pending_email network error:", err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Email confirmed redirect handling: ?confirmed=1
  useEffect(() => {
    if (!isConfirmed) return;
    if (authLoading) return;
    if (user) {
      // Active session â go to root, role-based routing happens there
      navigate("/", { replace: true });
      return;
    }
    toast({
      title: "Email Ð¿ÑÐ´ÑÐ²ÐµÑÐ´Ð¶ÐµÐ½Ð¾! ð",
      description: "Ð£Ð²ÑÐ¹Ð´ÑÑÑ, ÑÐ¾Ð± Ð¿ÑÐ¾Ð´Ð¾Ð²Ð¶Ð¸ÑÐ¸.",
    });
  }, [isConfirmed, authLoading, user, navigate]);

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
      toast({ title: "ÐÐ¾Ð¼Ð¸Ð»ÐºÐ°", description: parsed.error.errors[0].message, variant: "destructive" });
      return;
    }
    setLoading(true);
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
    setLoading(false);
    if (!error && signUpResult?.user && signUpResult.user.identities?.length === 0) {
      toast({
        title: "Email Ð²Ð¶Ðµ Ð·Ð°ÑÐµÑÑÑÑÐ¾Ð²Ð°Ð½Ð¾",
        description: "Ð¦ÐµÐ¹ email Ð²Ð¶Ðµ Ð·Ð°ÑÐµÑÑÑÑÐ¾Ð²Ð°Ð½Ð¸Ð¹. Ð£Ð²ÑÐ¹Ð´ÑÑÑ Ð°Ð±Ð¾ ÑÐºÐ¸Ð½ÑÑÐµ Ð¿Ð°ÑÐ¾Ð»Ñ.",
        variant: "destructive",
      });
      setSignInData((prev) => ({ ...prev, email: parsed.data.email }));
      setActiveTab("signin");
      return;
    }
    if (error) {
      console.error("Sign-up failed", error);
      toast({
        title: "ÐÐµ Ð²Ð´Ð°Ð»Ð¾ÑÑ Ð·Ð°ÑÐµÑÑÑÑÑÐ²Ð°ÑÐ¸ÑÑ",
        description: error.message === "User already registered"
          ? "ÐÐ¾ÑÐ¸ÑÑÑÐ²Ð°Ñ Ð· ÑÐ°ÐºÐ¸Ð¼ email Ð²Ð¶Ðµ ÑÑÐ½ÑÑ"
          : "ÐÐµ Ð²Ð´Ð°Ð»Ð¾ÑÑ Ð·Ð°ÑÐµÑÑÑÑÑÐ²Ð°ÑÐ¸ÑÑ. Ð¡Ð¿ÑÐ¾Ð±ÑÐ¹ÑÐµ ÑÐµ ÑÐ°Ð·.",
        variant: "destructive",
      });
      return;
    }
    let demoName: string | null = null;
    try {
      const raw = localStorage.getItem("tutorhub.demo");
      if (raw) {
        const parsed = JSON.parse(raw);
        demoName = parsed?.student?.name || parsed?.lesson?.studentName || parsed?.payment?.studentName || null;
      }
    } catch { /* ignore */ }
    toast({
      title: t("auth.almostDone"),
      description: demoName
        ? `ÐÐ¸ Ð²Ð¶Ðµ Ð·Ð±ÐµÑÐµÐ³Ð»Ð¸ ${demoName} â Ð¿ÑÐ¾Ð´Ð¾Ð²Ð¶ÑÐ¹ Ð· Ð½Ð°ÑÑÑÐ¿Ð½Ð¾Ð³Ð¾ ÐºÑÐ¾ÐºÑ ð`
        : t("auth.almostDoneDesc"),
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="oTutorHub" className="h-10 w-10" />
            <span className="font-display text-2xl font-bold text-foreground">oTutorHub</span>
          </div>
          <LanguageSwitcher variant="ghost" size="sm" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("auth.welcome")}</CardTitle>
            <CardDescription>{t("auth.welcomeSub")}</CardDescription>
          </CardHeader>
          <CardContent>
            {pendingHint && (
              <div className="mb-4 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-foreground">
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
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">{t("auth.tabSignIn")}</TabsTrigger>
                <TabsTrigger value="signup">{t("auth.tabSignUp")}</TabsTrigger>
              </TabsList>

              <div className="mt-4 space-y-3">
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
                <div className="relative">
                  <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">{t("common.or")}</span>
                  </div>
                </div>
              </div>

              <TabsContent value="signin">
                {confirmedNotice && (
                  <div className="mb-4 rounded-md border border-primary/30 bg-primary/10 p-3 text-sm">
                    Email Ð¿ÑÐ´ÑÐ²ÐµÑÐ´Ð¶ÐµÐ½Ð¾! Ð£Ð²ÑÐ¹Ð´ÑÑÑ, ÑÐ¾Ð± Ð¿ÑÐ¾Ð´Ð¾Ð²Ð¶Ð¸ÑÐ¸ ð
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
                  <div className="flex items-center justify-between text-xs">
                    <label className="flex items-center gap-2 cursor-pointer text-muted-foreground hover:text-foreground">
                      <Checkbox
                        checked={remember}
                        onCheckedChange={(v) => setRemember(v === true)}
                        aria-label={t("auth.rememberMe")}
                      />
                      {t("auth.rememberMe")}
                    </label>
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t("auth.login")}
                  </Button>
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="block w-full text-center text-xs text-muted-foreground hover:text-foreground hover:underline"
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
                        <span className="text-[10px] text-muted-foreground">{t("auth.tutorHint")}</span>
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
                        <span className="text-[10px] text-muted-foreground">{t("auth.studentHint")}</span>
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
                    <p className="text-xs text-muted-foreground">{t("auth.minPasswordHint")}</p>
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t("auth.createAccount")}
                  </Button>
                  {signUpData.role === "tutor" && (
                    <p className="text-center text-xs text-muted-foreground">
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
