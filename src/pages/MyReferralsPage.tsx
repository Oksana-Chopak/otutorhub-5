import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { ReferralWidget } from "@/components/ReferralWidget";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Trophy, Medal } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface LeaderRow {
  referrer_id: string;
  first_name: string | null;
  last_name: string | null;
  pro_upgrades: number;
  total_signups: number;
}

const RANK_REWARDS = ["🥇 +6 міс Pro", "🥈 +3 міс Pro", "🥉 +3 міс Pro"];

export default function MyReferralsPage() {
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
              Топ рефереів місяця
            </CardTitle>
            <CardDescription>
              Призи топ-рефереру: 🥇 +6 міс · 🥈🥉 +3 міс · 4–10 місце — +1 міс Pro
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-24 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : leaderboard.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Поки що ніхто не запросив друзів цього місяця. Будь першим! 🚀
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
                          {isMe ? `${name} (ти)` : name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {row.total_signups} запрошень · {row.pro_upgrades} Pro
                        </div>
                      </div>
                      {idx < 3 && (
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          {RANK_REWARDS[idx]}
                        </Badge>
                      )}
                      {idx >= 3 && idx < 10 && (
                        <Badge variant="outline" className="shrink-0 text-[10px]">+1 міс Pro</Badge>
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
            <CardTitle>Три простих правила</CardTitle>
            <CardDescription>Без зірочок і дрібного шрифту</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-foreground">
            <div className="flex gap-3"><span className="text-xl">1️⃣</span><span>Друг зареєструвався за твоїм посиланням → він отримує <strong>30 днів тріалу у подарунок</strong>.</span></div>
            <div className="flex gap-3"><span className="text-xl">2️⃣</span><span>Друг оплатив перший місяць → ти отримуєш <strong>місяць безкоштовно</strong>.</span></div>
            <div className="flex gap-3"><span className="text-xl">3️⃣</span><span>Три друзі оплатили за один місяць → ти отримуєш <strong>три місяці безкоштовно</strong>.</span></div>
          </CardContent>
        </Card>

        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="space-y-2 p-5 text-sm">
            <p className="font-semibold text-foreground">👯 Хороше ділиться двічі</p>
            <p className="text-muted-foreground">
              Знаєш репетитора, який досі веде облік у блокноті? Саме час врятувати людину 😄
            </p>
            <p className="text-muted-foreground">
              Поділись посиланням — твій друг отримає 30 днів тріалу, а коли він підпишеться — ти також отримаєш 30 днів безкоштовно. Без умов дрібним шрифтом.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
