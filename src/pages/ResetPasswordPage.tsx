import { useEffect, useState } from "react";
import { OfflineBanner } from "@/components/OfflineBanner";
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
  const [linkError, setLinkError] = useState(false);

  // The Supabase client is created WITHOUT detectSessionInUrl, so the tokens the
  // recovery e-mail brings (#access_token…&type=recovery or ?code=…) were never
  // parsed — getSession() stayed empty, updateUser failed with "Auth session
  // missing", and the reset flow looked completely broken. Exchange the link
  // tokens manually here, exactly like AuthPage does for confirmation links.
  useEffect(() => {
    const hash = window.location.hash.startsWith("#")
      ? new URLSearchParams(window.location.hash.slice(1))
      : null;
    const code = new URLSearchParams(window.location.search).get("code");
    const accessToken = hash?.get("access_token");
    const refreshToken = hash?.get("refresh_token");

    if (!code && !accessToken) return; // opened directly — banner will explain

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
        window.history.replaceState({}, "", window.location.pathname);
        setHasRecoverySession(true);
      } catch (err) {
        console.error("[ResetPassword] token exchange failed:", err);
        setLinkError(true);
      }
    })();
  }, []);

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
    <>
      <OfflineBanner />
    <div className="flex min-h-screen items-center justify-center px-4 py-8" style={{ background: "var(--ds-bg,#F5F4F0)" }}>
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <img src="/logo-96.webp" alt="oTutorHub" className="h-10 w-10" loading="lazy" />
          <span className="font-display text-2xl font-bold text-foreground">oTutorHub</span>
        </div>
        <Card className="rounded-[20px] border-[var(--ds-border,#eceef3)] shadow-[0_14px_40px_-20px_rgba(15,15,26,.25)]">
          <CardHeader>
            <CardTitle style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 22 }}>{t("resetPassword.title")}</CardTitle>
            <CardDescription>
              {hasRecoverySession
                ? t("resetPassword.descHasSession")
                : t("resetPassword.descNoSession")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {linkError && (
              <div className="mb-4 rounded-[12px] border px-3.5 py-3 text-[14px]"
                style={{ background: "#FDF1F1", borderColor: "#F3C4C4", color: "#8F2C2C" }}>
                {t("resetPassword.linkExpired")}
              </div>
            )}
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
                <p className="text-[14px] text-muted-foreground">{t("resetPassword.hint")}</p>
              </div>
              <Button type="submit" className="w-full h-12 rounded-[14px] text-[15.5px] font-bold shadow-[0_8px_20px_-8px_rgba(43,191,170,.6)]" disabled={loading || !hasRecoverySession}>
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
    </>
  );
}
