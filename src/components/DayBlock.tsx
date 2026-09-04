import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";

/**
 * B-D1: ЄДИНИЙ «блок дня» — рівно один стан і одна дія (принцип аудиту).
 * Замінює чорний банер «Закрити день» і NeedsMarkingCard разом.
 */
export type DayLesson = {
  id: string; starts_at: string; duration_minutes?: number | null;
  subject: string; status: string; student_id: string | null; tutor_id: string;
  student_payment_status?: string | null; meetingHref?: string | null; studentName: string;
};


/** P7: картка ВИНЕСЕНА з DayBlock — інакше setInterval(30с) ремаунтив її двічі на хвилину. */
function DayCard({ emoji, title, sub, action, onAction, secondary }: {
  emoji: string; title: string; sub?: string; action: string; onAction: () => void;
  secondary?: { label: string; onClick: () => void } | null;
}) {
  return (
    <div className="mb-4" style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderRadius: 18, background: "linear-gradient(135deg,#0f0f1a,#1a1f3a)", boxShadow: "0 14px 34px -18px rgba(15,15,26,.7)" }}>
      <span style={{ fontSize: 26 }}>{emoji}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 16.5, color: "#fff" }}>{title}</span>
        {sub && <span style={{ display: "block", fontSize: 14, color: "rgba(255,255,255,.65)", marginTop: 1 }}>{sub}</span>}
        {secondary && (
          <button type="button" onClick={secondary.onClick} style={{ marginTop: 6, border: "none", background: "transparent", padding: 0, color: "#7ee8d8", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
            {secondary.label}
          </button>
        )}
      </span>
      <button className="tap-44" type="button" onClick={onAction} style={{ flexShrink: 0, height: 38, padding: "0 14px", borderRadius: 11, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15, boxShadow: "0 6px 16px -6px rgba(43,191,170,.7)" }}>
        {action}
      </button>
    </div>
  );
}

