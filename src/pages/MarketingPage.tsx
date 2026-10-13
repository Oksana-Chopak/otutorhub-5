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
  | "expired"
  | "has_telegram";

/** Аудит 01.09: мітки рахувались один раз при завантаженні чанка і не
 *  перемальовувались при зміні мови. Тепер це ключі, а мітка береться в рендері. */
const SEGMENTS: { value: Segment; labelKey: string }[] = [
  { value: "all_independent", labelKey: "marketing.segmentAllIndependent" },
  { value: "trial", labelKey: "marketing.segmentTrial" },
  { value: "trial_ending_soon", labelKey: "marketing.segmentTrialEnding" },
  { value: "pro_active", labelKey: "marketing.segmentProActive" },
  { value: "expired", labelKey: "marketing.segmentExpired" },
  { value: "has_telegram", labelKey: "marketing.segmentHasTelegram" },
];

/**
 * 13.10 (пре-мортем, рішення власниці): усі зміни — одним оновленням, і тоді
 * одна розсилка «ось, користуйтеся». Шаблон кладе в поля готовий каркас листа
 * і Telegram-тексту; адмін лише править список змін. Текст тут українською
 * свідомо: розсилка йде українській базі, а не з мови інтерфейсу адміна.
 */
const UPDATE_PRESET = {
  subject: "Що нового в oTutorHub — оновлення застосунку",
  htmlBody: [
    "<p>Ми оновили застосунок — ось що змінилось:</p>",
    "<ul>",
    "<li><b>Нагадування без акаунта учня.</b> Натисни «Нагадати» → отримаєш посилання й готовий текст у Viber/Telegram/WhatsApp. Учень бачить борг, реквізити й кнопку «Я оплатив(ла)» — без реєстрації. Ти підтверджуєш одним дотиком.</li>",
    "<li><b>…</b></li>",
    "</ul>",
    "<p>Усе вже працює у вебі та в застосунку на телефоні.</p>",
    "<p><a href='https://otutorhub.com/'>Відкрити oTutorHub</a></p>",
    "<p>Якщо щось незручно — відповідай на цей лист, читаю кожен.</p>",
  ].join("\n"),
  telegramText: [
    "Ми оновили застосунок — ось що змінилось:",
    "",
    "• Нагадування без акаунта учня: «Нагадати» → посилання й готовий текст у Viber/Telegram/WhatsApp. Учень бачить борг, реквізити й кнопку «Я оплатив(ла)» без реєстрації; ти підтверджуєш одним дотиком.",
    "• …",
    "",
    "Відкрити: https://otutorhub.com/",
  ].join("\n"),
};

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
  channels?: string[] | null;
  telegram_text?: string | null;
  telegram_sent?: number | null;
  telegram_failed?: number | null;
}

interface LifecycleRow { kind: string; count: number; last_at: string | null }

