import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldAlert } from "lucide-react";
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

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [profiles, setProfiles] = useState<Map<string, ProfileLite>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("manager_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
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

  return (
    <AppLayout>
      <div className="space-y-6">
        <header className="flex items-center gap-3">
          <ShieldAlert className="h-7 w-7 text-primary" />
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground">
              Журнал аудиту
            </h1>
            <p className="text-sm text-muted-foreground">
              Чутливі дії менеджерів: ролі, видалення, фінанси
            </p>
          </div>
        </header>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={ShieldAlert}
            title="Поки що немає записів"
            description="Тут з'являться дії менеджера: зміна ролей, видалення профілів, оновлення платежів."
          />
        ) : (
          <div className="space-y-2">
            {entries.map((e) => {
              const meta = actionLabels[e.action] ?? { label: e.action, variant: "outline" as const };
              const target =
                e.entity_type === "profile" || e.entity_type === "user_role"
                  ? nameOf(profiles, e.entity_id)
                  : e.entity_id?.slice(0, 8) ?? "—";
              return (
                <Card key={e.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
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
                      {(e.before || e.after) && (
                        <pre className="mt-2 max-w-full overflow-x-auto rounded bg-muted p-2 text-xs text-muted-foreground">
                          {JSON.stringify({ before: e.before, after: e.after }, null, 2)}
                        </pre>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
