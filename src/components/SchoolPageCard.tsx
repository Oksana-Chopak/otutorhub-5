import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useHaptic } from "@/hooks/useHaptic";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { logEvent } from "@/lib/analytics";

/**
 * «Сторінка школи» в профілі менеджера (11.11): увімкнути публічну сторінку, сказати
 * кілька слів про школу, скопіювати чи поширити посилання — і тут же заявки, що
 * прийшли з неї. Сторінка вимкнена, доки менеджер сам її не ввімкне.
 *
 * Усе — через функції бази (`my_hub_public_page`, `set_hub_public_page`,
 * `resolve_hub_lead`). Поки їх у базі немає, картки немає: збій читання не показує
 * порожню рамку з мертвим перемикачем.
 */
type Lead = { id: string; name: string; contact: string; subject: string | null; note: string | null; status: "new" | "done"; created_at: string };
type State = { enabled: boolean; slug: string | null; about: string | null; name: string; leads: Lead[] };

export function SchoolPageCard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const haptic = useHaptic();
  const [st, setSt] = useState<State | null>(null);
  const [about, setAbout] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    void (supabase.rpc as any)("my_hub_public_page").then(({ data, error }: { data: State | null; error: unknown }) => {
      if (!alive || error || !data) return;
      setSt({ ...data, leads: Array.isArray(data.leads) ? data.leads : [] });
      setAbout(data.about ?? "");
    });
    return () => { alive = false; };
  }, [user?.id]);

  if (!st) return null;

  const url = st.slug ? `${window.location.origin}/s/${st.slug}` : "";

  const save = async (enabled: boolean, text: string | null) => {
    if (busy) return;
    setBusy(true);
    const prev = st;
    setSt({ ...st, enabled });                       // дотик видно одразу
    try {
      const { data, error } = await (supabase.rpc as any)("set_hub_public_page", { _enabled: enabled, _about: text });
      if (error || !data) { setSt(prev); toast.error(t("schoolPageCard.failed")); return; }
      setSt({ ...st, enabled: !!data.enabled, slug: data.slug ?? null, about: data.about ?? null });
      setAbout(data.about ?? "");
      haptic.success();
      if (enabled && !prev.enabled) logEvent("school_page_enabled");
      toast.success(t(enabled ? "schoolPageCard.savedOn" : "schoolPageCard.savedOff"));
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (!url) return;
    logEvent("school_page_shared");
    try {
      if (navigator.share) { await navigator.share({ title: st.name, text: t("schoolPageCard.shareText", { name: st.name }), url }); return; }
    } catch { /* людина закрила вікно «Поділитись» */ return; }
    try { await navigator.clipboard.writeText(url); toast.success(t("schoolPageCard.copied")); }
    catch { toast.error(t("schoolPageCard.failed")); }
  };

  const setLead = async (lead: Lead, done: boolean) => {
    const prev = st;
    setSt({ ...st, leads: st.leads.map((l) => (l.id === lead.id ? { ...l, status: done ? "done" : "new" } : l)) });
    const { data, error } = await (supabase.rpc as any)("resolve_hub_lead", { _id: lead.id, _done: done });
    if (error || data !== true) { setSt(prev); toast.error(t("schoolPageCard.failed")); }
  };

  const fresh = st.leads.filter((l) => l.status === "new");

  return (
    <section id="school-page" aria-label={t("schoolPageCard.title")}
      className="mb-4 rounded-[16px] border-[0.5px] border-[var(--border)] bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-extrabold text-foreground">🔗 {t("schoolPageCard.title")}</h2>
          <p className="mt-1 text-[14px] text-muted-foreground" style={{ lineHeight: 1.4 }}>{t("schoolPageCard.desc")}</p>
        </div>
        <span className="flex h-11 shrink-0 items-center">
          <Switch checked={st.enabled} disabled={busy} onCheckedChange={(v) => void save(v, about)} aria-label={t("schoolPageCard.toggle")} />
        </span>
      </div>

      {st.enabled && (
        <div className="mt-3 space-y-3">
          <div>
            <label htmlFor="school-page-about" className="text-sm font-medium text-foreground">{t("schoolPageCard.aboutLabel")}</label>
            <div className="mt-1.5 flex gap-2">
              <Input id="school-page-about" value={about} onChange={(e) => setAbout(e.target.value)} maxLength={400}
                placeholder={t("schoolPageCard.aboutPlaceholder")} />
              <button type="button" disabled={busy || about === (st.about ?? "")} onClick={() => void save(true, about)}
                className="h-11 shrink-0 rounded-[12px] border border-border bg-card px-3 text-[14px] font-semibold text-foreground disabled:opacity-50">
                {t("schoolPageCard.saveAbout")}
              </button>
            </div>
          </div>
          {url && (
            <div className="rounded-[12px] bg-secondary p-3">
              <p className="break-all text-[14px] font-semibold text-foreground">{url}</p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => void share()}
                  className="h-11 flex-1 rounded-[12px] text-[15px] font-semibold" style={{ background: "var(--teal)", color: "#0f0f1a" }}>
                  {t("schoolPageCard.share")}
                </button>
                <a href={url} target="_blank" rel="noreferrer"
                  className="flex h-11 items-center rounded-[12px] border border-border bg-card px-4 text-[15px] font-semibold text-foreground">
                  {t("schoolPageCard.open")}
                </a>
              </div>
            </div>
          )}
        </div>
      )}

      {st.leads.length > 0 && (
        <div className="mt-4">
          <p className="text-[13px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
            {t("schoolPageCard.leads", { count: fresh.length })}
          </p>
          <ul className="mt-2 space-y-2">
            {st.leads.slice(0, 20).map((l) => (
              <li key={l.id} className="rounded-[12px] border border-border p-3" style={l.status === "done" ? { opacity: 0.6 } : undefined}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-bold text-foreground">{l.name}</p>
                    <p className="mt-0.5 break-all text-[14px] text-foreground">{l.contact}</p>
                    {(l.subject || l.note) && (
                      <p className="mt-0.5 text-[14px] text-muted-foreground">{[l.subject, l.note].filter(Boolean).join(" · ")}</p>
                    )}
                  </div>
                  <button type="button" onClick={() => void setLead(l, l.status !== "done")}
                    className="h-11 shrink-0 rounded-[12px] border border-border bg-card px-3 text-[14px] font-semibold text-foreground">
                    {t(l.status === "done" ? "schoolPageCard.leadReopen" : "schoolPageCard.leadDone")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
