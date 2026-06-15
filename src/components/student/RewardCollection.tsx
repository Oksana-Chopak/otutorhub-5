import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import type { StudentReward } from "@/hooks/useStudentRewards";

interface Props {
  rewards: StudentReward[];
  loading: boolean;
}

const C = {
  teal: "#2BBFAA", tealD: "#1f8e7e", txt: "#0f0f1a", sub: "#9398b0",
  border: "#eceef3", display: "Inter, system-ui, sans-serif",
};

export function RewardCollection({ rewards, loading }: Props) {
  const { t } = useTranslation();

  return (
    <div style={{ borderRadius: 18, border: `1px solid ${C.border}`, background: "#fff", padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: C.display, fontWeight: 700, fontSize: 15.5, color: C.txt }}>
          <Sparkles className="h-4 w-4" style={{ color: C.teal }} />
          {t("rewardCollection.title")}
        </h2>
        <Link to="/student/achievements" style={{ fontFamily: C.display, fontWeight: 700, fontSize: 13, color: C.tealD, textDecoration: "none" }}>
          {t("rewardCollection.seeAll")} →
        </Link>
      </div>

      {loading ? null : rewards.length === 0 ? (
        <div style={{ textAlign: "center", padding: "20px 12px" }}>
          <div style={{ fontSize: 34 }}>🍎</div>
          <p style={{ fontSize: 13.5, color: C.sub, marginTop: 6, lineHeight: 1.5 }}>{t("rewardCollection.empty")}</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {rewards.map((r) => (
            <span
              key={r.id}
              title={new Date(r.earned_at).toLocaleDateString("uk-UA")}
              style={{
                width: 46, height: 46, borderRadius: 14, display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: 23, cursor: "default",
                background: "linear-gradient(135deg, rgba(43,191,170,.12), rgba(43,191,170,.04))",
                boxShadow: "inset 0 0 0 1px rgba(43,191,170,.25)",
                transition: "transform .15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.1)")}
              onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
            >
              {r.emoji}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
