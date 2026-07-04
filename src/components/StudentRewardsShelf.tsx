import { useEffect, useMemo, useState } from "react";
import { getLocale } from "@/lib/locale";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";

interface RewardRow {
  emoji: string;
  created_at: string;
}

const C = {
  teal: "#2BBFAA", tealD: "#25a896", txt: "#0f0f1a", sub: "var(--sub,#6b7088)",
  border: "#eceef3", display: "Inter, system-ui, sans-serif", body: "'Plus Jakarta Sans', system-ui, sans-serif",
};

/** Student-facing rewards shelf: every completed lesson drops an emoji here. */
export function StudentRewardsShelf() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [rewards, setRewards] = useState<RewardRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await (supabase as any)
          .from("student_rewards")
          .select("emoji, created_at")
          .eq("student_id", user.id)
          .order("created_at", { ascending: false })
          .limit(120);
        if (!cancelled) setRewards((data ?? []) as RewardRow[]);
      } catch {
        if (!cancelled) setRewards([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const monthCount = useMemo(() => {
    const now = new Date();
    const mStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return rewards.filter((r) => new Date(r.created_at).getTime() >= mStart).length;
  }, [rewards]);

  // Простий стрік: скільки тижнів поспіль (включно з поточним) є хоч одна нагорода
  const weekStreak = useMemo(() => {
    if (!rewards.length) return 0;
    const weekOf = (d: Date) => {
      const x = new Date(d); x.setHours(0, 0, 0, 0);
      x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // понеділок
      return x.getTime();
    };
    const weeks = new Set(rewards.map((r) => weekOf(new Date(r.created_at))));
    let streak = 0;
    let cursor = weekOf(new Date());
    while (weeks.has(cursor)) { streak += 1; cursor -= 7 * 86400000; }
    return streak;
  }, [rewards]);

  if (loading) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div style={{ fontFamily: C.body, color: C.txt, display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Hero */}
      <div style={{ borderRadius: 20, padding: "20px 22px", background: "linear-gradient(135deg,#0f0f1a,#1a1f3a)", color: "#fff", boxShadow: "0 16px 40px -20px rgba(15,15,26,.7)" }}>
        <div style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: ".09em", color: "rgba(255,255,255,.55)", fontFamily: C.display, fontWeight: 700 }}>
          {t("studentRewardsShelf.heroTitle")}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 6 }}>
          <span style={{ fontFamily: C.display, fontWeight: 800, fontSize: 38, letterSpacing: "-.02em", color: C.teal }}>{rewards.length}</span>
          <span style={{ fontFamily: C.display, fontWeight: 700, fontSize: 16 }}>{t("studentRewardsShelf.allTime")}</span>
          {monthCount > 0 && <span style={{ fontSize: 14, color: "rgba(255,255,255,.65)" }}>· {t("studentRewardsShelf.thisMonth", { count: monthCount })}</span>}
        </div>
        {weekStreak > 1 && (
          <div style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "5px 12px", background: "rgba(245,181,68,.18)", color: "#F5B400", fontFamily: C.display, fontWeight: 700, fontSize: 14 }}>
            🔥 {t("studentRewardsShelf.weekStreak", { count: weekStreak })}
          </div>
        )}
      </div>

      {/* Shelf */}
      {rewards.length === 0 ? (
        <div style={{ textAlign: "center", padding: "36px 16px", borderRadius: 18, border: `1px dashed ${C.border}`, background: "#fff" }}>
          <div style={{ fontSize: 40 }}>🍎</div>
          <p style={{ fontFamily: C.display, fontWeight: 800, fontSize: 17, marginTop: 8 }}>{t("studentRewardsShelf.emptyTitle")}</p>
          <p style={{ fontSize: 14, color: C.sub, marginTop: 4, lineHeight: 1.5 }}>
            {t("studentRewardsShelf.emptyDescription")}
          </p>
        </div>
      ) : (
        <div style={{ borderRadius: 18, border: `1px solid ${C.border}`, background: "#fff", padding: 14 }}>
          <div style={{ fontFamily: C.display, fontWeight: 700, fontSize: 14, color: C.sub, marginBottom: 10, textTransform: "uppercase", letterSpacing: ".07em" }}>
            {t("studentRewardsShelf.collectionLabel")}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {rewards.map((r, i) => (
              <span key={i} title={new Date(r.created_at).toLocaleDateString(getLocale())}
                style={{ width: 46, height: 46, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 23, background: "linear-gradient(135deg, rgba(43,191,170,.12), rgba(43,191,170,.04))", boxShadow: "inset 0 0 0 1px rgba(43,191,170,.25)" }}>
                {r.emoji}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default StudentRewardsShelf;
