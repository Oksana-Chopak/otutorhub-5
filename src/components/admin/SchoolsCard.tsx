import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { logEvent } from "@/lib/analytics";
import { useAdminLens, type LensMode } from "@/hooks/useAdminLens";
import { purgeLocalCaches } from "@/lib/localCaches";
import { getLocale } from "@/lib/locale";

type HubRow = {
  id: string;
  name: string;
  created_at: string;
  managers: string[];   // імена менеджерів
  tutors: number;
  members: number;
  lessons30?: number;
  lastLessonAt?: string | null;
};

/**
 * «Школи» в адмінці суперадміна (модель «школа = сутність», 07.09; лінза — 11.11).
 *
 * Тут власниця платформи:
 *  • підключає нову онлайн-школу: назва + пошта зареєстрованої людини, яка стане її
 *    менеджером (RPC create_hub — лише суперадмін; роль manager видається там же);
 *  • бачить, чи школа ЖИВЕ (репетитори, учні, проведені уроки за 30 днів, останній урок);
 *  • перемикає ПОГЛЯД: своя школа · обрана школа · вся платформа — від нього залежить,
 *    що показують «Люди», «Фінанси», розклад (див. useAdminLens);
 *  • додає в школу репетитора, який уже має власний акаунт (move_tutor_to_hub):
 *    у «Людях» менеджер такого додати не може — пошта вже зайнята.
 *
 * Дані — одним RPC `admin_hubs_overview` (не залежить від погляду). До застосування
 * міграції 11.11 RPC немає — картка читає таблиці по-старому й ховає нові дії, тож
 * адмінка лишається робочою в будь-якому порядку «Publish ↔ SQL».
 */
