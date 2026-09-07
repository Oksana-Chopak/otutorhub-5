import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { logEvent } from "@/lib/analytics";

type HubRow = {
  id: string;
  name: string;
  created_at: string;
  managers: string[];   // імена менеджерів
  tutors: number;
  members: number;
};

/**
 * «Школи» в адмінці суперадміна (модель «школа = сутність», 07.09).
 *
 * Тут власниця платформи підключає нову онлайн-школу: назва + пошта
 * зареєстрованого користувача, який стане її менеджером (RPC create_hub —
 * лише суперадмін; роль manager видається там же). Перейменування — rename_hub.
 * Репетиторів школа додає сама в «Людях»; переносити між школами —
 * move_tutor_to_hub (поки без UI: рідкісна операція, є у SQL-редакторі).
 *
 * До застосування міграції таблиць немає — картка показує підказку, а не
 * помилку: адмінка лишається робочою.
 */
export function SchoolsCard() {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "missing" | "ready" | "error">("loading");
  const [hubs, setHubs] = useState<HubRow[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    const sb = supabase as any; // cast: hubs/hub_managers/hub_members — у типах після міграції
    const { data: hubRows, error } = await sb.from("hubs").select("id, name, created_at").order("created_at");
    if (error) {
      // 42P01 = таблиці ще немає (міграція не застосована) — це не збій адмінки.
      setState(String(error.code ?? "") === "42P01" || /hubs/.test(String(error.message ?? "")) ? "missing" : "error");
      return;
    }
    const [{ data: mgrs }, { data: tutors }, { data: members }] = await Promise.all([
      sb.from("hub_managers").select("hub_id, user_id"),
      sb.from("tutor_workspace_settings").select("tutor_id, hub_id").not("hub_id", "is", null),
      sb.from("hub_members").select("hub_id, user_id"),
    ]);
    const mgrIds: string[] = Array.from(new Set<string>((mgrs ?? []).map((m: any) => String(m.user_id))));
    const { data: profs } = mgrIds.length
      ? await supabase.from("profiles").select("id, first_name, last_name").in("id", mgrIds)
      : { data: [] as any[] };
    const nameOf = new Map<string, string>(
      (profs ?? []).map((p: any) => [p.id, `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "—"]),
    );
    setHubs(
      (hubRows ?? []).map((h: any) => ({
        id: h.id,
        name: h.name,
        created_at: h.created_at,
        managers: (mgrs ?? []).filter((m: any) => m.hub_id === h.id).map((m: any) => nameOf.get(m.user_id) ?? "—"),
        tutors: (tutors ?? []).filter((x: any) => x.hub_id === h.id).length,
        members: (members ?? []).filter((x: any) => x.hub_id === h.id).length,
      })),
    );
    setState("ready");
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    const nm = name.trim();
    const em = email.trim().toLowerCase();
    if (!nm || !em || busy) return;
    setBusy(true);
    try {
      // Пошта → профіль: суперадмін читає всі контакти (RLS через is_superadmin).
      const { data: contact } = await supabase
        .from("profile_contacts")
        .select("user_id")
        .ilike("email", em)
        .maybeSingle();
      if (!contact?.user_id) {
        toast.error(t("adminSchools.managerNotFound"));
        return;
      }
      const { data: hubId, error } = await (supabase as any).rpc("create_hub", { _name: nm, _manager: contact.user_id });
      if (error || !hubId) {
        const msg = String(error?.message ?? "");
        toast.error(/already manages/.test(msg) ? t("adminSchools.alreadyManager") : t("adminSchools.createFailed"));
        return;
      }
      logEvent("hub_created", { hub: hubId });
      toast.success(t("adminSchools.created", { name: nm }));
      setName("");
      setEmail("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const rename = async () => {
    if (!renaming || busy) return;
    const nm = renaming.name.trim();
    if (!nm) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc("rename_hub", { _hub: renaming.id, _name: nm });
      if (error) { toast.error(t("adminSchools.renameFailed")); return; }
      toast.success(t("adminSchools.renamed"));
      setRenaming(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const input = "h-11 w-full rounded-xl border-[0.5px] border-input bg-background px-3 text-[15px] text-foreground focus:outline-none focus:border-[#2BBFAA]";

  return (
    <section className="rounded-[16px] border-[0.5px] border-[var(--border)] bg-card p-4">
      <h2 className="text-[15px] font-bold">{t("adminSchools.title")}</h2>
      <p className="mt-1 text-[14px] text-muted-foreground">{t("adminSchools.subtitle")}</p>

      {state === "loading" && <div className="mt-3 h-[52px] animate-pulse rounded-[12px] bg-[var(--bg)]" />}
      {state === "missing" && <p className="mt-3 text-[14px] text-muted-foreground">{t("adminSchools.needsMigration")}</p>}
      {state === "error" && (
        <button type="button" className="mt-3 h-11 rounded-[12px] border px-4 text-[14px] font-semibold" onClick={() => void load()}>
          {t("adminSchools.retry")}
        </button>
      )}

      {state === "ready" && (
        <>
          <div className="mt-3 space-y-2">
            {hubs.length === 0 && <p className="text-[14px] text-muted-foreground">{t("adminSchools.empty")}</p>}
            {hubs.map((h) => (
              <div key={h.id} className="flex flex-wrap items-center gap-2 rounded-[12px] bg-[var(--bg)] p-3">
                {renaming?.id === h.id ? (
                  <>
                    <input
                      className={`${input} flex-1 min-w-[160px]`}
                      value={renaming.name}
                      onChange={(e) => setRenaming({ id: h.id, name: e.target.value })}
                      aria-label={t("adminSchools.renameLabel")}
                    />
                    <button type="button" onClick={() => void rename()} disabled={busy}
                      className="h-11 rounded-[12px] bg-[var(--teal)] px-4 text-[14px] font-semibold text-white">
                      {t("adminSchools.save")}
                    </button>
                    <button type="button" onClick={() => setRenaming(null)} className="h-11 rounded-[12px] border px-4 text-[14px] font-semibold">
                      {t("adminSchools.cancel")}
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-[15px] font-semibold">🏫 {h.name}</span>
                    <span className="text-[13px] text-muted-foreground">
                      {t("adminSchools.stats", { managers: h.managers.join(", ") || "—", tutors: h.tutors, members: h.members })}
                    </span>
                    <button type="button" onClick={() => setRenaming({ id: h.id, name: h.name })}
                      className="ml-auto h-11 rounded-[12px] border px-3 text-[13px] font-semibold" aria-label={t("adminSchools.renameLabel")}>
                      ✏️ {t("adminSchools.rename")}
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input className={input} value={name} onChange={(e) => setName(e.target.value)}
              placeholder={t("adminSchools.namePlaceholder")} aria-label={t("adminSchools.namePlaceholder")} />
            <input className={input} value={email} onChange={(e) => setEmail(e.target.value)} type="email"
              placeholder={t("adminSchools.emailPlaceholder")} aria-label={t("adminSchools.emailPlaceholder")} />
            <button type="button" onClick={() => void create()} disabled={busy || !name.trim() || !email.trim()}
              className="flex h-11 items-center justify-center gap-2 rounded-[12px] bg-[var(--teal)] px-4 text-[14px] font-semibold text-white disabled:opacity-50">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("adminSchools.create")}
            </button>
          </div>
          <p className="mt-2 text-[13px] text-muted-foreground">{t("adminSchools.hint")}</p>
        </>
      )}
    </section>
  );
}
