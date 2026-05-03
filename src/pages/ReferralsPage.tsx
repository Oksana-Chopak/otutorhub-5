import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { UserAvatar } from "@/components/UserAvatar";
import { HandHeart, Loader2, MessageCircle, CheckCircle2, X, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { AssignTutorDialog } from "@/components/AssignTutorDialog";

interface ReferralRow {
  id: string;
  student_id: string;
  subject: string | null;
  preferred_level: string | null;
  budget_note: string | null;
  preferred_days: string | null;
  preferred_times: string | null;
  message: string | null;
  status: "open" | "in_progress" | "fulfilled" | "closed";
  manager_response: string | null;
  created_at: string;
  studentName?: string;
  studentAvatar?: string | null;
}

const statusLabel: Record<ReferralRow["status"], string> = {
  open: "Новий",
  in_progress: "В роботі",
  fulfilled: "Виконано",
  closed: "Закрито",
};

const statusClass: Record<ReferralRow["status"], string> = {
  open: "bg-warning/10 text-warning",
  in_progress: "bg-primary/10 text-primary",
  fulfilled: "bg-success/10 text-success",
  closed: "bg-muted text-muted-foreground",
};

export default function ReferralsPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<ReferralRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<ReferralRow | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: rows } = await supabase
      .from("tutor_referral_requests")
      .select("*")
      .order("created_at", { ascending: false });

    const ids = Array.from(new Set((rows ?? []).map((r: any) => r.student_id)));
    let profileMap = new Map<string, { name: string; avatar: string | null }>();
    if (ids.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, avatar_url")
        .in("id", ids);
      (profiles ?? []).forEach((p: any) => {
        profileMap.set(p.id, {
          name: `${p.first_name} ${p.last_name}`.trim() || "Без імені",
          avatar: p.avatar_url,
        });
      });
    }

    const enriched: ReferralRow[] = (rows ?? []).map((r: any) => ({
      ...r,
      studentName: profileMap.get(r.student_id)?.name ?? "Учень",
      studentAvatar: profileMap.get(r.student_id)?.avatar ?? null,
    }));
    setRequests(enriched);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [user?.id]);

  const updateStatus = async (id: string, status: ReferralRow["status"]) => {
    setSavingId(id);
    const patch: any = { status };
    if (status === "fulfilled" || status === "closed") {
      patch.resolved_at = new Date().toISOString();
    }
    const { error } = await supabase
      .from("tutor_referral_requests")
      .update(patch)
      .eq("id", id);
    setSavingId(null);
    if (error) {
      toast.error("Не вдалося оновити статус");
      return;
    }
    toast.success("Статус оновлено");
    load();
  };

  const saveResponse = async (id: string) => {
    const response = drafts[id]?.trim();
    if (!response) {
      toast.error("Напишіть відповідь");
      return;
    }
    setSavingId(id);
    const { error } = await supabase
      .from("tutor_referral_requests")
      .update({ manager_response: response, status: "in_progress" })
      .eq("id", id);
    setSavingId(null);
    if (error) {
      toast.error("Не вдалося зберегти");
      return;
    }
    toast.success("Відповідь надіслано");
    setDrafts((d) => ({ ...d, [id]: "" }));
    load();
  };

  const openChat = async (studentId: string) => {
    if (!user) return;
    // Manager can create thread directly. We need a tutor_id pair — for direct manager↔student
    // we don't have a thread (managers see all threads). Easiest: navigate to /chats and let
    // them filter, or create a minimal helper later. For now show toast hint.
    toast.info("Відкрийте чати, щоб обрати ниточку для відповіді учневі.");
  };

  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground">
          Запити на репетиторів
        </h1>
        <p className="text-sm text-muted-foreground">
          Учні просять підібрати їм нового репетитора з вашого хабу.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : requests.length === 0 ? (
        <EmptyState
          icon={HandHeart}
          title="Запитів немає"
          description="Коли учень попросить нового репетитора, заявка з'явиться тут."
        />
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <Card key={r.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start gap-3">
                  <UserAvatar
                    url={r.studentAvatar ?? null}
                    firstName={r.studentName?.split(" ")[0] ?? "?"}
                    lastName={r.studentName?.split(" ")[1]}
                    className="h-10 w-10"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-foreground">{r.studentName}</p>
                      <Badge className={statusClass[r.status]}>{statusLabel[r.status]}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleString("uk-UA", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <div className="mt-2 grid gap-1 text-sm">
                      {r.subject && (
                        <p>
                          <span className="text-muted-foreground">Предмет:</span> {r.subject}
                        </p>
                      )}
                      {r.preferred_level && (
                        <p>
                          <span className="text-muted-foreground">Рівень:</span>{" "}
                          {r.preferred_level}
                        </p>
                      )}
                      {r.budget_note && (
                        <p>
                          <span className="text-muted-foreground">Бюджет:</span>{" "}
                          {r.budget_note}
                        </p>
                      )}
                      {r.preferred_days && (
                        <p>
                          <span className="text-muted-foreground">Зручні дні:</span>{" "}
                          {r.preferred_days}
                        </p>
                      )}
                      {r.preferred_times && (
                        <p>
                          <span className="text-muted-foreground">Зручні години:</span>{" "}
                          {r.preferred_times}
                        </p>
                      )}
                      {r.message && (
                        <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-sm text-foreground">
                          {r.message}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {r.manager_response && (
                  <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-sm text-foreground">
                    <p className="text-xs font-medium text-primary">Ваша відповідь:</p>
                    <p className="mt-1 whitespace-pre-wrap">{r.manager_response}</p>
                  </div>
                )}

                {r.status !== "fulfilled" && r.status !== "closed" && (
                  <div className="space-y-2">
                    <Textarea
                      rows={2}
                      placeholder="Відповідь учневі (наприклад, кого ви рекомендуєте)…"
                      value={drafts[r.id] ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => saveResponse(r.id)}
                        disabled={savingId === r.id}
                      >
                        {savingId === r.id && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                        Зберегти відповідь
                      </Button>
                      <Select
                        value={r.status}
                        onValueChange={(v) => updateStatus(r.id, v as ReferralRow["status"])}
                      >
                        <SelectTrigger className="h-9 w-[160px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">Новий</SelectItem>
                          <SelectItem value="in_progress">В роботі</SelectItem>
                          <SelectItem value="fulfilled">Виконано</SelectItem>
                          <SelectItem value="closed">Закрито</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button size="sm" variant="outline" onClick={() => openChat(r.student_id)}>
                        <MessageCircle className="mr-1 h-3 w-3" />
                        Чат з учнем
                      </Button>
                    </div>
                  </div>
                )}

                {(r.status === "open" || r.status === "in_progress") && (
                  <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-2">
                    <Button
                      size="sm"
                      onClick={() => setAssignTarget(r)}
                    >
                      <UserCheck className="mr-1 h-3 w-3" />
                      Призначити репетитора
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => updateStatus(r.id, "fulfilled")}
                    >
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      Позначити виконаним
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => updateStatus(r.id, "closed")}
                    >
                      <X className="mr-1 h-3 w-3" />
                      Закрити
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AssignTutorDialog
        open={!!assignTarget}
        onOpenChange={(o) => !o && setAssignTarget(null)}
        request={assignTarget}
        onAssigned={load}
      />
    </AppLayout>
  );
}
