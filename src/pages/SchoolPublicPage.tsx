import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Публічна сторінка школи — «Записатись до школи X» (11.11).
 *
 * Посилання, яке школа сама ставить в Instagram чи надсилає батькам. Без входу й без
 * лейауту застосунку. Показує лише те, що віддає `hub_public_page`: назву, кілька слів
 * про школу і предмети — жодних імен репетиторів, цін чи учнів. Заявка йде в
 * `hub_public_lead` (стелі й очищення тексту — у базі); акаунтів форма не створює.
 * Сторінки немає (вимкнена чи адреса хибна) → чесне «не знайдено», не порожня форма.
 */
type Page = { name: string; about: string | null; subjects: string[] };

export default function SchoolPublicPage() {
  const { slug } = useParams();
  const { t } = useTranslation();
  const [page, setPage] = useState<Page | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "sent">("loading");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [subject, setSubject] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (supabase.rpc as any)("hub_public_page", { _slug: slug ?? "" }).then(({ data, error }: { data: Page | null; error: unknown }) => {
      if (!alive) return;
      if (error || !data) { setState("missing"); return; }
      setPage({ name: data.name, about: data.about ?? null, subjects: Array.isArray(data.subjects) ? data.subjects : [] });
      setState("ready");
      try { document.title = `${data.name} — oTutorHub`; } catch { /* без документа */ }
    });
    return () => { alive = false; };
  }, [slug]);

  const submit = async () => {
    if (busy) return;
    setErr(null);
    if (name.trim().length < 2 || contact.trim().length < 5) { setErr(t("schoolPage.errFill")); return; }
    setBusy(true);
    try {
      const { data, error } = await (supabase.rpc as any)("hub_public_lead", {
        _slug: slug ?? "", _name: name, _contact: contact, _subject: subject || null, _note: note || null,
      });
      if (error) { setErr(t("schoolPage.errGeneric")); return; }
      if (data === "ok") setState("sent");
      else if (data === "invalid") setErr(t("schoolPage.errContact"));
      else if (data === "limit") setErr(t("schoolPage.errLimit"));
      else setErr(t("schoolPage.errGeneric"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ paddingInline: 16, paddingBlock: 24 }}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        {state === "loading" && (
          <div className="flex justify-center py-16" aria-busy="true"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        )}

        {state === "missing" && (
          <div className="rounded-[20px] border-[0.5px] border-border bg-card p-6 text-center">
            <p className="text-[20px] font-extrabold text-foreground">{t("schoolPage.missingTitle")}</p>
            <p className="mt-2 text-[15px] text-muted-foreground" style={{ lineHeight: 1.45 }}>{t("schoolPage.missingDesc")}</p>
          </div>
        )}

        {(state === "ready" || state === "sent") && page && (
          <>
            <h1 className="text-[26px] font-extrabold text-foreground" style={{ lineHeight: 1.15 }}>{page.name}</h1>
            {page.about && <p className="mt-2 text-[16px] text-muted-foreground" style={{ lineHeight: 1.5 }}>{page.about}</p>}
            {page.subjects.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2" aria-label={t("schoolPage.subjects")}>
                {page.subjects.map((s) => (
                  <span key={s} className="rounded-full border border-border bg-card px-3 py-1.5 text-[14px] font-semibold text-foreground">{s}</span>
                ))}
              </div>
            )}

            {state === "sent" ? (
              <div role="status" className="mt-6 rounded-[20px] border-[0.5px] border-border p-6 text-center" style={{ background: "var(--teal-l,#f0fdf9)" }}>
                <p className="text-[22px] font-extrabold text-foreground">🎉 {t("schoolPage.sentTitle")}</p>
                <p className="mt-2 text-[15px] text-muted-foreground" style={{ lineHeight: 1.45 }}>{t("schoolPage.sentDesc", { name: page.name })}</p>
              </div>
            ) : (
              <div className="mt-6 rounded-[20px] border-[0.5px] border-border bg-card p-5">
                <p className="text-[18px] font-extrabold text-foreground">{t("schoolPage.formTitle")}</p>
                <div className="mt-4 space-y-4">
                  <div>
                    <Label htmlFor="sp-name">{t("schoolPage.name")}</Label>
                    <Input id="sp-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" className="mt-1.5" />
                  </div>
                  <div>
                    <Label htmlFor="sp-contact">{t("schoolPage.contact")}</Label>
                    <Input id="sp-contact" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={80}
                      placeholder={t("schoolPage.contactPlaceholder")} className="mt-1.5" />
                  </div>
                  {page.subjects.length > 0 && (
                    <div>
                      <Label htmlFor="sp-subject">{t("schoolPage.subject")}</Label>
                      <select id="sp-subject" value={subject} onChange={(e) => setSubject(e.target.value)}
                        className="mt-1.5 h-11 w-full rounded-xl border-[0.5px] border-input bg-background px-3 text-[15px] text-foreground">
                        <option value="">{t("schoolPage.subjectAny")}</option>
                        {page.subjects.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <Label htmlFor="sp-note">{t("schoolPage.note")}</Label>
                    <Input id="sp-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300}
                      placeholder={t("schoolPage.notePlaceholder")} className="mt-1.5" />
                  </div>
                </div>
                {err && <p role="alert" className="mt-3 text-[14px] font-semibold text-destructive">{err}</p>}
                <button type="button" onClick={() => void submit()} disabled={busy}
                  className="mt-4 h-[50px] w-full rounded-[14px] text-[16px] font-semibold disabled:opacity-60"
                  style={{ background: "var(--teal)", color: "#0f0f1a" }}>
                  {t(busy ? "schoolPage.sending" : "schoolPage.send")}
                </button>
                <p className="mt-3 text-[13px] text-muted-foreground" style={{ lineHeight: 1.45 }}>{t("schoolPage.privacy", { name: page.name })}</p>
              </div>
            )}
          </>
        )}

        <p className="mt-8 text-center">
          <a href="/?from=school" className="inline-flex min-h-[44px] items-center text-[14px] font-semibold underline"
            style={{ color: "var(--teal-text,#1a7a6c)" }}>
            {t("schoolPage.poweredBy")}
          </a>
        </p>
      </div>
    </div>
  );
}
