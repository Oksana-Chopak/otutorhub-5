import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, CalendarClock } from "lucide-react";
import { WEEKDAYS_UK, describePayoutSchedule, type PayoutSchedule } from "@/lib/payoutSchedule";

const C = {
  teal: "#2BBFAA", tealD: "#1f8e7e", ink: "#0f0f1a", sub: "#9398b0", border: "#eceef3",
  display: "Inter, system-ui, sans-serif",
};

// Дні тижня у порядку пн→нд (зручніше для UA), мапимо на JS getDay 0..6
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function PayoutScheduleCard({ tutorId }: { tutorId: string }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [colsMissing, setColsMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [freq, setFreq] = useState<"" | "weekly" | "biweekly" | "monthly">("");
  const [weekday, setWeekday] = useState<number>(5); // п'ятниця за замовч.
  const [monthday, setMonthday] = useState<number>(1);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("tutor_details")
        .select("payout_frequency, payout_weekday, payout_monthday")
        .eq("user_id", tutorId)
        .maybeSingle();
      if (!alive) return;
      if (error && /payout_frequency|column|does not exist/i.test(error.message)) {
        setColsMissing(true);
        setLoading(false);
        return;
      }
      if (data) {
        setFreq((data.payout_frequency as any) ?? "");
        if (data.payout_weekday != null) setWeekday(data.payout_weekday);
        if (data.payout_monthday != null) setMonthday(data.payout_monthday);
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [tutorId]);

  const save = async () => {
    setSaving(true);
    const patch: any = {
      user_id: tutorId,
      payout_frequency: freq || null,
      payout_weekday: freq === "weekly" || freq === "biweekly" ? weekday : null,
      payout_monthday: freq === "monthly" ? monthday : null,
    };
    if (freq === "biweekly") patch.payout_anchor = new Date().toISOString().slice(0, 10);
    const { error } = await supabase.from("tutor_details").upsert(patch, { onConflict: "user_id" });
    setSaving(false);
    if (error) {
      toast.error(t("payoutScheduleCard.saveErrorTitle"), { description: error.message });
      return;
    }
    toast.success(t("payoutScheduleCard.saveSuccessTitle"), {
      description: describePayoutSchedule(patch as PayoutSchedule) ?? t("payoutScheduleCard.noSchedule"),
    });
  };

  if (loading) {
    return <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin" style={{ color: C.sub }} /></div>;
  }

  // Колонки графіка ще не створені (Частина 1 SQL не застосована) — картку ховаємо.
  if (colsMissing) return null;

  const chip = (active: boolean) => ({
    height: 36, padding: "0 13px", borderRadius: 11, cursor: "pointer",
    fontFamily: C.display, fontWeight: 700, fontSize: 13.5,
    background: active ? "#f0fdf9" : "#fff",
    border: `1.5px solid ${active ? C.teal : C.border}`,
    color: active ? C.tealD : C.sub,
  });

  return (
    <div style={{ borderRadius: 16, border: `1px solid ${C.border}`, background: "#fff", padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <CalendarClock className="h-4 w-4" style={{ color: C.tealD }} />
        <span style={{ fontFamily: C.display, fontWeight: 800, fontSize: 15, color: C.ink }}>{t("payoutScheduleCard.title")}</span>
      </div>

      {/* Періодичність */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: freq ? 12 : 0 }}>
        {([
          ["", t("payoutScheduleCard.noSchedule")],
          ["weekly", t("payoutScheduleCard.freqWeekly")],
          ["biweekly", t("payoutScheduleCard.freqBiweekly")],
          ["monthly", t("payoutScheduleCard.freqMonthly")],
        ] as const).map(([val, label]) => (
          <button key={val} type="button" onClick={() => setFreq(val)} style={chip(freq === val)}>
            {label}
          </button>
        ))}
      </div>

      {/* День тижня */}
      {(freq === "weekly" || freq === "biweekly") && (
        <div>
          <p style={{ fontSize: 13, color: C.sub, fontFamily: C.display, fontWeight: 700, marginBottom: 7 }}>{t("payoutScheduleCard.weekdayLabel")}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {WEEKDAY_ORDER.map((d) => (
              <button key={d} type="button" onClick={() => setWeekday(d)}
                style={{ width: 40, height: 36, borderRadius: 10, cursor: "pointer",
                  fontFamily: C.display, fontWeight: 700, fontSize: 13,
                  background: weekday === d ? C.teal : "#fff",
                  border: `1.5px solid ${weekday === d ? C.teal : C.border}`,
                  color: weekday === d ? "#0f0f1a" : C.sub }}>
                {WEEKDAYS_UK[d].slice(0, 2)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Число місяця */}
      {freq === "monthly" && (
        <div>
          <p style={{ fontSize: 13, color: C.sub, fontFamily: C.display, fontWeight: 700, marginBottom: 7 }}>{t("payoutScheduleCard.monthdayLabel")}</p>
          <input type="number" min={1} max={28} value={monthday}
            onChange={(e) => setMonthday(Math.min(28, Math.max(1, parseInt(e.target.value, 10) || 1)))}
            style={{ width: 90, height: 44, borderRadius: 12, border: `1.5px solid ${C.border}`, padding: "0 13px",
              fontSize: 17, fontFamily: C.display, fontWeight: 700, color: C.tealD, outline: "none" }} />
          <span style={{ marginLeft: 8, fontSize: 13, color: C.sub }}>1–28</span>
        </div>
      )}

      <button type="button" onClick={save} disabled={saving}
        style={{ width: "100%", height: 44, marginTop: 14, borderRadius: 12, border: "none",
          cursor: saving ? "default" : "pointer",
          background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a",
          fontFamily: C.display, fontWeight: 700, fontSize: 14.5,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          boxShadow: "0 6px 16px -8px rgba(43,191,170,.6)" }}>
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        {t("payoutScheduleCard.saveButton")}
      </button>
    </div>
  );
}