export function SchoolsCard() {
  const { t } = useTranslation();
  const lens = useAdminLens();
  const [state, setState] = useState<"loading" | "missing" | "ready" | "error">("loading");
  const [hubs, setHubs] = useState<HubRow[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [adding, setAdding] = useState<{ id: string; email: string } | null>(null);

  const loadLegacy = useCallback(async () => {
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

  // Джерело — огляд із лінзи; якщо RPC ще немає в базі — старий шлях.
  useEffect(() => {
    if (lens.loading) return;
    if (lens.available) {
      setHubs(
        lens.hubs.map((h) => ({
          id: h.id,
          name: h.name,
          created_at: h.created_at,
          managers: (h.managers ?? []).map((m) => m ?? "—"),
          tutors: Number(h.tutors ?? 0),
          members: Number(h.students ?? 0),
          lessons30: Number(h.lessons_30d ?? 0),
          lastLessonAt: h.last_lesson_at ?? null,
        })),
      );
      setState("ready");
    } else {
      void loadLegacy();
    }
  }, [lens.loading, lens.available, lens.hubs, loadLegacy]);

  const load = useCallback(async () => {
    setState("loading");
    if (lens.available) await lens.reload();
    else await loadLegacy();
  }, [lens, loadLegacy]);

  /** Пошта → зареєстрований профіль (суперадмін читає контакти людей платформи). */
  const findRegistered = async (em: string): Promise<string | null> => {
    const { data: contact } = await supabase
      .from("profile_contacts")
      .select("user_id")
      .ilike("email", em)
      .maybeSingle();
    return contact?.user_id ?? null;
  };

  const create = async () => {
    const nm = name.trim();
    const em = email.trim().toLowerCase();
    if (!nm || !em || busy) return;
    setBusy(true);
    try {
      const managerId = await findRegistered(em);
      if (!managerId) {
        toast.error(t("adminSchools.managerNotFound"));
        return;
      }
      const { data: hubId, error } = await (supabase as any).rpc("create_hub", { _name: nm, _manager: managerId });
      if (error || !hubId) {
        const msg = String(error?.message ?? "");
        toast.error(
          /already manages/.test(msg) ? t("adminSchools.alreadyManager")
            : /already teaches/.test(msg) ? t("adminSchools.managerTeaches")
            : /registered profile/.test(msg) ? t("adminSchools.managerNotFound")
            : t("adminSchools.createFailed"),
        );
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

  /** Репетитор із власним акаунтом → у школу (у «Людях» його не додати: пошта зайнята). */
  const addExistingTutor = async () => {
    if (!adding || busy) return;
    const em = adding.email.trim().toLowerCase();
    if (!em) return;
    setBusy(true);
    try {
      const tutorId = await findRegistered(em);
      if (!tutorId) { toast.error(t("adminSchools.tutorNotFound")); return; }
      const { error } = await (supabase as any).rpc("move_tutor_to_hub", { _tutor: tutorId, _hub: adding.id });
      if (error) {
        const msg = String(error.message ?? "");
        toast.error(
          /own students/.test(msg) ? t("adminSchools.tutorHasOwnStudents")
            : /workspace not found|not a tutor/i.test(msg) ? t("adminSchools.tutorNotTutor")
            : t("adminSchools.tutorMoveFailed"),
        );
        return;
      }
      logEvent("hub_tutor_moved", { hub: adding.id });
      toast.success(t("adminSchools.tutorMoved"));
      setAdding(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const look = async (mode: LensMode, hubId?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await lens.setLens(mode, hubId ?? null);
      if (!ok) { toast.error(t("adminLens.switchFailed")); return; }
      logEvent("admin_lens_changed", { mode });
      // усе читання йде крізь RLS — після зміни погляду перечитуємо застосунок з нуля
      purgeLocalCaches();
      window.location.assign(mode === "all" ? "/admin" : "/dashboard");
    } finally {
      setBusy(false);
    }
  };

  const input = "h-11 w-full rounded-xl border-[0.5px] border-input bg-background px-3 text-[15px] text-foreground focus:outline-none focus:border-[#2BBFAA]";
  const ghostBtn = "h-11 rounded-[12px] border border-border bg-card px-3 text-[14px] font-semibold text-foreground disabled:opacity-60";
  const day = (iso: string) => new Date(iso).toLocaleDateString(getLocale(), { day: "numeric", month: "short" });

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
          {lens.available && (
            <div className="mt-3 rounded-[12px] bg-[var(--bg)] p-3">
              <p className="text-[14px] font-semibold">
                👁 {lens.mode === "all" ? t("adminLens.viewingAll")
                  : lens.mode === "hub" ? t("adminLens.viewingHub", { name: lens.viewHubName ?? "—" })
                  : t("adminLens.viewingOwn")}
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">{t("adminLens.hint")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {lens.mode !== "own" && (
                  <button type="button" disabled={busy} onClick={() => void look("own")} className={ghostBtn}>
                    {t("adminLens.backToOwn")}
                  </button>
                )}
                {lens.mode !== "all" && (
                  <button type="button" disabled={busy} onClick={() => void look("all")} className={ghostBtn}>
                    {t("adminLens.lookAll")}
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="mt-3 space-y-2">
            {hubs.length === 0 && <p className="text-[14px] text-muted-foreground">{t("adminSchools.empty")}</p>}
            {hubs.map((h) => {
              const isOwn = lens.available && h.id === lens.ownHubId;
              const isViewed = lens.available && ((lens.mode === "hub" && h.id === lens.viewHubId) || (lens.mode === "own" && isOwn));
              return (
                <div key={h.id} className="rounded-[12px] bg-[var(--bg)] p-3">
                  {renaming?.id === h.id ? (
                    <div className="flex flex-wrap items-center gap-2">
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
                      <button type="button" onClick={() => setRenaming(null)} className={ghostBtn}>
                        {t("adminSchools.cancel")}
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[15px] font-semibold">🏫 {h.name}</span>
                        {isOwn && <span className="rounded-full bg-card px-2 py-0.5 text-[13px] font-semibold text-muted-foreground">{t("adminSchools.ownBadge")}</span>}
                        {isViewed && <span className="rounded-full bg-[var(--teal-l)] px-2 py-0.5 text-[13px] font-semibold text-primary">{t("adminLens.viewedBadge")}</span>}
                      </div>
                      <p className="mt-1 text-[13px] text-muted-foreground">
                        {t("adminSchools.stats", { managers: h.managers.join(", ") || "—", tutors: h.tutors, members: h.members })}
                      </p>
                      {h.lessons30 != null && (
                        <p className="mt-0.5 text-[13px] text-muted-foreground">
                          {h.lastLessonAt
                            ? t("adminSchools.activity", { lessons: h.lessons30, last: day(h.lastLessonAt) })
                            : t("adminSchools.activityNone")}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {lens.available && !isViewed && (
                          <button type="button" disabled={busy} onClick={() => void look(isOwn ? "own" : "hub", h.id)} className={ghostBtn}>
                            👁 {t("adminLens.look")}
                          </button>
                        )}
                        <button type="button" onClick={() => setAdding(adding?.id === h.id ? null : { id: h.id, email: "" })} className={ghostBtn}>
                          ➕ {t("adminSchools.addTutor")}
                        </button>
                        <button type="button" onClick={() => setRenaming({ id: h.id, name: h.name })}
                          className={ghostBtn} aria-label={t("adminSchools.renameLabel")}>
                          ✏️ {t("adminSchools.rename")}
                        </button>
                      </div>
                      {adding?.id === h.id && (
                        <div className="mt-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              className={`${input} flex-1 min-w-[180px]`}
                              type="email"
                              value={adding.email}
                              onChange={(e) => setAdding({ id: h.id, email: e.target.value })}
                              placeholder={t("adminSchools.tutorEmailPlaceholder")}
                              aria-label={t("adminSchools.tutorEmailPlaceholder")}
                            />
                            <button type="button" onClick={() => void addExistingTutor()} disabled={busy || !adding.email.trim()}
                              className="flex h-11 items-center gap-2 rounded-[12px] bg-[var(--teal)] px-4 text-[14px] font-semibold text-white disabled:opacity-50">
                              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                              {t("adminSchools.addTutorConfirm")}
                            </button>
                          </div>
                          <p className="mt-1 text-[13px] text-muted-foreground">{t("adminSchools.addTutorHint")}</p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
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
