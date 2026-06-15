import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
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
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

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
  { label: string; bg: string; color: string }
> = {
  new: { label: t("subscriptionRequests.statusNew"), bg: "rgba(43,191,170,.15)", color: "#1f8e7e" },
  in_progress: { label: t("subscriptionRequests.statusInProgress"), bg: "rgba(245,158,11,.15)", color: "#b4740b" },
  completed: { label: t("subscriptionRequests.statusCompleted"), bg: "rgba(34,197,94,.15)", color: "#16a34a" },
  rejected: { label: t("subscriptionRequests.statusRejected"), bg: "rgba(224,85,47,.12)", color: "#b3441f" },
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
            <h1 className="hidden lg:block" style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 24, letterSpacing: "-.01em", color: "#0f0f1a" }}>
              Запити на підписку
            </h1>
            <p className="text-sm text-muted-foreground">
              Самостійні репетитори, які бажають оформити платну підписку.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : requests.length === 0 ? (
          <Card className="rounded-[18px] border-dashed border-[#eceef3] shadow-none">
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
                <Card key={r.id} className="rounded-[18px] border-[#eceef3] shadow-none">
                  <CardContent className="p-5 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div style={{ width: 44, height: 44, borderRadius: 13, flexShrink: 0,
                          background: "linear-gradient(135deg,#2BBFAA,#1f8e7e)", color: "#0f0f1a",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 16 }}>
                          {name.split(" ").map((w: string) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?"}
                        </div>
                        <div className="min-w-0">
                        <p style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 18, letterSpacing: "-.01em", color: "#0f0f1a" }}>
                          {name}
                        </p>
                        <p className="text-[13px]" style={{ color: "#9398b0", marginTop: 2 }}>
                          {format(new Date(r.created_at), "d MMM yyyy, HH:mm", {
                            locale: uk,
                          })}{" "}
                          · {r.plan.toUpperCase()} · {Number(r.price)} ₴/міс
                        </p>
                        </div>
                      </div>
                      <span style={{ height: 26, padding: "0 11px", borderRadius: 999, display: "inline-flex", alignItems: "center",
                        fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 13,
                        background: meta.bg, color: meta.color }}>{meta.label}</span>
                    </div>

                    <div className="flex flex-wrap gap-3 text-[13.5px]" style={{ color: "#6b7280" }}>
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
                      <div className="rounded-[13px] p-3 text-[14px]" style={{ background: "#fbfbfc", border: "1px solid #eceef3", color: "#0f0f1a" }}>
                        <div className="mb-1.5 inline-flex items-center gap-1.5 text-[13px]" style={{ color: "#9398b0", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700 }}>
                          <MessageCircle className="h-3.5 w-3.5" /> Повідомлення
                        </div>
                        {r.message}
                      </div>
                    )}

                    {r.manager_response && (
                      <div className="rounded-[13px] p-3 text-[14px]" style={{ border: "1px solid #eceef3" }}>
                        <div className="mb-1.5 text-[13px]" style={{ color: "#9398b0", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700 }}>
                          Ваша відповідь
                        </div>
                        {r.manager_response}
                      </div>
                    )}

                    {r.status !== "completed" && r.status !== "rejected" && (
                      <div className="space-y-2.5">
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
                          className="rounded-[13px] border-[#eceef3] text-[14.5px] focus-visible:ring-[#2BBFAA]"
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
                          <button
                            type="button"
                            onClick={() => updateStatus(r.id, "in_progress")}
                            disabled={savingId === r.id}
                            style={{ height: 38, padding: "0 14px", borderRadius: 11, border: "1px solid rgba(245,158,11,.35)",
                              background: "rgba(245,158,11,.12)", color: "#b4740b", cursor: "pointer",
                              fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 13.5 }}
                          >
                            Взяти в роботу
                          </button>
                          <button
                            type="button"
                            onClick={() => updateStatus(r.id, "completed")}
                            disabled={savingId === r.id}
                            style={{ height: 38, padding: "0 16px", borderRadius: 11, border: "none",
                              background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", cursor: "pointer",
                              fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 13.5,
                              boxShadow: "0 6px 16px -8px rgba(43,191,170,.6)" }}
                          >
                            Завершити
                          </button>
                          <button
                            type="button"
                            onClick={() => updateStatus(r.id, "rejected")}
                            disabled={savingId === r.id}
                            style={{ height: 38, padding: "0 14px", borderRadius: 11, border: "1px solid rgba(224,85,47,.3)",
                              background: "transparent", color: "#b3441f", cursor: "pointer",
                              fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 13.5 }}
                          >
                            Відхилити
                          </button>
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
