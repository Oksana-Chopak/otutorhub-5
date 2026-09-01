import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Share2, Download, Loader2, CalendarPlus } from "lucide-react";
import { useMonthlySummary } from "@/hooks/useTutorGamification";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import i18nInstance from "@/i18n";
import { lazyArray } from "@/lib/lazyI18n";
const t = i18nInstance.t.bind(i18nInstance);

// t("months") is a comma-joined list — split() IS the array. The old
// `[t(...).split(",")]` wrapped it in a one-element array, so MONTH_NAMES[month-1]
// was undefined for every month but January («…у undefined» in the greeting).
// A1: лінивий масив — обчислюється при зверненні, не при імпорті (див. lazyI18n.ts).
const MONTH_NAMES: readonly string[] = lazyArray(() => t("months").split(","));

// №4 (ідеї 01.09): порожній місяць — не привід ховати картку. Саме репетитора
// з тихим місяцем треба повернути: показуємо до трьох учнів, з якими давно не
// було уроку, і кнопку «Запланувати» біля кожного.
type ReconnectStudent = { id: string; name: string; daysAgo: number };

function useReconnectStudents(enabled: boolean) {
  const { user } = useAuth();
  const [students, setStudents] = useState<ReconnectStudent[] | null>(null);

  useEffect(() => {
    if (!enabled || !user) return;
    let alive = true;
    void (async () => {
      // Власні уроки (RLS і так віддає лише свої); групові (student_id null) — повз.
      const { data, error } = await supabase
        .from("lessons")
        .select("student_id, starts_at, status")
        .eq("tutor_id", user.id)
        .neq("status", "cancelled")
        .order("starts_at", { ascending: false })
        .limit(400);
      if (!alive || error || !data) { if (alive) setStudents([]); return; }
      const nowMs = Date.now();
      const lastPast = new Map<string, number>();
      const hasFuture = new Set<string>();
      for (const l of data as Array<{ student_id: string | null; starts_at: string; status: string }>) {
        if (!l.student_id) continue;
        const ts = new Date(l.starts_at).getTime();
        if (ts > nowMs) {
          if (l.status === "scheduled" || l.status === "pending") hasFuture.add(l.student_id);
        } else if (!lastPast.has(l.student_id)) {
          lastPast.set(l.student_id, ts); // список відсортований ↓ — перший минулий = останній урок
        }
      }
      const candidates = Array.from(lastPast.entries())
        .filter(([id, ts]) => !hasFuture.has(id) && nowMs - ts >= 14 * 86_400_000)
        .sort((a, b) => b[1] - a[1]) // нещодавно «згаслі» — найкращий шанс повернути
        .slice(0, 3);
      if (candidates.length === 0) { setStudents([]); return; }
      const ids = candidates.map(([id]) => id);
      const { data: profs } = await supabase
        .from("profiles").select("id, first_name, last_name").in("id", ids);
      if (!alive) return;
      const names = new Map((profs ?? []).map((p: any) => [p.id, `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim()]));
      setStudents(candidates.map(([id, ts]) => ({
        id,
        name: names.get(id) || t("roles.student"),
        daysAgo: Math.floor((nowMs - ts) / 86_400_000),
      })));
    })();
    return () => { alive = false; };
  }, [enabled, user?.id]);

  return students;
}

export function MonthlySummaryCard() {
  const { user } = useAuth();
  const { summary, loading, year, month } = useMonthlySummary();
  const [firstName, setFirstName] = useState<string>("");
  const cardRef = useRef<HTMLDivElement>(null);
  const [sharing, setSharing] = useState(false);
  const quietMonth = !loading && !!summary && summary.completed_count === 0;
  const reconnect = useReconnectStudents(quietMonth);

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("first_name").eq("id", user.id).maybeSingle()
      .then(({ data }) => { if (data?.first_name) setFirstName(data.first_name); });
  }, [user?.id]);

  if (loading) {
    return (
      <Card className="flex h-40 items-center justify-center rounded-[18px] border-[var(--ds-border,#eceef3)] shadow-none">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </Card>
    );
  }
  // Помилка RPC ≠ «місяць порожній»: без даних картки просто немає.
  if (!summary) return null;

  if (quietMonth) {
    // Тихий місяць показуємо лише коли є КОГО повернути — інакше картка
    // була б докором без дії (у новачка порожнечу веде онбординг, не вона).
    if (!reconnect || reconnect.length === 0) return null;
    const monthLabelQuiet = MONTH_NAMES[month - 1];
    return (
      <Card className="rounded-[18px] border-[var(--ds-border,#eceef3)] p-4 shadow-none">
        <p className="text-[15px] font-bold" style={{ color: "var(--ds-txt)" }}>
          {t("monthlySummaryExtra.quietTitle", { month: monthLabelQuiet })}
        </p>
        <p className="mt-1 text-[14px]" style={{ color: "var(--ds-sub)" }}>
          {t("monthlySummaryExtra.quietDesc")}
        </p>
        <div className="mt-3 space-y-2">
          {reconnect.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-[14px] px-3 py-2.5" style={{ background: "var(--ds-surface2,#fbfbfc)" }}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold" style={{ color: "var(--ds-txt)" }}>{s.name}</p>
                <p className="text-[13px]" style={{ color: "var(--ds-sub)" }}>{t("monthlySummaryExtra.quietAgo", { count: s.daysAgo })}</p>
              </div>
              <Link
                to={`/schedule?create=1&student=${s.id}`}
                className="flex h-10 shrink-0 items-center gap-1.5 rounded-[11px] px-3 text-[14px] font-bold text-white"
                style={{ background: "linear-gradient(135deg,#2BBFAA,#25a896)" }}
              >
                <CalendarPlus className="h-4 w-4" />
                {t("monthlySummaryExtra.quietCta")}
              </Link>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  const monthLabel = MONTH_NAMES[month - 1];
  const shareText = `${t("monthlySummaryExtra.shareText", { month: monthLabel, lessons: summary.completed_count })}\n${summary.on_time_payment_pct !== null ? `${t("monthlySummaryExtra.shareOnTime", { pct: summary.on_time_payment_pct })}\n` : ""}${summary.top_percentile && summary.top_percentile <= 50 ? `${t("monthlySummaryExtra.topPercentile", { pct: summary.top_percentile })}\n` : ""}\notutorhub.com`;

  const handleShare = async () => {
    setSharing(true);
    try {
      if (navigator.share) {
        await navigator.share({ title: t("monthlySummaryExtra.shareNavTitle"), text: shareText, url: "https://otutorhub.com" });
      } else {
        await navigator.clipboard.writeText(shareText);
        toast.success(t("monthlySummary.copied"));
      }
    } catch (e) {
      // user cancelled
    } finally {
      setSharing(false);
    }
  };

  const handleDownloadImage = async () => {
    if (!cardRef.current) return;
    setSharing(true);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(cardRef.current, { backgroundColor: null, scale: 2 });
      const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/png"));
      if (!blob) throw new Error("no blob");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `otutorhub-${year}-${String(month).padStart(2, "0")}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      toast.error(t("monthlySummary.imageFailed"));
    } finally {
      setSharing(false);
    }
  };

  return (
    <Card className="overflow-hidden rounded-[18px] border-[var(--ds-border,#eceef3)] shadow-none">
      <div
        ref={cardRef}
        className="relative bg-gradient-to-br from-primary via-primary to-primary/70 p-6 text-primary-foreground"
      >
        <div className="absolute right-3 top-3 text-[14px] opacity-70">oTutorHub</div>
        <div className="mb-1 text-sm opacity-90">
          {firstName ? t("monthlySummaryExtra.greeting", { name: firstName, month: monthLabel }) : t("monthlySummaryExtra.greetingNoName", { month: monthLabel })}
        </div>
        <div className="space-y-3">
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-bold">{summary.completed_count}</span>
            <span className="text-sm opacity-90">{t("monthlySummaryExtra.lessonsLabel")}</span>
          </div>
          {summary.on_time_payment_pct !== null && (
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{summary.on_time_payment_pct}%</span>
              <span className="text-sm opacity-90">{t("monthlySummaryExtra.paymentsLabel")}</span>
            </div>
          )}
          {summary.top_percentile && summary.top_percentile <= 50 && (
            <div className="inline-flex items-center gap-2 rounded-full bg-card/20 px-3 py-1.5 text-sm font-semibold backdrop-blur">
              {t("monthlySummaryExtra.topPercentile", { pct: summary.top_percentile })}
            </div>
          )}
        </div>
      </div>
      <div className="flex gap-2 p-3">
        <Button onClick={handleShare} disabled={sharing} className="flex-1">
          {sharing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Share2 className="mr-2 h-4 w-4" />}
          {t("monthlySummary.shareBtn")}
        </Button>
        <Button onClick={handleDownloadImage} variant="outline" disabled={sharing}>
          <Download className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}
