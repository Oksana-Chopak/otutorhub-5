import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { GraduationCap, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const REMEMBER_KEY = "tutorhub.rememberMe";

const signUpSchema = z.object({
  firstName: z.string().trim().min(1, "Введіть ім'я").max(50),
  lastName: z.string().trim().min(1, "Введіть прізвище").max(50),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  email: z.string().trim().email("Некоректний email").max(255),
  password: z.string().min(8, "Мінімум 8 символів").max(128),
});

const signInSchema = z.object({
  email: z.string().trim().email("Некоректний email").max(255),
  password: z.string().min(1, "Введіть пароль").max(128),
}).required();

export default function AuthPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);

  const [signInData, setSignInData] = useState({ email: "", password: "" });
  const [signUpData, setSignUpData] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    password: "",
  });

  useEffect(() => {
    if (!authLoading && user) navigate("/", { replace: true });
  }, [user, authLoading, navigate]);

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
          <GraduationCap className="h-8 w-8 text-primary" />
          <span className="font-display text-2xl font-bold text-foreground">TutorHub</span>
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
                    <Label htmlFor="su-phone">Телефон (приватно, бачить лише менеджер)</Label>
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
                  <p className="text-center text-xs text-muted-foreground">
                    Після реєстрації менеджер призначить вам роль (репетитор / учень).
                  </p>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
