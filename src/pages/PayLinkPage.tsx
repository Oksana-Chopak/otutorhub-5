import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import i18n from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { currencySymbol } from "@/lib/currency";
import { Loader2, Copy, Check } from "lucide-react";

/**
 * Публічна сторінка оплати за магічним посиланням — /pay/:token (13.10).
 *
 * Хто тут: учень або його батьки, БЕЗ входу, з посилання, яке переслав
 * репетитор (або яке лежало в автоматичному нагадуванні). Що бачать: хто
 * нагадує, які уроки не оплачені й скільки, реквізити з кнопкою «скопіювати»,
 * кнопка «Я оплатив(ла)» → заявка репетитору (підтверджує одним дотиком) —
 * і мʼяке запрошення створити акаунт учня (домашка, конспекти, історія).
 *
 * Мова — та, що в профілі учня (lang з відповіді), через getFixedT: глобальну
 * мову застосунку НЕ перемикаємо, бо репетитор може відкрити посилання на
 * своєму телефоні, щоб перевірити, як воно виглядає.
 *
 * Без AppLayout, без сесії, без запитів до бази з браузера — лише edge
 * `pay-link` (ліміти в базі, токен 256 біт).
 */
interface PayLesson { date: string; subject: string | null; amount: number; currency: string }
interface PayView {
  ok: boolean;
  reason?: string;
  tutor_name?: string;
  student_first_name?: string;
  lessons?: PayLesson[];
  total?: number;
  currency?: string;
  requisites?: string | null;
  pending_claim?: boolean;
  can_register?: boolean;
  lang?: string;
}

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL ?? ""}/functions/v1/pay-link`;

async function fetchView(token: string): Promise<PayView> {
  const r = await fetch(`${FN_URL}?t=${encodeURIComponent(token)}`, { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "" } });
  return (await r.json()) as PayView;
}
async function postClaim(token: string, amount: number, note: string): Promise<{ ok?: boolean; reason?: string }> {
  const r = await fetch(FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "" },
    body: JSON.stringify({ token, amount, note }),
  });
  return (await r.json()) as { ok?: boolean; reason?: string };
}

export default function PayLinkPage() {
  const { token = "" } = useParams();
  const [view, setView] = useState<PayView | null>(null);
  const [failed, setFailed] = useState(false);
  const [lang, setLang] = useState<string>("uk");
  const [tReady, setTReady] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | "ok" | "already" | "too_many" | "failed">(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const v = await fetchView(token);
        if (!alive) return;
        const l = (["uk", "en", "sv"] as const).find((x) => x === (v.lang ?? "uk")) ?? "uk";
        try { await i18n.loadLanguages(l); } catch { /* fallback — поточна мова */ }
        if (!alive) return;
        setLang(l);
        setTReady(true);
        setView(v);
        if (v.ok) setAmount(String(Math.round(Number(v.total ?? 0)) || ""));
      } catch {
        if (alive) { setTReady(true); setFailed(true); }
      }
    })();
    return () => { alive = false; };
  }, [token]);

  const t = useMemo(() => (tReady ? i18n.getFixedT(lang) : i18n.getFixedT("uk")), [lang, tReady]);
  const sym = currencySymbol(view?.currency ?? "UAH");
  const locale = lang === "sv" ? "sv-SE" : lang === "en" ? "en-GB" : "uk-UA";
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long" });

  const copyReq = async () => {
    try { await navigator.clipboard.writeText(view?.requisites ?? ""); setCopied(true); } catch { /* немає доступу до буфера */ }
  };
  const claim = async () => {
    const n = Number(String(amount).replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return;
    setBusy(true);
    try {
      const res = await postClaim(token, n, note);
      if (res.ok && res.reason === "already_pending") setDone("already");
      else if (res.ok) setDone("ok");
      else if (res.reason === "too_many") setDone("too_many");
      else setDone("failed");
    } catch { setDone("failed"); } finally { setBusy(false); }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-background text-foreground" style={{ paddingInline: 16, paddingBlock: 24 }}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <div className="flex items-center gap-2 mb-5">
          <span aria-hidden style={{ width: 28, height: 28, borderRadius: 9, background: "linear-gradient(135deg,#2BBFAA,#25a896)", display: "inline-block" }} />
          <span style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 17 }}>oTutorHub</span>
        </div>
        {children}
      </div>
    </div>
  );

  if (!view && !failed) {
    return shell(<div className="flex justify-center py-16" aria-busy="true"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>);
  }
  if (failed || !view?.ok) {
    return shell(
      <div className="rounded-[20px] bg-card border-[0.5px] border-border p-5">
        <p className="text-[20px] font-extrabold" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>{t("payLink.notFoundTitle")}</p>
        <p className="mt-2 text-[15px] text-muted-foreground">{t("payLink.notFoundDesc")}</p>
      </div>,
    );
  }

  const lessons = view.lessons ?? [];
  const total = Number(view.total ?? 0);
  const greet = view.student_first_name ? t("payLink.pageGreet", { name: view.student_first_name }) : t("payLink.pageGreetNoName");

  return shell(
    <>
      <div className="rounded-[20px] bg-card border-[0.5px] border-border p-5">
        <p className="text-[22px] font-extrabold" style={{ fontFamily: "Inter, system-ui, sans-serif", letterSpacing: "-.01em", lineHeight: 1.15 }}>{greet}</p>
        <p className="mt-1.5 text-[15px] text-muted-foreground">
          {view.tutor_name ? t("payLink.pageIntro", { tutor: view.tutor_name }) : t("payLink.pageIntroNoTutor")}
        </p>

        {lessons.length === 0 ? (
          <div className="mt-4 rounded-[14px] px-4 py-3 text-[15px] font-semibold" style={{ background: "rgba(34,197,94,.12)", color: "var(--success-text,#11803a)" }}>
            🎉 {t("payLink.allPaid")}
          </div>
        ) : (
          <>
            <ul className="mt-4 divide-y divide-border rounded-[14px] border-[0.5px] border-border overflow-hidden">
              {lessons.map((l, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-4 py-3 text-[15px]">
                  <span className="min-w-0">
                    <span className="font-semibold">{fmtDate(l.date)}</span>
                    {l.subject && <span className="text-muted-foreground"> · {l.subject}</span>}
                  </span>
                  <span className="font-bold whitespace-nowrap">{Math.round(Number(l.amount))} {currencySymbol(l.currency)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center justify-between text-[17px] font-extrabold" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
              <span>{t("payLink.total")}</span>
              <span>{Math.round(total)} {sym}</span>
            </div>
          </>
        )}

        {view.requisites ? (
          <div className="mt-5">
            <p className="text-[13px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{t("payLink.requisites")}</p>
            <div className="mt-2 flex items-start gap-2">
              <div className="min-w-0 flex-1 rounded-[14px] bg-secondary px-4 py-3 text-[15px] whitespace-pre-line break-words">{view.requisites}</div>
              <button type="button" onClick={copyReq} aria-label={t("payLink.copyRequisites")}
                className="bg-secondary text-foreground shrink-0" style={{ width: 46, height: 46, borderRadius: 12, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {copied ? <Check size={18} /> : <Copy size={18} />}
              </button>
            </div>
          </div>
        ) : lessons.length > 0 ? (
          <p className="mt-5 text-[14px] text-muted-foreground">{t("payLink.noRequisitesPage")}</p>
        ) : null}

        {lessons.length > 0 && (
          <div className="mt-5">
            {done === "ok" || done === "already" || view.pending_claim ? (
              <div className="rounded-[14px] px-4 py-3 text-[15px] font-semibold" style={{ background: "rgba(34,197,94,.12)", color: "var(--success-text,#11803a)" }}>
                ✅ {done === "already" || (view.pending_claim && !done) ? t("payLink.claimAlready") : t("payLink.claimThanks", { tutor: view.tutor_name ?? "" })}
              </div>
            ) : done === "too_many" ? (
              <div className="rounded-[14px] bg-secondary px-4 py-3 text-[15px] text-muted-foreground">{t("payLink.claimTooMany")}</div>
            ) : (
              <>
                <p className="text-[13px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{t("payLink.iPaidTitle")}</p>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    inputMode="decimal"
                    aria-label={t("payLink.amountLabel")}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="h-12 w-32 rounded-xl border-[0.5px] border-input bg-background px-3 text-[16px] text-foreground"
                  />
                  <span className="text-[15px] text-muted-foreground">{sym}</span>
                </div>
                <input
                  aria-label={t("payLink.noteLabel")}
                  placeholder={t("payLink.notePlaceholder")}
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 200))}
                  className="mt-2 h-12 w-full rounded-xl border-[0.5px] border-input bg-background px-3 text-[16px] text-foreground"
                />
                <button type="button" onClick={claim} disabled={busy || !(Number(String(amount).replace(",", ".")) > 0)}
                  className="bg-primary text-primary-foreground mt-3 w-full disabled:opacity-60"
                  style={{ height: 52, borderRadius: 14, border: "none", cursor: "pointer", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 16 }}>
                  {busy ? "…" : t("payLink.iPaidBtn")}
                </button>
                {done === "failed" && <p className="mt-2 text-[14px] text-destructive">{t("payLink.claimFailed")}</p>}
                <p className="mt-2 text-[13px] text-muted-foreground">{t("payLink.iPaidHint", { tutor: view.tutor_name ?? "" })}</p>
              </>
            )}
          </div>
        )}
      </div>

      {view.can_register && (
        <div className="mt-4 rounded-[20px] border-[0.5px] border-border p-5" style={{ background: "var(--teal-l,#f0fdf9)" }}>
          <p className="text-[17px] font-extrabold text-foreground" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>{t("payLink.registerTitle")}</p>
          <p className="mt-1 text-[14px] text-muted-foreground" style={{ lineHeight: 1.45 }}>{t("payLink.registerDesc")}</p>
          <Link to="/auth?signup=1&role=student"
            className="bg-primary text-primary-foreground mt-3 inline-flex w-full items-center justify-center"
            style={{ height: 48, borderRadius: 14, fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15, textDecoration: "none" }}>
            {t("payLink.registerBtn")}
          </Link>
        </div>
      )}
      <p className="mt-6 text-center text-[13px] text-muted-foreground">{t("payLink.footer")}</p>
    </>,
  );
}
