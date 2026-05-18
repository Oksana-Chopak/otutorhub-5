import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { ReferralWidget } from "@/components/ReferralWidget";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Trophy, Medal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";

interface LeaderRow {
  referrer_id: string;
  first_name: string | null;
  last_name: string | null;
  pro_upgrades: number;
  total_signups: number;
}

export default function MyReferralsPage() {
  const { t } = useTranslation();
  const RANK_REWARDS = [t("myReferrals.rankReward1"), t("myReferrals.rankReward2"), t("myReferrals.rankReward3")];
  const { user } = useAuth();
  const [leaderboard, setLeaderboard] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  useEffect(() => {
    setLoading(true);
    supabase
      .rpc("get_referral_leaderboard", { _year: year, _month: month })
      .then(({ data }) => {
        setLeaderboard((data as LeaderRow[]) ?? []);
        setLoading(false);
      });
  }, [year, month]);

  return (
    <AppLayout>
      <div className="space-y-6">
        <ReferralWidget />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-warning" />
              {t("myReferrals.leaderboardTitle")}
            </CardTitle>
            <CardDescription>
              {t("myReferrals.leaderboardDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-24 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : leaderboard.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t("myReferrals.noReferrals")}
              </p>
            ) : (
              <ul className="space-y-2">
                {leaderboard.slice(0, 10).map((row, idx) => {
                  const isMe = row.referrer_id === user?.id;
                  const name = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "—";
                  return (
                    <li
                      key={row.referrer_id}
                      className={`flex items-center gap-3 rounded-xl border p-3 ${
                        isMe ? "border-primary/40 bg-primary/5" : "border-border"
                      }`}
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-foreground">
                        {idx + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">
                          {isMe ? `${name} ${t("myReferrals.you")}` : name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t("myReferrals.signupsProLabel", { signups: row.total_signups, pro: row.pro_upgrades })}
                        </div>
                      </div>
                      {idx < 3 && (
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          {RANK_REWARDS[idx]}
                        </Badge>
                      )}
                      {idx >= 3 && idx < 10 && (
                        <Badge variant="outline" className="shrink-0 text-[10px]">{t("myReferrals.rankReward4to10")}</Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("myReferrals.rulesTitle")}</CardTitle>
            <CardDescription>{t("myReferrals.rulesDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-foreground">
            <div className="flex gap-3"><span className="text-xl">1️⃣</span><span dangerouslySetInnerHTML={{ __html: t("myReferrals.rule1") }} /></div>
            <div className="flex gap-3"><span className="text-xl">2️⃣</span><span dangerouslySetInnerHTML={{ __html: t("myReferrals.rule2") }} /></div>
            <div className="flex gap-3"><span className="text-xl">3️⃣</span><span dangerouslySetInnerHTML={{ __html: t("myReferrals.rule3") }} /></div>
          </CardContent>
        </Card>

        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="space-y-2 p-5 text-sm">
            <p className="font-semibold text-foreground">{t("myReferrals.shareTitle")}</p>
            <p className="text-muted-foreground">{t("myReferrals.shareText1")}</p>
            <p className="text-muted-foreground">{t("myReferrals.shareText2")}</p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
