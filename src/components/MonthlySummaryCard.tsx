import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Share2, Download, Loader2 } from "lucide-react";
import { useMonthlySummary } from "@/hooks/useTutorGamification";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const MONTH_NAMES = [
  "січень", "лютий", "березень", "квітень", "травень", "червень",
  "липень", "серпень", "вересень", "жовтень", "листопад", "грудень",
];

export function MonthlySummaryCard() {
  const { user } = useAuth();
  const { summary, loading, year, month } = useMonthlySummary();
  const [firstName, setFirstName] = useState<string>("");
  const cardRef = useRef<HTMLDivElement>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("first_name").eq("id", user.id).maybeSingle()
      .then(({ data }) => { if (data?.first_name) setFirstName(data.first_name); });
  }, [user?.id]);

  if (loading) {
    return (
      <Card className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </Card>
    );
  }
  if (!summary || summary.completed_count === 0) return null;

  const monthLabel = MONTH_NAMES[month - 1];
  const shareText = `Мій ${monthLabel} в oTutorHub:\n📚 ${summary.completed_count} уроків проведено\n${summary.on_time_payment_pct !== null ? `✅ ${summary.on_time_payment_pct}% оплат вчасно\n` : ""}${summary.top_percentile && summary.top_percentile <= 50 ? `🏆 Топ-${summary.top_percentile}% репетиторів\n` : ""}\notutorhub.com`;

  const handleShare = async () => {
    setSharing(true);
    try {
      if (navigator.share) {
        await navigator.share({ title: "Мій підсумок місяця", text: shareText, url: "https://otutorhub.com" });
      } else {
        await navigator.clipboard.writeText(shareText);
        toast.success("Скопійовано в буфер!");
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
      toast.error("Не вдалося згенерувати картинку");
    } finally {
      setSharing(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div
        ref={cardRef}
        className="relative bg-gradient-to-br from-primary via-primary to-primary/70 p-6 text-primary-foreground"
      >
        <div className="absolute right-3 top-3 text-xs opacity-70">oTutorHub</div>
        <div className="mb-1 text-sm opacity-90">
          {firstName ? `${firstName}, твій ${monthLabel}` : `Твій ${monthLabel}`}
        </div>
        <div className="space-y-3">
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-bold">{summary.completed_count}</span>
            <span className="text-sm opacity-90">уроків проведено 📚</span>
          </div>
          {summary.on_time_payment_pct !== null && (
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{summary.on_time_payment_pct}%</span>
              <span className="text-sm opacity-90">оплат вчасно ✅</span>
            </div>
          )}
          {summary.top_percentile && summary.top_percentile <= 50 && (
            <div className="inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1.5 text-sm font-semibold backdrop-blur">
              🏆 Топ-{summary.top_percentile}% репетиторів
            </div>
          )}
        </div>
      </div>
      <div className="flex gap-2 p-3">
        <Button onClick={handleShare} disabled={sharing} className="flex-1">
          {sharing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Share2 className="mr-2 h-4 w-4" />}
          Поділитись
        </Button>
        <Button onClick={handleDownloadImage} variant="outline" disabled={sharing}>
          <Download className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}
