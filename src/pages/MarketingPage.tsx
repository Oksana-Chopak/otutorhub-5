import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Send, Eye, Users, ChevronDown, ChevronRight } from "lucide-react";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

type Segment =
  | "all_independent"
  | "trial"
  | "trial_ending_soon"
  | "pro_active"
  | "expired";

const SEGMENTS: { value: Segment; label: string }[] = [
  { value: "all_independent", label: "Усі незалежні репетитори" },
  { value: "trial", label: "На тріалі" },
  { value: "trial_ending_soon", label: "Тріал закінчується (≤3 днів)" },
  { value: "pro_active", label: "Активна Pro-підписка" },
  { value: "expired", label: "Закінчився тріал / підписка" },
];

interface Campaign {
  id: string;
  subject: string;
  segment: string;
  html_body: string;
  recipients_total: number;
  recipients_sent: number;
  recipients_failed: number;
  status: string;
  created_at: string;
  errors: Array<{ email: string; error: string; status?: number }> | null;
}

export default function MarketingPage() {
  const [segment, setSegment] = useState<Segment>("all_independent");
  const [subject, setSubject] = useState("");
  const [htmlBody, setHtmlBody] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);
  const [sending, setSending] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  const previewHtml = useMemo(() => {
    // Convert plain newlines to <br> for preview display
    // (actual send uses htmlBody as-is, supporting raw HTML)
    const previewBody = htmlBody
      ? htmlBody.replace(/\n/g, '<br>')
      : "<em style='color:#888'>Тіло листа з'явиться тут</em>";

    return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#fff;padding:24px;border:1px solid #e5e5e5;border-radius:8px;">
      <p style="margin:0 0 12px;">Привіт, [ім'я]!</p>
      <div style="font-size:15px;line-height:1.6;">${previewBody}</div>
      <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0 12px;">
      <p style="font-size:12px;color:#888;margin:0;">Відписатися від розсилок</p>
    </div>`;
  }, [htmlBody]);

  const loadCampaigns = async () => {
    const { data } = await supabase
      .from("marketing_campaigns")
      .select("id, subject, segment, recipients_total, recipients_sent, recipients_failed, status, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    setCampaigns((data ?? []) as Campaign[]);
  };

  useEffect(() => {
    loadCampaigns();
  }, []);

  const checkCount = async () => {
    setLoadingCount(true);
    setCount(null);
    try {
      const { data, error } = await supabase.functions.invoke("send-marketing-campaign", {
        body: { subject: "preview", htmlBody: "preview", segment, dryRun: true },
      });
      if (error) throw error;
      setCount((data as any).count);
    } catch (e: any) {
      toast.error(e.message ?? "Не вдалося порахувати одержувачів");
    } finally {
      setLoadingCount(false);
    }
  };

  const send = async () => {
    if (!subject.trim() || !htmlBody.trim()) {
      toast.error("Заповніть тему й тіло листа");
      return;
    }
    if (!confirm(`Надіслати листа сегменту "${SEGMENTS.find(s => s.value === segment)?.label}"?\n\nЦе незворотньо.`)) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-marketing-campaign", {
        body: { subject, htmlBody, segment, dryRun: false },
      });
      if (error) throw error;
      toast.success(`Розсилка запущена для ${(data as any).count} одержувачів`);
      setSubject("");
      setHtmlBody("");
      setCount(null);
      setTimeout(loadCampaigns, 1500);
    } catch (e: any) {
      toast.error(e.message ?? "Не вдалося надіслати");
    } finally {
      setSending(false);
    }
  };

  return (
    <AppLayout>
      <div className="container mx-auto max-w-6xl space-y-6 py-6">
        <div>
          <h1 className="text-2xl font-bold">Email-розсилки</h1>
          <p className="text-sm text-muted-foreground">Анонси та новини для самостійних репетиторів</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Нова розсилка</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Сегмент</Label>
                <Select value={segment} onValueChange={(v) => { setSegment(v as Segment); setCount(null); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SEGMENTS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={checkCount} disabled={loadingCount}>
                  {loadingCount ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}
                  Порахувати одержувачів {count !== null && <span className="ml-2 font-semibold">{count}</span>}
                </Button>
              </div>

              <div className="space-y-2">
                <Label>Тема листа</Label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Наприклад: Нові функції TutorHub"
                  maxLength={200}
                />
              </div>

              <div className="space-y-2">
                <Label>HTML-тіло</Label>
                <Textarea
                  value={htmlBody}
                  onChange={(e) => setHtmlBody(e.target.value)}
                  rows={12}
                  placeholder={'<p>Вітаємо!</p>\n<p>Розповідаємо про нові можливості…</p>\n<p><a href="https://otutorhub.com/dashboard">Перейти в кабінет</a></p>'}
                  maxLength={100000}
                />
                <p className="text-xs text-muted-foreground">
                  Підтримується HTML. Привітання та футер з посиланням на відписку додаються автоматично.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Підтримується HTML. Порожній рядок = новий абзац.
                </p>
              </div>

              <Button onClick={send} disabled={sending} className="w-full">
                {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Надіслати
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Eye className="h-4 w-4" /> Прев'ю</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border bg-muted/30 p-4">
                <div className="mb-3 text-sm">
                  <span className="text-muted-foreground">Тема: </span>
                  <span className="font-medium">{subject || "(порожньо)"}</span>
                </div>
                <iframe
                  srcDoc={previewHtml}
                  sandbox=""
                  title="Email preview"
                  className="w-full min-h-[400px] rounded border bg-white"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Історія розсилок</CardTitle>
          </CardHeader>
          <CardContent>
            {campaigns.length === 0 ? (
              <p className="text-sm text-muted-foreground">Поки нічого не надсилали.</p>
            ) : (
              <div className="space-y-2">
                {campaigns.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                    <div>
                      <div className="font-medium">{c.subject}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(c.created_at).toLocaleString("uk-UA")} • {SEGMENTS.find(s => s.value === c.segment)?.label ?? c.segment}
                      </div>
                    </div>
                    <div className="text-right text-xs">
                      <div className="font-semibold">
                        {c.recipients_sent}/{c.recipients_total}
                        {c.recipients_failed > 0 && <span className="text-destructive"> ({c.recipients_failed} помилок)</span>}
                      </div>
                      <div className="text-muted-foreground capitalize">{c.status}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