export default function MarketingPage() {
  const { t } = useTranslation();
  const [segment, setSegment] = useState<Segment>("all_independent");
  const [subject, setSubject] = useState("");
  const [htmlBody, setHtmlBody] = useState("");
  const [telegramText, setTelegramText] = useState("");
  const [viaEmail, setViaEmail] = useState(true);
  const [viaTelegram, setViaTelegram] = useState(true);
  const [count, setCount] = useState<number | null>(null);
  const [countTelegram, setCountTelegram] = useState<number | null>(null);
  const [lifecycle, setLifecycle] = useState<LifecycleRow[] | null>(null);
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
    // 13.10: «*» — нові колонки (channels, telegram_*) зʼявляться в types.ts лише після
    // вставки SQL; до того вони читаються як необовʼязкові поля.
    const { data, error } = await supabase
      .from("marketing_campaigns")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    setCampaigns((data ?? []) as unknown as Campaign[]);
    setLoading(false);
  };

  const loadLifecycle = async () => {
    const { data, error } = await (supabase.rpc as any)("lifecycle_summary", { _days: 30 });
    if (error) { setLifecycle(null); return; }
    setLifecycle(Array.isArray(data) ? (data as LifecycleRow[]) : []);
  };

  useEffect(() => {
    loadCampaigns();
    loadLifecycle();
  }, []);

  const applyUpdatePreset = () => {
    setSubject(UPDATE_PRESET.subject);
    setHtmlBody(UPDATE_PRESET.htmlBody);
    setTelegramText(UPDATE_PRESET.telegramText);
    setViaEmail(true);
    setViaTelegram(true);
  };
  const channels = [viaEmail ? "email" : null, viaTelegram ? "telegram" : null].filter(Boolean) as string[];

  const checkCount = async () => {
    setLoadingCount(true);
    setCount(null);
    try {
      const { data, error } = await supabase.functions.invoke("send-marketing-campaign", {
        body: { subject: "preview", htmlBody: "preview", segment, dryRun: true },
      });
      if (error) throw error;
      setCount((data as any).count);
      setCountTelegram(typeof (data as any).telegram === "number" ? (data as any).telegram : null);
    } catch (e: any) {
      toast.error(e.message ?? t("marketing.countFailed"));
    } finally {
      setLoadingCount(false);
    }
  };

  const send = async () => {
    if (!channels.length) {
      toast.error(t("marketing.pickChannel"));
      return;
    }
    if (!subject.trim() || (viaEmail && !htmlBody.trim()) || (viaTelegram && !telegramText.trim() && !htmlBody.trim())) {
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
        body: { subject, htmlBody, telegramText, channels, segment, dryRun: false },
      });
      if (error) throw error;
      toast.success(`${t("marketing.started")} — ${t("marketing.recipientsCount", { count: (data as any).count })}`);
      setSubject("");
      setHtmlBody("");
      setTelegramText("");
      setCount(null);
      setCountTelegram(null);
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
                  {countTelegram !== null && <span className="ml-2 text-muted-foreground">· ✈ {countTelegram}</span>}
                </Button>
              </div>

              <div className="space-y-2">
                <Label>{t("marketing.channels")}</Label>
                <div className="flex flex-wrap gap-2">
                  <label className="flex items-center gap-2 rounded-[12px] border-[0.5px] border-border px-3 text-[15px]" style={{ minHeight: 44, cursor: "pointer" }}>
                    <input type="checkbox" checked={viaEmail} onChange={(e) => setViaEmail(e.target.checked)} style={{ width: 18, height: 18 }} />
                    ✉ {t("marketing.channelEmail")}
                  </label>
                  <label className="flex items-center gap-2 rounded-[12px] border-[0.5px] border-border px-3 text-[15px]" style={{ minHeight: 44, cursor: "pointer" }}>
                    <input type="checkbox" checked={viaTelegram} onChange={(e) => setViaTelegram(e.target.checked)} style={{ width: 18, height: 18 }} />
                    ✈ {t("marketing.channelTelegram")}
                  </label>
                  <Button type="button" variant="outline" size="sm" onClick={applyUpdatePreset} style={{ minHeight: 44 }}>
                    🆕 {t("marketing.presetUpdate")}
                  </Button>
                </div>
                <p className="text-[14px]" style={{ color: "var(--sub,#62677E)" }}>{t("marketing.channelsHint")}</p>
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
                <p className="text-[14px]" style={{ color: "var(--sub,#62677E)" }}>
                  {t("marketing.htmlHint")}
                </p>
              </div>

              {viaTelegram && (
                <div className="space-y-2">
                  <Label>{t("marketing.telegramText")}</Label>
                  <Textarea aria-label={t("marketing.telegramText")}
                    value={telegramText}
                    onChange={(e) => setTelegramText(e.target.value)}
                    rows={6}
                    placeholder={t("marketing.telegramPlaceholder")}
                    maxLength={3800}
                  />
                  <p className="text-[14px]" style={{ color: "var(--sub,#62677E)" }}>{t("marketing.telegramHint")}</p>
                </div>
              )}

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
            <CardTitle style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 17, letterSpacing: "-.01em" }}>{t("marketing.lifecycleTitle")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("marketing.lifecycleSubtitle")}</p>
          </CardHeader>
          <CardContent>
            {lifecycle === null ? (
              <p className="text-sm text-muted-foreground">{t("marketing.lifecycleUnavailable")}</p>
            ) : lifecycle.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("marketing.lifecycleEmpty")}</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {lifecycle.map((r) => (
                  <div key={r.kind} className="rounded-[12px] border-[0.5px] border-border bg-card px-3 py-2 text-[14px]">
                    <div className="font-semibold text-foreground">{t(`marketing.kind_${r.kind}`, { defaultValue: r.kind })}</div>
                    <div className="text-muted-foreground">{t("marketing.lifecycleCount", { count: r.count })}{r.last_at ? ` · ${new Date(r.last_at).toLocaleDateString(getLocale())}` : ""}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

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
                            <div className="text-[14px]" style={{ color: "var(--sub,#62677E)" }}>
                              {new Date(c.created_at).toLocaleString(getLocale())} • {SEGMENTS.find((x) => x.value === c.segment) ? t(SEGMENTS.find((x) => x.value === c.segment)!.labelKey) : c.segment}
                            </div>
                          </div>
                        </div>
                        <div className="text-right text-[14px] shrink-0">
                          <div className="font-semibold">
                            {(c.channels ?? ["email"]).includes("email") && <>✉ {c.recipients_sent}/{c.recipients_total}</>}
                            {(c.channels ?? []).includes("telegram") && <> · ✈ {c.telegram_sent ?? 0}</>}
                            {(c.recipients_failed > 0 || (c.telegram_failed ?? 0) > 0) && <span className="text-destructive"> ({t("marketing.failedCount", { count: c.recipients_failed + (c.telegram_failed ?? 0) })})</span>}
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

                          {c.telegram_text && (
                            <div>
                              <div className="text-[14px] font-semibold text-muted-foreground mb-1">{t("marketing.telegramText")}</div>
                              <pre className="whitespace-pre-wrap rounded border bg-background p-2 text-[14px] text-foreground" style={{ fontFamily: "inherit" }}>{c.telegram_text}</pre>
                            </div>
                          )}

                          <div>
                            <div className="text-[14px] font-semibold text-muted-foreground mb-1">
                              {t("marketing.deliveryErrors", { count: errs.length })}
                            </div>
                            {errs.length === 0 ? (
                              c.recipients_failed > 0 ? (
                                <p className="text-[14px]" style={{ color: "var(--sub,#62677E)" }}>
                                  {t("marketing.noErrorDetails")}
                                </p>
                              ) : (
                                <p className="text-[14px]" style={{ color: "var(--sub,#62677E)" }}>{t("marketing.allDelivered")}</p>
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
