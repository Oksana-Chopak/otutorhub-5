import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const schema = z.object({
    password: z.string().min(8, t("resetPassword.minChars")).max(128),
  });
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [hasRecoverySession, setHasRecoverySession] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setHasRecoverySession(true);
    });
    // If page loaded after redirect, getSession should already include the recovery session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setHasRecoverySession(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ password });
    if (!parsed.success) {
      toast({
        title: t("resetPassword.errorTitle"),
        description: parsed.error.errors[0].message,
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    setLoading(false);
    if (error) {
      toast({ title: t("resetPassword.updateFailed"), description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: t("resetPassword.doneTitle"), description: t("resetPassword.doneDesc") });
    navigate("/", { replace: true });
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
            <CardTitle>{t("resetPassword.title")}</CardTitle>
            <CardDescription>
              {hasRecoverySession
                ? t("resetPassword.descHasSession")
                : t("resetPassword.descNoSession")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="np">{t("resetPassword.label")}</Label>
                <Input
                  id="np"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={!hasRecoverySession}
                />
                <p className="text-xs text-muted-foreground">{t("resetPassword.hint")}</p>
              </div>
              <Button type="submit" className="w-full" disabled={loading || !hasRecoverySession}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("resetPassword.saveBtn")}
              </Button>
              {!hasRecoverySession && (
                <Button
                  type="button"
                  variant="link"
                  className="w-full"
                  onClick={() => navigate("/auth")}
                >
                  {t("resetPassword.backToLogin")}
                </Button>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
