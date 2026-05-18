import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Gift, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

const REFERRAL_KEY = "tutorhub.referralCode";

export default function JoinPage() {
  const { t } = useTranslation();
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [referrer, setReferrer] = useState<{ first_name: string; last_name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!code) return;
    (async () => {
      const { data, error } = await supabase
        .rpc("resolve_referral_code", { _code: code })
        .maybeSingle();
      if (error || !data) {
        setInvalid(true);
        setLoading(false);
        return;
      }
      setReferrer(data as any);
      // Persist code so AuthPage can claim it after signup
      localStorage.setItem(REFERRAL_KEY, code.toUpperCase());
      setLoading(false);
    })();
  }, [code]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (invalid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>{t("join.invalidTitle")}</CardTitle>
            <CardDescription>{t("join.invalidDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate("/auth?signup=1&role=tutor")} className="w-full">{t("join.register")}</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const referrerName = referrer ? `${referrer.first_name} ${referrer.last_name}`.trim() : t("join.defaultName");

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/10 via-background to-primary/5 px-4 py-8">
      <Card className="w-full max-w-md overflow-hidden">
        <div className="bg-gradient-to-br from-primary to-primary/70 p-6 text-primary-foreground">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
            <Gift className="h-7 w-7" />
          </div>
          <h1 className="mb-1 text-2xl font-bold">{t("join.inviteTitle", { name: referrerName })}</h1>
          <p className="text-sm opacity-90">{t("join.inviteSubtitle")}</p>
        </div>
        <CardContent className="space-y-4 p-6">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="mb-1 flex items-center gap-2 font-semibold text-primary">
              <Sparkles className="h-4 w-4" />
              {t("join.bonusTitle")}
            </div>
            <p className="text-sm text-foreground">
              {t("join.bonusDesc", { name: referrerName })}
            </p>
          </div>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>{t("join.feature1")}</p>
            <p>{t("join.feature2")}</p>
            <p>{t("join.feature3")}</p>
            <p>{t("join.feature4")}</p>
          </div>
          <Button
            onClick={() => navigate(`/auth?signup=1&role=tutor`)}
            size="lg"
            className="w-full"
          >
            {t("join.cta")}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {t("join.hasAccount")} <Link to="/auth" className="text-primary underline">{t("join.signIn")}</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
