import { useEffect, useMemo, useState } from "react";
import { getLocale } from "@/lib/locale";
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
import { confirmDialog } from "@/hooks/useConfirm";
import { Loader2, Send, Eye, Users, ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ErrorState } from "@/components/ErrorState";

type Segment =
  | "all_independent"
  | "trial"
  | "trial_ending_soon"
  | "pro_active"
  | "expired";

/** Аудит 01.09: мітки рахувались один раз при завантаженні чанка і не
 *  перемальовувались при зміні мови. Тепер це ключі, а мітка береться в рендері. */
const SEGMENTS: { value: Segment; labelKey: string }[] = [
  { value: "all_independent", labelKey: "marketing.segmentAllIndependent" },
  { value: "trial", labelKey: "marketing.segmentTrial" },
  { value: "trial_ending_soon", labelKey: "marketing.segmentTrialEnding" },
  { value: "pro_active", labelKey: "marketing.segmentProActive" },
  { value: "expired", labelKey: "marketing.segmentExpired" },
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
  const { t } = useTranslation();
  const [segment, setSegment] = useState<Segment>("all_independent");
  const [subject, setSubject] = useState("");
  const [htmlBody, setHtmlBody] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);
  const [sending, setSending] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  // Аудит 01.09: стану завантаження не було взагалі — історія блимала
  // «Поки нічого не надсилали» на кожному вході; помилка читання виглядала так само.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const previewHtml = useMemo(() => {
    // Convert plain newlines to <br> for preview display
    // (actual send uses htmlBody as-is, supporting raw HTML)
    const previewBody = htmlBody
      ? htmlBody.replace(/\n/g, '<br>')
      : `<em style='color:#888'>${t("marketing.previewBodyPlaceholder")}</em>`;

    return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#fff;padding:24px;border:1px solid #e5e5e5;border-radius:8px;">
      <p style="margin:0 0 12px;">${t("marketing.previewGreeting")}</p>
      <div style="font-size:15px;line-height:1.6;">${previewBody}</div>
      <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0 12px;">
      <p style="font-size:13px;color:#888;margin:0;">${t("marketing.previewUnsubscribe")}</p>
    </div>`;
  }, [htmlBody, t]);

  const loadCampaigns = async () => {
    setLoading(true);
    setLoadError(false);
    const { data, error } = await supabase
      .from("marketing_campaigns")
      .select("id, subject, segment, html_body, recipients_total, recipients_sent, recipients_failed, status, created_at, errors")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    setCampaigns((data ?? []) as Campaign[]);
    setLoading(false);
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
      toast.error(e.message ?? t("marketing.countFailed"));
    } finally {
      setLoadingCount(false);
    }
  };

  const send = async () => {
    if (!subject.trim() || !htmlBody.trim()) {
      toast.error(t("marketing.fillSubjectAndBody"));
      return;
    }
    const segLabel = t(SEGMENTS.find((x) => x.value === segment)?.labelKey ?? "");
    if (!(await confirmDialog({
      description: t("marketing.confirmSend", { segment: segLabel }),
      confirmText: t("marketing.send"),
      destructive: true,
    }))) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-marketing-campaign", {
        body: { subject, htmlBody, segment, dryRun: false },
      });
      if (error) throw error;
      toast.success(`${t("marketing.started")} — ${t("marketing.recipientsCount", { count: (data as any).count })}`);
      setSubject("");
      setHtmlBody("");
      setCount(null);
      setTimeout(loadCampaigns, 1500);
    } catch (e: any) {
      toast.error(e.message ?? t("marketing.sendFailed"));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="container mx-auto max-w-6xl space-y-6 py-6">
        {/* Mobile title comes from AppLayout's sticky header (with bell + burger);
            show this inline header only on desktop to avoid a duplicate + a header-less
            (nav-trapped) mobile page. */}
        <div className="hidden lg:block">
          <h1 style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 24, letterSpacing: "-.01em", color: "#0f0f1a" }}>{t("marketing.pageTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("marketing.pageSubtitle")}</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="rounded-[18px] border-[#eceef3] shadow-none">
            <CardHeader>
              <CardTitle style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 17, letterSpacing: "-.01em" }}>{t("marketing.newCampaign")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t("marketing.segment")}</Label>
                <Select value={segment} onValueChange={(v) => { setSegment(v as Segment); setCount(null); }}>
                  <SelectTrigger aria-label={t("marketing.segment")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SEGMENTS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{t(s.labelKey)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={checkCount} disabled={loadingCount}>
                  {loadingCount ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}
                  {t("marketing.countRecipients")} {count !== null && <span className="ml-2 font-semibold">{count}</span>}
                </Button>
              </div>

              <div className="space-y-2">
                <Label>{t("marketing.subject")}</Label>
                <Input aria-label={t("marketing.subject")}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={t("marketing.subjectPlaceholder")}
                  maxLength={200}
                />
              </div>

              <div className="space-y-2">
                <Label>{t("marketing.htmlBody")}</Label>
                <Textarea aria-label={t("marketing.htmlBody")}
                  value={htmlBody}
                  onChange={(e) => setHtmlBody(e.target.value)}
                  rows={12}
                  placeholder={t("marketing.htmlPlaceholder")}
                  maxLength={100000}
                />
                <p className="text-[14px]" style={{ color: "var(--sub,#666b82)" }}>
                  {t("marketing.htmlHint")}
                </p>
              </div>

              <Button onClick={send} disabled={sending} className="w-full">
                {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                {t("marketing.send")}
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-[18px] border-[#eceef3] shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2" style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 17, letterSpacing: "-.01em" }}><Eye className="h-4 w-4" /> {t("marketing.preview")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border bg-muted/30 p-4">
                <div className="mb-3 text-sm">
                  <span className="text-muted-foreground">{t("marketing.previewSubjectLabel")}</span>
                  <span className="font-medium">{subject || t("marketing.previewEmpty")}</span>
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

        <Card className="rounded-[18px] border-[#eceef3] shadow-none">
          <CardHeader>
            <CardTitle style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 17, letterSpacing: "-.01em" }}>{t("marketing.history")}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-14 animate-pulse rounded-md bg-muted" />
                ))}
              </div>
            ) : loadError ? (
              <ErrorState onRetry={() => void loadCampaigns()} />
            ) : campaigns.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("marketing.historyEmpty")}</p>
            ) : (
              <div className="space-y-2">
                {campaigns.map((c) => {
                  const isOpen = expandedId === c.id;
                  const errs = c.errors ?? [];
                  return (
                    <div key={c.id} className="rounded-md border text-sm">
                      <button
                        type="button"
                        onClick={() => setExpandedId(isOpen ? null : c.id)}
                        className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-muted/40"
                      >
                        <div className="flex items-start gap-2 min-w-0">
                          {isOpen ? <ChevronDown className="h-4 w-4 mt-0.5 shrink-0" /> : <ChevronRight className="h-4 w-4 mt-0.5 shrink-0" />}
                          <div className="min-w-0">
                            <div className="font-medium truncate">{c.subject}</div>
                            <div className="text-[14px]" style={{ color: "var(--sub,#666b82)" }}>
                              {new Date(c.created_at).toLocaleString(getLocale())} • {SEGMENTS.find((x) => x.value === c.segment) ? t(SEGMENTS.find((x) => x.value === c.segment)!.labelKey) : c.segment}
                            </div>
                          </div>
                        </div>
                        <div className="text-right text-[14px] shrink-0">
                          <div className="font-semibold">
                            {c.recipients_sent}/{c.recipients_total}
                            {c.recipients_failed > 0 && <span className="text-destructive"> ({t("marketing.failedCount", { count: c.recipients_failed })})</span>}
                          </div>
                          <div className="text-muted-foreground capitalize">{c.status}</div>
                        </div>
                      </button>

                      {isOpen && (
                        <div className="border-t bg-muted/20 p-3 space-y-3">
                          <div>
                            <div className="text-[14px] font-semibold text-muted-foreground mb-1">{t("marketing.bodyHtml")}</div>
                            <iframe
                              srcDoc={c.html_body}
                              sandbox=""
                              title={`Body of ${c.subject}`}
                              className="w-full min-h-[300px] rounded border bg-white"
                            />
                          </div>

                          <div>
                            <div className="text-[14px] font-semibold text-muted-foreground mb-1">
                              {t("marketing.deliveryErrors", { count: errs.length })}
                            </div>
                            {errs.length === 0 ? (
                              c.recipients_failed > 0 ? (
                                <p className="text-[14px]" style={{ color: "var(--sub,#666b82)" }}>
                                  {t("marketing.noErrorDetails")}
                                </p>
                              ) : (
                                <p className="text-[14px]" style={{ color: "var(--sub,#666b82)" }}>{t("marketing.allDelivered")}</p>
                              )
                            ) : (
                              <div className="space-y-1 max-h-64 overflow-auto">
                                {errs.map((e, i) => (
                                  <div key={i} className="rounded border bg-background p-2 text-[14px]">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-mono truncate">{e.email}</span>
                                      {e.status != null && (
                                        <span className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-destructive font-semibold">
                                          HTTP {e.status}
                                        </span>
                                      )}
                                    </div>
                                    <div className="mt-1 break-words text-muted-foreground whitespace-pre-wrap">
                                      {e.error || t("marketing.noMessage")}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
