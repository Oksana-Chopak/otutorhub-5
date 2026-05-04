import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Copy, Check, Share2, HandHeart, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ReferralRow {
  id: string;
  referred_id: string;
  signed_up_at: string;
  upgraded_to_pro_at: string | null;
}

export function ReferralWidget({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const [code, setCode] = useState<string | null>(null);
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [savedUah, setSavedUah] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      let { data: codeRow } = await supabase
        .from("referral_codes").select("code").eq("tutor_id", user.id).maybeSingle();
      if (!codeRow) {
        const { data: newCode } = await supabase.rpc("generate_referral_code", { _tutor_id: user.id });
        if (newCode) codeRow = { code: newCode as string };
      }
      setCode(codeRow?.code ?? null);

      const { data: refs } = await supabase
        .from("referrals").select("id, referred_id, signed_up_at, upgraded_to_pro_at")
        .eq("referrer_id", user.id).order("signed_up_at", { ascending: false });
      setReferrals((refs ?? []) as ReferralRow[]);

      const { data: saved } = await supabase.rpc("get_referral_savings_uah", { _tutor_id: user.id });
      setSavedUah(Number(saved ?? 0));
      setLoading(false);
    })();
  }, [user?.id]);

  const link = code ? `${window.location.origin}/join/${code}` : "";
  const proUpgrades = referrals.filter((r) => r.upgraded_to_pro_at).length;
  const monthly = referrals.filter((r) => {
    if (!r.upgraded_to_pro_at) return false;
    const d = new Date(r.upgraded_to_pro_at);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const toReward = Math.max(0, 3 - monthly);
  const progress = Math.min(100, (monthly / 3) * 100);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    toast.success("Посилання скопійовано!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    const text = `Спробуй oTutorHub — застосунок для репетиторів. За моїм посиланням ти отримаєш +7 днів Pro безкоштовно: ${link}`;
    if (navigator.share) {
      try { await navigator.share({ title: "oTutorHub", text, url: link }); } catch {}
    } else {
      await navigator.clipboard.writeText(text);
      toast.success("Текст запрошення скопійовано!");
    }
  };

  if (loading) {
    return <Card className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></Card>;
  }

  return (
    <Card className="overflow-hidden">
      <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-5">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <HandHeart className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-bold text-foreground">Запроси колегу — отримай Pro</h3>
            <p className="text-xs text-muted-foreground">+7 днів обом · +1 міс за апгрейд</p>
          </div>
        </div>

        <div className="mb-3 flex gap-2">
          <Input value={link} readOnly className="font-mono text-xs" onClick={(e) => (e.target as HTMLInputElement).select()} />
          <Button onClick={handleCopy} variant="outline" size="icon" className="shrink-0">
            {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
          </Button>
          <Button onClick={handleShare} size="icon" className="shrink-0">
            <Share2 className="h-4 w-4" />
          </Button>
        </div>

        {!compact && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                Цього місяця: <strong className="text-foreground">{monthly} з 3</strong> до Pro на рік 🔥
              </span>
              <span className="font-semibold text-primary">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2" />
            {toReward > 0 ? (
              <p className="text-[11px] text-muted-foreground">
                Залишилось ще <strong>{toReward}</strong> {toReward === 1 ? "апгрейд" : "апгрейди"} до Pro на рік
              </p>
            ) : (
              <p className="text-[11px] font-semibold text-success">🎉 Ти заробив Pro на рік!</p>
            )}
          </div>
        )}
      </div>

      {!compact && referrals.length > 0 && (
        <div className="border-t border-border p-3 text-xs text-muted-foreground">
          Усього запрошень: <strong className="text-foreground">{referrals.length}</strong> · з Pro: <strong className="text-foreground">{proUpgrades}</strong>
        </div>
      )}
    </Card>
  );
}
