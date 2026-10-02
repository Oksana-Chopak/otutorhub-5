/**
 * Здоровʼя продукту (02.10) — те, що власниця має бачити щодня:
 *   • воронка когорт: зареєструвались → учень → урок → AHA (перша позначена
 *     оплата чи поповнення) → живі на 7-й/30-й день → платять → відвалились;
 *   • DAU / WAU / MAU за ролями і 14 днів активності (з app_events);
 *   • помилки за 24 год групами, НОВІ — першими;
 *   • прапорці функцій — вимкнути/увімкнути без релізу.
 * Усе читається прямо з бази під JWT суперадміна (RPC з 20261002120000).
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { invalidateFeatureFlags } from "@/lib/featureFlags";

interface Cohort { week: string; signed: number; added_student: number; created_lesson: number; aha: number; retained_d7: number; retained_d30: number; paying: number; churned: number }
interface Active { role: string; dau: number; wau: number; mau: number }
interface Daily { d: string; active_users: number }
interface Funnel { weeks: number; cohorts: Cohort[]; active: Active[]; daily: Daily[] }
interface ErrorGroup { signature: string; sample: string; hits: number; users: number; first_seen: string; last_seen: string; url: string | null; is_new: boolean }
interface Flag { key: string; enabled: boolean; rollout_pct: number; allow_users: string[]; description: string | null }

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  // RPC з міграції 20261002120000 — до перегенерації types.ts через (rpc as any)
  const { data, error } = await (supabase.rpc as any)(name, args);
  if (error) throw error;
  return data as T;
}

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

export function ProductHealth() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const funnel = useQuery({ queryKey: ["admin-funnel"], queryFn: () => rpc<Funnel>("admin_product_funnel", { _weeks: 8 }), staleTime: 60_000 });
  const errors = useQuery({ queryKey: ["admin-error-groups"], queryFn: () => rpc<ErrorGroup[]>("error_groups", { _hours: 24, _limit: 20 }), staleTime: 60_000 });
  const flags = useQuery({
    queryKey: ["admin-flags"],
    queryFn: async () => {
      // таблиця з міграції 20261002120000 — до перегенерації types.ts через (from as any)
      const { data, error } = await (supabase.from as any)("feature_flags").select("key, enabled, rollout_pct, allow_users, description").order("key");
      if (error) throw error;
      return (data ?? []) as Flag[];
    },
    staleTime: 30_000,
  });
  const [savingKey, setSavingKey] = useState<string | null>(null);
  useEffect(() => { if (funnel.error) toast.error(t("adminProduct.loadFailed")); }, [funnel.error, t]);

  const toggleFlag = async (f: Flag) => {
    setSavingKey(f.key);
    try {
      const { error } = await (supabase.from as any)("feature_flags").update({ enabled: !f.enabled, updated_at: new Date().toISOString() }).eq("key", f.key);
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["admin-flags"] });
      invalidateFeatureFlags();
      toast.success(t(f.enabled ? "adminProduct.flagOff" : "adminProduct.flagOn", { key: f.key }));
    } catch {
      toast.error(t("adminProduct.flagFailed"));
    } finally {
      setSavingKey(null);
    }
  };
  const setRollout = async (f: Flag, value: number) => {
    setSavingKey(f.key);
    try {
      const { error } = await (supabase.from as any)("feature_flags").update({ rollout_pct: value, updated_at: new Date().toISOString() }).eq("key", f.key);
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["admin-flags"] });
    } catch {
      toast.error(t("adminProduct.flagFailed"));
    } finally {
      setSavingKey(null);
    }
  };

  const card = "rounded-[16px] border border-[var(--border)] bg-white p-4";
  const maxDaily = Math.max(1, ...(funnel.data?.daily ?? []).map((d) => d.active_users));

  return (
    <div className="space-y-4" data-testid="product-health">
      <section className={card}>
        <h2 className="text-[15px] font-bold">{t("adminProduct.funnelTitle")}</h2>
        <p className="mt-1 text-[13px] text-[var(--sub)]">{t("adminProduct.funnelHint")}</p>
        {funnel.isLoading ? <p className="mt-3 text-[13px] text-[var(--sub)]">{t("adminProduct.loading")}</p> : funnel.data?.cohorts.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead><tr className="text-left text-[var(--sub)]">
                {["week", "signed", "student", "lesson", "aha", "d7", "d30", "paying", "churned"].map((k) => (
                  <th key={k} className="py-1 pr-2 whitespace-nowrap">{t(`adminProduct.col_${k}`)}</th>
                ))}
              </tr></thead>
              <tbody>
                {funnel.data.cohorts.map((c) => (
                  <tr key={c.week} className="border-t border-[var(--border)]">
                    <td className="py-1.5 pr-2 font-medium whitespace-nowrap">{c.week}</td>
                    <td className="pr-2 font-bold">{c.signed}</td>
                    <td className="pr-2">{c.added_student} <span className="text-[var(--sub)]">{pct(c.added_student, c.signed)}</span></td>
                    <td className="pr-2">{c.created_lesson} <span className="text-[var(--sub)]">{pct(c.created_lesson, c.signed)}</span></td>
                    <td className="pr-2 font-bold text-emerald-700">{c.aha} <span className="font-normal text-[var(--sub)]">{pct(c.aha, c.signed)}</span></td>
                    <td className="pr-2">{c.retained_d7} <span className="text-[var(--sub)]">{pct(c.retained_d7, c.signed)}</span></td>
                    <td className="pr-2">{c.retained_d30} <span className="text-[var(--sub)]">{pct(c.retained_d30, c.signed)}</span></td>
                    <td className="pr-2">{c.paying}</td>
                    <td className="pr-2 text-red-700">{c.churned} <span className="text-[var(--sub)]">{pct(c.churned, c.signed)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="mt-3 text-[13px] text-[var(--sub)]">{t("adminProduct.empty")}</p>}
      </section>

      <section className={card}>
        <h2 className="text-[15px] font-bold">{t("adminProduct.activeTitle")}</h2>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(funnel.data?.active ?? []).map((a) => (
            <div key={a.role} className="rounded-[12px] bg-[var(--bg)] p-3">
              <div className="text-[13px] font-semibold text-[var(--sub)]">{t(`adminProduct.role_${a.role}`, { defaultValue: a.role })}</div>
              <div className="mt-1 flex items-baseline gap-3">
                <span><b className="text-[18px]">{a.dau}</b> <span className="text-[13px] text-[var(--sub)]">DAU</span></span>
                <span><b className="text-[18px]">{a.wau}</b> <span className="text-[13px] text-[var(--sub)]">WAU</span></span>
                <span><b className="text-[18px]">{a.mau}</b> <span className="text-[13px] text-[var(--sub)]">MAU</span></span>
              </div>
            </div>
          ))}
          {!funnel.isLoading && !(funnel.data?.active ?? []).length && <p className="text-[13px] text-[var(--sub)]">{t("adminProduct.activeEmpty")}</p>}
        </div>
        {!!funnel.data?.daily.length && (
          <div className="mt-4 flex h-[72px] items-end gap-1" aria-label={t("adminProduct.dailyLabel")}>
            {funnel.data.daily.map((d) => (
              <div key={d.d} className="flex flex-1 flex-col items-center gap-1" title={`${d.d}: ${d.active_users}`}>
                <div className="w-full rounded-t bg-[var(--teal,#2BBFAA)]" style={{ height: `${Math.max(2, (d.active_users / maxDaily) * 56)}px` }} />
                <span className="text-[13px] text-[var(--sub)]">{d.d.slice(8)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={card}>
        <h2 className="text-[15px] font-bold">{t("adminProduct.errorsTitle")}</h2>
        <p className="mt-1 text-[13px] text-[var(--sub)]">{t("adminProduct.errorsHint")}</p>
        {errors.isLoading ? <p className="mt-3 text-[13px] text-[var(--sub)]">{t("adminProduct.loading")}</p> : (errors.data ?? []).length === 0 ? (
          <p className="mt-3 text-[14px] font-medium text-emerald-700">{t("adminProduct.errorsNone")}</p>
        ) : (
          <div className="mt-3 space-y-2">
            {(errors.data ?? []).map((g) => (
              <div key={g.signature} className={`rounded-[12px] p-3 ${g.is_new ? "bg-red-50" : "bg-[var(--bg)]"}`}>
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  {g.is_new && <span className="rounded-full bg-red-600 px-2 py-0.5 text-[13px] font-bold text-white">{t("adminProduct.errorNew")}</span>}
                  <b>×{g.hits}</b>
                  <span className="text-[var(--sub)]">{t("adminProduct.errorUsers", { count: g.users })}</span>
                  {g.url && <span className="text-[var(--sub)]">{g.url}</span>}
                  <span className="text-[var(--sub)]">{new Date(g.last_seen).toLocaleString()}</span>
                </div>
                <div className="mt-1 break-words font-mono text-[13px]">{g.sample}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={card}>
        <h2 className="text-[15px] font-bold">{t("adminProduct.flagsTitle")}</h2>
        <p className="mt-1 text-[13px] text-[var(--sub)]">{t("adminProduct.flagsHint")}</p>
        <div className="mt-3 space-y-2">
          {(flags.data ?? []).map((f) => (
            <div key={f.key} className="flex flex-wrap items-center gap-3 rounded-[12px] bg-[var(--bg)] p-3">
              <button type="button" role="switch" aria-checked={f.enabled} aria-label={f.key} disabled={savingKey === f.key} onClick={() => void toggleFlag(f)}
                className={`tap-44 min-w-[64px] rounded-full px-3 text-[13px] font-bold ${f.enabled ? "bg-emerald-600 text-white" : "bg-[var(--border)] text-[var(--sub)]"}`}>
                {f.enabled ? t("adminProduct.on") : t("adminProduct.off")}
              </button>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[13px]">{f.key}</div>
                {f.description && <div className="text-[13px] text-[var(--sub)]">{f.description}</div>}
              </div>
              <label className="flex items-center gap-2 text-[13px] text-[var(--sub)]">
                {t("adminProduct.rollout")}
                <select aria-label={`${f.key} %`} className="h-9 rounded-md border border-[var(--border)] bg-white px-2 text-[13px]" value={f.rollout_pct} disabled={savingKey === f.key} onChange={(e) => void setRollout(f, Number(e.target.value))}>
                  {[0, 10, 25, 50, 100].map((v) => <option key={v} value={v}>{v}%</option>)}
                </select>
              </label>
            </div>
          ))}
          {!flags.isLoading && !(flags.data ?? []).length && <p className="text-[13px] text-[var(--sub)]">{t("adminProduct.flagsEmpty")}</p>}
        </div>
      </section>
    </div>
  );
}
