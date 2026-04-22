import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShieldAlert, Download, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";

type AuditEntry = {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
};

type ProfileLite = { id: string; first_name: string; last_name: string };

const actionLabels: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  "role.assigned": { label: "Призначено роль", variant: "default" },
  "role.updated": { label: "Змінено роль", variant: "secondary" },
  "role.removed": { label: "Видалено роль", variant: "destructive" },
  "profile.deleted": { label: "Видалено профіль", variant: "destructive" },
  "lesson.financials_updated": { label: "Оновлено фінанси уроку", variant: "secondary" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("uk-UA");
}

function nameOf(profiles: Map<string, ProfileLite>, id: string | null) {
  if (!id) return "—";
  const p = profiles.get(id);
  if (!p) return id.slice(0, 8);
  return `${p.first_name} ${p.last_name}`.trim() || id.slice(0, 8);
}

// Diff helper: compute key-level changes between two JSON objects
function computeDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): Array<{ key: string; before: unknown; after: unknown; kind: "added" | "removed" | "changed" | "same" }> {
  const keys = new Set<string>([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  const out: Array<{ key: string; before: unknown; after: unknown; kind: "added" | "removed" | "changed" | "same" }> = [];
  keys.forEach((k) => {
    const b = before?.[k];
    const a = after?.[k];
    if (b === undefined && a !== undefined) out.push({ key: k, before: b, after: a, kind: "added" });
    else if (a === undefined && b !== undefined) out.push({ key: k, before: b, after: a, kind: "removed" });
    else if (JSON.stringify(b) !== JSON.stringify(a)) out.push({ key: k, before: b, after: a, kind: "changed" });
    else out.push({ key: k, before: b, after: a, kind: "same" });
  });
  return out;
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

type Period = "all" | "today" | "7d" | "30d";

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [profiles, setProfiles] = useState<Map<string, ProfileLite>>(new Map());
  const [loading, setLoading] = useState(true);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  // Filters
  const [actorFilter, setActorFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [periodFilter, setPeriodFilter] = useState<Period>("all");
  const [search, setSearch] = useState<string>("");

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("manager_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) {
        toast.error("Не вдалося завантажити журнал");
        setLoading(false);
        return;
      }
      const rows = (data ?? []) as AuditEntry[];
      setEntries(rows);

      const ids = new Set<string>();
      rows.forEach((r) => {
        if (r.actor_id) ids.add(r.actor_id);
        if (r.entity_id && (r.entity_type === "profile" || r.entity_type === "user_role")) {
          ids.add(r.entity_id);
        }
      });
      if (ids.size > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, first_name, last_name")
          .in("id", Array.from(ids));
        const map = new Map<string, ProfileLite>();
        (profs ?? []).forEach((p) => map.set(p.id, p as ProfileLite));
        setProfiles(map);
      }
      setLoading(false);
    };
    load();
  }, []);

  const actorOptions = useMemo(() => {
    const set = new Map<string, string>();
    entries.forEach((e) => {
      if (e.actor_id) set.set(e.actor_id, nameOf(profiles, e.actor_id));
    });
    return Array.from(set.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "uk"));
  }, [entries, profiles]);

  const actionOptions = useMemo(() => {
    return Array.from(new Set(entries.map((e) => e.action))).sort();
  }, [entries]);

  const entityOptions = useMemo(() => {
    return Array.from(new Set(entries.map((e) => e.entity_type))).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const now = Date.now();
    let cutoff = 0;
    if (periodFilter === "today") {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      cutoff = d.getTime();
    } else if (periodFilter === "7d") {
      cutoff = now - 7 * 24 * 60 * 60 * 1000;
    } else if (periodFilter === "30d") {
      cutoff = now - 30 * 24 * 60 * 60 * 1000;
    }
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (actorFilter !== "all" && e.actor_id !== actorFilter) return false;
      if (actionFilter !== "all" && e.action !== actionFilter) return false;
      if (entityFilter !== "all" && e.entity_type !== entityFilter) return false;
      if (cutoff && new Date(e.created_at).getTime() < cutoff) return false;
      if (q) {
        const blob = `${nameOf(profiles, e.actor_id)} ${e.action} ${e.entity_type} ${
          JSON.stringify(e.before ?? "")
        } ${JSON.stringify(e.after ?? "")}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [entries, actorFilter, actionFilter, entityFilter, periodFilter, search, profiles]);

  const toggleOpen = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exportCsv = () => {
    const header = ["Час", "Актор", "Дія", "Сутність", "Сутність ID", "Before", "After"];
    const rows = filtered.map((e) => [
      formatDate(e.created_at),
      nameOf(profiles, e.actor_id),
      e.action,
      e.entity_type,
      e.entity_id ?? "",
      e.before ? JSON.stringify(e.before) : "",
      e.after ? JSON.stringify(e.after) : "",
    ]);
    const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((r) => r.map(escape).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("CSV завантажено");
  };

  const filtersActive =
    actorFilter !== "all" ||
    actionFilter !== "all" ||
    entityFilter !== "all" ||
    periodFilter !== "all" ||
    search.trim().length > 0;

  return (
    <AppLayout>
      <div className="space-y-6">
        <header className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-7 w-7 text-primary" />
            <div>
              <h1 className="font-display text-2xl font-bold text-foreground">
                Журнал аудиту
              </h1>
              <p className="text-sm text-muted-foreground">
                Чутливі дії менеджерів: ролі, видалення, фінанси
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="h-4 w-4 mr-1.5" />
            Експорт CSV
          </Button>
        </header>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Пошук…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 max-w-[220px] text-xs"
          />
          <Select value={actorFilter} onValueChange={setActorFilter}>
            <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue placeholder="Актор" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Всі актори</SelectItem>
              {actorOptions.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder="Дія" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Всі дії</SelectItem>
              {actionOptions.map((a) => (
                <SelectItem key={a} value={a}>{actionLabels[a]?.label ?? a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Сутність" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Всі сутності</SelectItem>
              {entityOptions.map((a) => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={periodFilter} onValueChange={(v) => setPeriodFilter(v as Period)}>
            <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue placeholder="Період" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Весь час</SelectItem>
              <SelectItem value="today">Сьогодні</SelectItem>
              <SelectItem value="7d">7 днів</SelectItem>
              <SelectItem value="30d">30 днів</SelectItem>
            </SelectContent>
          </Select>
          {filtersActive && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => {
                setActorFilter("all");
                setActionFilter("all");
                setEntityFilter("all");
                setPeriodFilter("all");
                setSearch("");
              }}
            >
              Скинути
            </Button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {filtered.length} з {entries.length}
          </span>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ShieldAlert}
            title={entries.length === 0 ? "Поки що немає записів" : "Нічого не знайдено"}
            description={
              entries.length === 0
                ? "Тут з'являться дії менеджера: зміна ролей, видалення профілів, оновлення платежів."
                : "Спробуйте змінити фільтри або скинути їх."
            }
          />
        ) : (
          <div className="space-y-2">
            {filtered.map((e) => {
              const meta = actionLabels[e.action] ?? { label: e.action, variant: "outline" as const };
              const target =
                e.entity_type === "profile" || e.entity_type === "user_role"
                  ? nameOf(profiles, e.entity_id)
                  : e.entity_id?.slice(0, 8) ?? "—";
              const hasPayload = !!(e.before || e.after);
              const isOpen = openIds.has(e.id);
              const diff = hasPayload ? computeDiff(e.before, e.after) : [];
              return (
                <Card key={e.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(e.created_at)}
                        </span>
                      </div>
                      <p className="text-sm text-foreground">
                        <span className="font-medium">{nameOf(profiles, e.actor_id)}</span>
                        {" → "}
                        <span className="text-muted-foreground">{e.entity_type}:</span>{" "}
                        <span className="font-medium">{target}</span>
                      </p>
                    </div>
                    {hasPayload && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => toggleOpen(e.id)}
                      >
                        {isOpen ? (
                          <>
                            Сховати <ChevronUp className="ml-1 h-3.5 w-3.5" />
                          </>
                        ) : (
                          <>
                            Зміни <ChevronDown className="ml-1 h-3.5 w-3.5" />
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                  {hasPayload && isOpen && (
                    <div className="mt-3 overflow-x-auto rounded border border-border">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-secondary/50">
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Поле</th>
                            <th className="px-3 py-2 text-left font-medium text-destructive">Було</th>
                            <th className="px-3 py-2 text-left font-medium text-success">Стало</th>
                          </tr>
                        </thead>
                        <tbody>
                          {diff
                            .filter((d) => d.kind !== "same")
                            .map((d) => (
                              <tr key={d.key} className="border-t border-border">
                                <td className="px-3 py-2 font-mono text-muted-foreground">{d.key}</td>
                                <td className="px-3 py-2">
                                  <span
                                    className={
                                      d.kind === "removed" || d.kind === "changed"
                                        ? "rounded bg-destructive/10 px-1.5 py-0.5 text-destructive"
                                        : "text-muted-foreground"
                                    }
                                  >
                                    {formatVal(d.before)}
                                  </span>
                                </td>
                                <td className="px-3 py-2">
                                  <span
                                    className={
                                      d.kind === "added" || d.kind === "changed"
                                        ? "rounded bg-success/10 px-1.5 py-0.5 text-success"
                                        : "text-muted-foreground"
                                    }
                                  >
                                    {formatVal(d.after)}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          {diff.filter((d) => d.kind !== "same").length === 0 && (
                            <tr>
                              <td colSpan={3} className="px-3 py-2 text-center text-muted-foreground">
                                Без змін
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
