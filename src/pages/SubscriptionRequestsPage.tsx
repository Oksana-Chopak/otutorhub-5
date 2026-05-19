import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Crown, Mail, Phone, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { uk } from "date-fns/locale";

type RequestStatus = "new" | "in_progress" | "completed" | "rejected";

interface SubscriptionRequest {
  id: string;
  tutor_id: string;
  plan: string;
  price: number;
  status: RequestStatus;
  message: string | null;
  manager_response: string | null;
  handled_at: string | null;
  created_at: string;
  tutor?: {
    first_name: string;
    last_name: string;
    email: string | null;
    phone: string | null;
  };
}

const statusMeta: Record<
  RequestStatus,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  new: { label: t("subscriptionRequests.statusNew"), variant: "default" },
  in_progress: { label: t("subscriptionRequests.statusInProgress"), variant: "secondary" },
  completed: { label: t("subscriptionRequests.statusCompleted"), variant: "outline" },
  rejected: { label: t("subscriptionRequests.statusRejected"), variant: "destructive" },
};

export default function SubscriptionRequestsPage() {
  const [requests, setRequests] = useState<SubscriptionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [responseDrafts, setResponseDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("subscription_requests")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error(t("subscriptionRequests.loadFailed"));
      setLoading(false);
      return;
    }

    const tutorIds = Array.from(new Set((data ?? []).map((r) => r.tutor_id)));
    const [{ data: profiles }, { data: contacts }] = await Promise.all([
      supabase.from("profiles").select("id, first_name, last_name").in("id", tutorIds),
      supabase.from("profile_contacts").select("user_id, email, phone").in("user_id", tutorIds),
    ]);

    const enriched: SubscriptionRequest[] = (data ?? []).map((r) => {
      const p = profiles?.find((x) => x.id === r.tutor_id);
      const c = contacts?.find((x) => x.user_id === r.tutor_id);
      return {
        ...(r as SubscriptionRequest),
        tutor: {
          first_name: p?.first_name ?? "",
          last_name: p?.last_name ?? "",
          email: c?.email ?? null,
          phone: c?.phone ?? null,
        },
      };
    });

    setRequests(enriched);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel("subscription_requests_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscription_requests" },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const updateStatus = async (id: string, status: RequestStatus) => {
    setSavingId(id);
    const patch: { status: RequestStatus; manager_response?: string } = { status };
    if (responseDrafts[id]?.trim()) {
      patch.manager_response = responseDrafts[id].trim();
    }
    const { error } = await supabase
      .from("subscription_requests")
      .update(patch)
      .eq("id", id);
    setSavingId(null);
    if (error) {
      toast.error(t("subscriptionRequests.updateFailed"));
      return;
    }
    toast.success(t("subscriptionRequestsExtra.updated"));
    setResponseDrafts((p) => ({ ...p, [id]: "" }));
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Crown className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground">
              Запити на підписку
            </h1>
            <p className="text-sm text-muted-foreground">
              Самостійні репетитори, які бажають оформити Pro-тариф.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : requests.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Поки що немає жодного запиту на підписку.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {requests.map((r) => {
              const name =
                `${r.tutor?.first_name ?? ""} ${r.tutor?.last_name ?? ""}`.trim() ||
                t("subscriptionRequestsExtra.tutorFallback");
              const meta = statusMeta[r.status];
              return (
                <Card key={r.id}>
                  <CardContent className="p-5 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-display text-lg font-semibold text-foreground">
                          {name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(r.created_at), "d MMM yyyy, HH:mm", {
                            locale: uk,
                          })}{" "}
                          · {r.plan.toUpperCase()} · {Number(r.price)} ₴/міс
                        </p>
                      </div>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </div>

                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      {r.tutor?.email && (
                        <a
                          href={`mailto:${r.tutor.email}`}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                        >
                          <Mail className="h-3.5 w-3.5" /> {r.tutor.email}
                        </a>
                      )}
                      {r.tutor?.phone && (
                        <a
                          href={`tel:${r.tutor.phone}`}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                        >
                          <Phone className="h-3.5 w-3.5" /> {r.tutor.phone}
                        </a>
                      )}
                    </div>

                    {r.message && (
                      <div className="rounded-lg bg-muted/40 p-3 text-sm text-foreground">
                        <div className="mb-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <MessageCircle className="h-3.5 w-3.5" /> Повідомлення
                        </div>
                        {r.message}
                      </div>
                    )}

                    {r.manager_response && (
                      <div className="rounded-lg border border-border p-3 text-sm">
                        <div className="mb-1 text-xs text-muted-foreground">
                          Ваша відповідь
                        </div>
                        {r.manager_response}
                      </div>
                    )}

                    {r.status !== "completed" && r.status !== "rejected" && (
                      <div className="space-y-2">
                        <Textarea
                          placeholder={t("subscriptionRequestsExtra.msgPlaceholder")}
                          value={responseDrafts[r.id] ?? ""}
                          onChange={(e) =>
                            setResponseDrafts((p) => ({
                              ...p,
                              [r.id]: e.target.value,
                            }))
                          }
                          rows={2}
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <Select
                            value={r.status}
                            onValueChange={(v) =>
                              updateStatus(r.id, v as RequestStatus)
                            }
                          >
                            <SelectTrigger className="w-[180px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="new">{t("subscriptionRequests.statusNew")}</SelectItem>
                              <SelectItem value="in_progress">{t("subscriptionRequests.statusInProgress")}</SelectItem>
                              <SelectItem value="completed">{t("subscriptionRequests.statusCompleted")}</SelectItem>
                              <SelectItem value="rejected">{t("subscriptionRequests.statusRejected")}</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateStatus(r.id, "in_progress")}
                            disabled={savingId === r.id}
                          >
                            Взяти в роботу
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => updateStatus(r.id, "completed")}
                            disabled={savingId === r.id}
                          >
                            Завершити
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
