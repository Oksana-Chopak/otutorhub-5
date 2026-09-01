import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState } from "@/components/EmptyState";
import { ShieldCheck, Trash2, RefreshCw, ChevronDown } from "lucide-react";
import { getLocale } from "@/lib/locale";
import { toast } from "sonner";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

interface ErrorRow {
  id: string;
  created_at: string;
  user_id: string | null;
  message: string;
  stack: string | null;
  url: string | null;
  user_agent: string | null;
}

export default function ErrorLogPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ErrorRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("error_log")
      .select("id, created_at, user_id, message, stack, url, user_agent")
      .order("created_at", { ascending: false })
      .limit(200);
    setRows((data ?? []) as ErrorRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const clearAll = async () => {
    const { error } = await (supabase as any)
      .from("error_log")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("errorLog.cleared"));
    setRows([]);
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold text-foreground sm:text-2xl">{t("errorLog.title")}</h1>
        {/* Desktop bell now comes from AppLayout (one global fixed bell) */}
      </div>

      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
          onClick={load}
          className="tap-44 inline-flex h-10 items-center gap-1.5 rounded-[12px] border border-border bg-card px-3 text-[14px] font-semibold text-muted-foreground transition-colors hover:bg-muted/40"
        >
          <RefreshCw className="h-4 w-4" /> {t("errorLog.refresh")}
        </button>
        {rows.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="tap-44 inline-flex h-10 items-center gap-1.5 rounded-[12px] border border-border bg-card px-3 text-[14px] font-semibold text-destructive transition-colors hover:bg-destructive/5"
          >
            <Trash2 className="h-4 w-4" /> {t("errorLog.clear")}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-[16px] border border-border bg-card p-3.5">
              <div className="h-4 w-3/4 animate-pulse rounded-md bg-muted" />
              <div className="mt-2 h-3 w-40 animate-pulse rounded-md bg-muted" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={ShieldCheck} title={t("errorLog.empty")} description={t("errorLog.emptyDesc")} actionLabel={null} />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => {
            const on = openId === r.id;
            return (
              <div key={r.id} className="rounded-[16px] border border-border bg-card">
                <button
                  type="button"
                  onClick={() => setOpenId(on ? null : r.id)}
                  className="flex w-full items-start gap-3 p-3.5 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-[15px] font-semibold text-foreground">{r.message}</p>
                    <p className="mt-1 text-[14px] text-muted-foreground">
                      {new Date(r.created_at).toLocaleString(getLocale())}
                      {r.url ? ` · ${r.url}` : ""}
                    </p>
                  </div>
                  {r.stack && (
                    <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${on ? "rotate-180" : ""}`} />
                  )}
                </button>
                {on && (r.stack || r.user_agent) && (
                  <div className="border-t border-border bg-muted/30 p-3">
                    {r.stack && (
                      <pre className="overflow-x-auto whitespace-pre-wrap text-[14px] leading-relaxed text-muted-foreground">{r.stack}</pre>
                    )}
                    {r.user_agent && (
                      <p className="mt-2 text-[14px] text-muted-foreground/70">{r.user_agent}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