export function DayBlock({ lessons, tomorrow, pendingCount, onJoin, onComplete, onWriteSummary, onCloseDay, onPlanNext, onOpenSchedule, canMarkPaid = true, paidLabelKey = "dayBlock.andPaid" }: {
  lessons: DayLesson[];
  tomorrow: { count: number; firstTime: string | null };
  pendingCount: number;
  onJoin: (href: string, lessonId: string) => void;
  onComplete: (id: string, alsoPaid: boolean) => void | Promise<void>;
  onWriteSummary: (lessonId: string) => void;
  onCloseDay: () => void;
  onPlanNext: () => void;
  onOpenSchedule: () => void;
  canMarkPaid?: boolean;
  /** Ключ підпису чекбокса оплати. Менеджеру — явний «і учень оплатив»: чекбокс пише student_payment_status, а «і оплачено» читалось як виплата репетитору. */
  paidLabelKey?: string;
}) {
  const { t } = useTranslation();
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setNowMs(Date.now()), 30000); return () => clearInterval(i); }, []);
  const [alsoPaid, setAlsoPaid] = useState(false);
  const [marking, setMarking] = useState(false); // B5: анти-дубль «Провів ✓»
  const [noSummaryIds, setNoSummaryIds] = useState<string[]>([]);

  const sorted = useMemo(() => [...lessons].sort((a, b) => a.starts_at.localeCompare(b.starts_at)), [lessons]);
  const endMs = (l: DayLesson) => new Date(l.starts_at).getTime() + (l.duration_minutes ?? 60) * 60000;
  const current  = sorted.find((l) => l.status === "scheduled" && new Date(l.starts_at).getTime() <= nowMs && nowMs < endMs(l));
  const soon     = sorted.find((l) => l.status === "scheduled" && new Date(l.starts_at).getTime() > nowMs && new Date(l.starts_at).getTime() - nowMs <= 30 * 60000);
  const justPast = sorted.find((l) => l.status === "scheduled" && endMs(l) <= nowMs);
  const completedIds = useMemo(() => sorted.filter((l) => l.status === "completed").map((l) => l.id), [sorted]);

  useEffect(() => {
    let off = false;
    (async () => {
      if (!completedIds.length) { setNoSummaryIds([]); return; }
      const { data } = await supabase.from("lesson_details").select("lesson_id, summary").in("lesson_id", completedIds);
      if (off) return;
      const withSummary = new Set((data ?? []).filter((d: any) => (d.summary ?? "").trim()).map((d: any) => d.lesson_id));
      setNoSummaryIds(completedIds.filter((id) => !withSummary.has(id)));
    })();
    return () => { off = true; };
  }, [completedIds.join("|")]);


  // P4: «Закрити день» досяжний з БУДЬ-ЯКОГО стану, а не лише з вузького justPast.
  const closeBar = pendingCount > 0 ? (
    <div className="mb-4 -mt-2">
      <button type="button" onClick={onCloseDay} style={{ border: "none", background: "transparent", padding: 0, color: "#2BBFAA", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
        {t("dayBlock.closeAll", { count: pendingCount })}
      </button>
    </div>
  ) : null;

  if (current)
    return (<>
      <DayCard emoji="🎓" title={t("dayBlock.nowTitle", { name: current.studentName })} sub={current.subject}
        action={current.meetingHref ? t("dayBlock.join") : t("dayBlock.addLink")}
        onAction={() => current.meetingHref ? onJoin(current.meetingHref, current.id) : onWriteSummary(current.id)} />
      {closeBar}
    </>);
  if (soon) {
    const min = Math.max(1, Math.round((new Date(soon.starts_at).getTime() - nowMs) / 60000));
    return (<>
      <DayCard emoji="⏳" title={t("dayBlock.soonTitle", { min, name: soon.studentName })} sub={soon.subject}
        action={soon.meetingHref ? t("dayBlock.join") : t("dayBlock.addLink")}
        onAction={() => soon.meetingHref ? onJoin(soon.meetingHref, soon.id) : onWriteSummary(soon.id)} />
      {closeBar}
    </>);
  }
  if (justPast)
    return (
      <div className="mb-4" style={{ padding: "14px 16px", borderRadius: 18, background: "linear-gradient(135deg,#0f0f1a,#1a1f3a)", boxShadow: "0 14px 34px -18px rgba(15,15,26,.7)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 26 }}>✅</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 16.5, color: "#fff" }}>
              {t("dayBlock.endedTitle", { name: justPast.studentName })}
            </span>
            {canMarkPaid && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 6, color: "rgba(255,255,255,.8)", fontSize: 14, cursor: "pointer" }}>
              <input type="checkbox" checked={alsoPaid} onChange={(e) => setAlsoPaid(e.target.checked)} style={{ width: 16, height: 16, accentColor: "#2BBFAA" }} />
              {t(paidLabelKey)}
            </label>
            )}
            {pendingCount >= 1 && (
              <button type="button" onClick={onCloseDay} style={{ display: "block", marginTop: 6, border: "none", background: "transparent", padding: 0, color: "#7ee8d8", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
                {t("dayBlock.closeAll", { count: pendingCount })}
              </button>
            )}
          </span>
          <button type="button" disabled={marking}
            onClick={async () => {
              // B5: подвійний тап давав учневі дві нагороди за один урок —
              // кнопка блокується, поки запис не завершився.
              if (marking) return;
              setMarking(true);
              try { await onComplete(justPast.id, alsoPaid); setAlsoPaid(false); }
              finally { setMarking(false); }
            }}
            style={{ flexShrink: 0, height: 38, padding: "0 14px", borderRadius: 11, border: "none", cursor: marking ? "default" : "pointer", opacity: marking ? 0.6 : 1, background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15, boxShadow: "0 6px 16px -6px rgba(43,191,170,.7)" }}>
            {t("dayBlock.markDone")}
          </button>
        </div>
      </div>
    );
  // P3: сьогоднішній МАЙБУТНІЙ урок (>30 хв) — власний стан, а не фолбек у «закрито».
  const nextToday = sorted.find((l) => l.status === "scheduled" && new Date(l.starts_at).getTime() > nowMs);
  if (nextToday) {
    const timeStr = new Date(nextToday.starts_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return (<>
      <DayCard emoji="⏰" title={t("dayBlock.nextTodayTitle", { time: timeStr, name: nextToday.studentName })} sub={nextToday.subject}
        action={nextToday.meetingHref ? t("dayBlock.join") : t("dayBlock.addLink")}
        onAction={() => nextToday.meetingHref ? onJoin(nextToday.meetingHref, nextToday.id) : onWriteSummary(nextToday.id)} />
      {closeBar}
    </>);
  }
  if (noSummaryIds.length > 0)
    return (<>
      <DayCard emoji="✍️" title={t("dayBlock.summariesTitle", { count: noSummaryIds.length })}
        action={t("dayBlock.write")} onAction={() => onWriteSummary(noSummaryIds[0])} />
      {closeBar}
    </>);
  if (tomorrow.count > 0)
    return (<>
      <DayCard emoji="📅" title={t("dayBlock.tomorrowTitle", { count: tomorrow.count, time: tomorrow.firstTime ?? "" })}
        action={t("dayBlock.openSchedule")} onAction={onOpenSchedule} />
      {closeBar}
    </>);
  // P3: 🌙 «закрито» — лише коли день СПРАВДІ позаду (вечір або були уроки).
  const morningAndEmpty = sorted.length === 0 && new Date(nowMs).getHours() < 18;
  if (morningAndEmpty)
    return <DayCard emoji="☀️" title={t("dayBlock.freeDay")}
      action={t("dayBlock.planNext")} onAction={onPlanNext} />;
  return (<>
    <DayCard emoji="🌙" title={t("dayBlock.closedTitle")}
      action={t("dayBlock.planNext")} onAction={onPlanNext} />
    {closeBar}
  </>);
}
