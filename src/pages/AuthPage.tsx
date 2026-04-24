import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
import { Loader2, GraduationCap, BookOpenCheck } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const REMEMBER_KEY = "tutorhub.rememberMe";

const signUpSchema = z.object({
  firstName: z.string().trim().min(1, "Введіть ім'я").max(50),
  lastName: z.string().trim().min(1, "Введіть прізвище").max(50),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  email: z.string().trim().email("Некоректний email").max(255),
  password: z.string().min(8, "Мінімум 8 символів").max(128),
  role: z.enum(["student", "tutor"]),
});

const signInSchema = z.object({
  email: z.string().trim().email("Некоректний email").max(255),
  password: z.string().min(1, "Введіть пароль").max(128),
}).required();

type SignUpRole = "student" | "tutor";

export default function AuthPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState<boolean>(() => {
    const stored = localStorage.getItem(REMEMBER_KEY);
    return stored === null ? true : stored === "true";
  });

  const [signInData, setSignInData] = useState({ email: "", password: "" });
  const [signUpData, setSignUpData] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    password: "",
    role: "student" as SignUpRole,
  });

  useEffect(() => {
    if (!authLoading && user) navigate("/", { replace: true });
  }, [user, authLoading, navigate]);

  useEffect(() => {
    localStorage.setItem(REMEMBER_KEY, String(remember));
  }, [remember]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = signInSchema.safeParse(signInData);
    if (!parsed.success) {
      toast({ title: "Помилка", description: parsed.error.errors[0].message, variant: "destructive" });
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
      toast({
        title: "Не вдалося увійти",
        description: error.message === "Invalid login credentials"
          ? "Невірний email або пароль"
          : error.message === "Email not confirmed"
          ? "Підтвердіть email — ми надіслали посилання на пошту"
          : "Не вдалося увійти. Спробуйте ще раз.",
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
        title: "Введіть email",
        description: "Спочатку вкажіть email у полі вище — ми надішлемо посилання для скидання пароля.",
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
      toast({ title: "Не вдалося надіслати лист", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Перевірте пошту",
      description: "Ми надіслали посилання для скидання пароля на " + emailParse.data,
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
        title: "Не вдалося увійти через Google",
        description: result.error.message ?? "Спробуйте ще раз.",
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
      toast({ title: "Помилка", description: parsed.error.errors[0].message, variant: "destructive" });
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
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
    if (error) {
      console.error("Sign-up failed", error);
      toast({
        title: "Не вдалося зареєструватися",
        description: error.message === "User already registered"
          ? "Користувач з таким email вже існує"
          : "Не вдалося зареєструватися. Спробуйте ще раз.",
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Майже готово!",
      description: "Ми надіслали лист для підтвердження. Перевірте пошту.",
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <img src="/logo.png" alt="oTutorHub" className="h-10 w-10" />
          <span className="font-display text-2xl font-bold text-foreground">oTutorHub</span>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Ласкаво просимо</CardTitle>
            <CardDescription>Увійдіть або створіть акаунт</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="signin" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Вхід</TabsTrigger>
                <TabsTrigger value="signup">Реєстрація</TabsTrigger>
              </TabsList>

              <TabsContent value="signin">
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
                    <Label htmlFor="signin-password">Пароль</Label>
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
                        aria-label="Запам'ятати мене"
                      />
                      Запам'ятати мене
                    </label>
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Увійти
                  </Button>
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="block w-full text-center text-xs text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Забули пароль?
                  </button>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-4">
                  {/* Role selector */}
                  <div className="space-y-2">
                    <Label>Я реєструюся як</Label>
                    <div className="grid grid-cols-2 gap-2">
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
                        <span className="text-sm font-medium">Учень</span>
                        <span className="text-[10px] text-muted-foreground">Шукаю репетитора</span>
                      </button>
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
                        <span className="text-sm font-medium">Репетитор</span>
                        <span className="text-[10px] text-muted-foreground">Веду своїх учнів</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="su-fn">Ім'я</Label>
                      <Input
                        id="su-fn"
                        value={signUpData.firstName}
                        onChange={(e) => setSignUpData({ ...signUpData, firstName: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="su-ln">Прізвище</Label>
                      <Input
                        id="su-ln"
                        value={signUpData.lastName}
                        onChange={(e) => setSignUpData({ ...signUpData, lastName: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="su-phone">Телефон</Label>
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
                    <Label htmlFor="su-password">Пароль</Label>
                    <Input
                      id="su-password"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      value={signUpData.password}
                      onChange={(e) => setSignUpData({ ...signUpData, password: e.target.value })}
                      required
                    />
                    <p className="text-xs text-muted-foreground">Мінімум 8 символів</p>
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Створити акаунт
                  </Button>
                  {signUpData.role === "tutor" && (
                    <p className="text-center text-xs text-muted-foreground">
                      Як репетитор ви зможете додавати власних учнів. До 5 учнів — безкоштовно.
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
