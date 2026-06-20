import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { NotificationBell } from "@/components/NotificationBell";
import { supabase } from "@/integrations/supabase/client";
import { prettyRequestValue } from "@/lib/tutorRequestLabels";
import { useAuth } from "@/hooks/useAuth";
import { EmptyState } from "@/components/EmptyState";
import { AssignTutorDialog } from "@/components/AssignTutorDialog";
import { HandHeart, Loader2, Users, MessageSquare, Copy, ChevronDown, Check, Mail, Phone, Send, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

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
  studentEmail?: string | null;
  studentPhone?: string | null;
  studentTelegram?: string | null;
}

const F = "Inter, system-ui, sans-serif";
const AVC = ["#2BBFAA", "#5b6bf5", "#FF7A59", "#F59E0B", "#8B5CF6"];
const initials = (n: string) =>
  n.split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
const avColor = (n: string) => AVC[(((n.charCodeAt(0) || 0) + (n.charCodeAt(1) || 0)) % AVC.length)];

function Avatar({ name, size = 50 }: { name: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 999, flexShrink: 0, background: avColor(name), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F, fontWeight: 800, fontSize: size * 0.35 }}>
      {initials(name)}
    </div>
  );
}

const STATUSES: ReferralRow["status"][] = ["open", "in_progress", "fulfilled", "closed"];
const statusLabel: Record<ReferralRow["status"], string> = {
  open: t("referralsPage.statusOpen"),
  in_progress: t("referralsPage.statusInProgress"),
  fulfilled: t("referralsPage.statusFulfilled"),
  closed: t("referralsPage.statusClosed"),
};
const ST: Record<ReferralRow["status"], { dot: string; bg: string; color: string }> = {
  open: { dot: "#F59E0B", bg: "rgba(245,158,11,.16)", color: "#B4740B" },
  in_progress: { dot: "#2BBFAA", bg: "rgba(43,191,170,.14)", color: "#1f8e7e" },
  fulfilled: { dot: "#22c55e", bg: "rgba(34,197,94,.16)", color: "#16a34a" },
  closed: { dot: "#9aa0b4", bg: "rgba(147,152,176,.18)", color: "#7b8198" },
};

function StatusPicker({ status, onChange }: { status: ReferralRow["status"]; onChange: (s: ReferralRow["status"]) => void }) {
  const [open, setOpen] = useState(false);
  const cur = ST[status];
  return (
    <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 44, padding: "0 14px", borderRadius: 999, cursor: "pointer", border: "none", fontFamily: F, fontWeight: 700, fontSize: 15, background: cur.bg, color: cur.color }}>
        <span style={{ width: 9, height: 9, borderRadius: 999, background: cur.dot }} />
        {statusLabel[status]}
        <ChevronDown size={16} strokeWidth={2.2} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </button>
      {open && (
        <>
          <button type="button" aria-hidden onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 29, background: "transparent", border: "none", cursor: "default" }} />
          <div style={{ position: "absolute", top: 48, right: 0, zIndex: 30, background: "#fff", border: "1px solid #eceef3", borderRadius: 14, boxShadow: "0 18px 40px -16px rgba(15,15,26,.3)", padding: 6, minWidth: 188 }}>
            {STATUSES.map((k) => (
              <button key={k} type="button" onClick={() => { onChange(k); setOpen(false); }}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", border: "none", background: k === status ? "#F5F4F0" : "transparent", cursor: "pointer", padding: "12px 13px", borderRadius: 10, fontFamily: F, fontWeight: 700, fontSize: 16, color: "#0f0f1a", textAlign: "left" }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: ST[k].dot, flexShrink: 0 }} />
                {statusLabel[k]}
                {k === status && <Check size={17} strokeWidth={2.4} style={{ marginLeft: "auto", color: "#25a896" }} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function ReferralsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<ReferralRow[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<ReferralRow | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: rows } = await supabase
      .from("tutor_referral_requests")
      .select("*")
      .order("created_at", { ascending: false });

    const ids = Array.from(new Set((rows ?? []).map((r: any) => r.student_id)));
    const profileMap = new Map<string, { name: string; avatar: string | null }>();
    const contactMap = new Map<string, { email: string | null; phone: string | null; telegram: string | null }>();
    if (ids.length > 0) {
      const [profilesRes, contactsRes] = await Promise.all([
        supabase.from("profiles").select("id, first_name, last_name, avatar_url").in("id", ids),
        supabase.from("profile_contacts").select("user_id, email, phone, telegram").in("user_id", ids),
      ]);
      (profilesRes.data ?? []).forEach((p: any) => {
        profileMap.set(p.id, { name: `${p.first_name} ${p.last_name}`.trim() || t("shared.noName"), avatar: p.avatar_url });
      });
      (contactsRes.data ?? []).forEach((c: any) => {
        contactMap.set(c.user_id, { email: c.email ?? null, phone: c.phone ?? null, telegram: c.telegram ?? null });
      });
    }

    const enriched: ReferralRow[] = (rows ?? []).map((r: any) => ({
      ...r,
      studentName: profileMap.get(r.student_id)?.name ?? t("shared.student"),
      studentAvatar: profileMap.get(r.student_id)?.avatar ?? null,
      studentEmail: contactMap.get(r.student_id)?.email ?? null,
      studentPhone: contactMap.get(r.student_id)?.phone ?? null,
      studentTelegram: contactMap.get(r.student_id)?.telegram ?? null,
    }));
    setRequests(enriched);
    // Auto-expand the first open request so the priority flow is one tap closer.
    setOpenId((cur) => cur ?? enriched.find((r) => r.status === "open")?.id ?? enriched[0]?.id ?? null);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const updateStatus = async (id: string, status: ReferralRow["status"]) => {
    setSavingId(id);
    // Optimistic — flip immediately, revert on error.
    const prev = requests;
    setRequests((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)));
    const patch: any = { status };
    if (status === "fulfilled" || status === "closed") patch.resolved_at = new Date().toISOString();
    const { error } = await supabase.from("tutor_referral_requests").update(patch).eq("id", id);
    setSavingId(null);
    if (error) {
      setRequests(prev);
      toast.error(t("referralsPage.updateFailed"));
      return;
    }
    toast.success(t("referralsPage.updated"));
  };

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text);
    toast.success(t("referralsPageExtra.copied"));
  };

  // Priority flow action — message the student. Uses the existing ChatsPage
  // ?with= deep-link, which opens an existing thread with that student.
  const writeStudent = (studentId: string) => navigate(`/chats?with=${studentId}`);

  const openCount = requests.filter((r) => r.status === "open").length;

  return (
    <AppLayout>
      {/* Desktop header (mobile title/bell/burger come from AppLayout) */}
      <div className="mb-4 hidden items-center justify-between lg:flex">
        <h1 style={{ fontFamily: F, fontWeight: 800, fontSize: 25, letterSpacing: "-.01em", color: "#0f0f1a" }}>
          Запити на репетиторів
        </h1>
        <NotificationBell />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : requests.length === 0 ? (
        <EmptyState
          icon={HandHeart}
          title={t("referralsPageExtra.noRequests")}
          description={t("referralsPageExtra.noRequestsDesc")}
        />
      ) : (
        <>
          {/* New-requests banner */}
          {openCount > 0 && (
            <div style={{ marginBottom: 14, borderRadius: 16, padding: "16px 18px", background: "linear-gradient(135deg,#0f0f1a,#1a1a3e)", color: "#fff", display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ fontFamily: F, fontWeight: 800, fontSize: 34, letterSpacing: "-.02em", color: "#2BBFAA", lineHeight: 1 }}>{openCount}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: F, fontWeight: 800, fontSize: 19 }}>{t("referralsPageExtra.newBannerTitle")}</div>
                <div style={{ fontSize: 15, color: "rgba(255,255,255,.65)", marginTop: 1 }}>{t("referralsPageExtra.newBannerSub")}</div>
              </div>
              <ChevronRight size={22} strokeWidth={2.2} style={{ color: "rgba(255,255,255,.5)", flexShrink: 0 }} />
            </div>
          )}

          <div className="flex flex-col gap-3">
            {requests.map((r) => {
              const on = openId === r.id;
              const done = r.status === "fulfilled" || r.status === "closed";
              const facts = [
                ["referralsPageExtra.levelChip", r.preferred_level],
                ["referralsPageExtra.daysChip", r.preferred_days],
                ["referralsPageExtra.hoursChip", r.preferred_times],
              ].filter(([, v]) => v) as [string, string][];
              const contacts = [
                ["email", Mail, r.studentEmail],
                ["phone", Phone, r.studentPhone],
                ["telegram", Send, r.studentTelegram ? "@" + r.studentTelegram.replace(/^@/, "") : null],
              ].filter(([, , v]) => v) as [string, typeof Mail, string][];

              return (
                <div key={r.id} style={{ borderRadius: 20, border: `1.5px solid ${on ? "#2BBFAA" : r.status === "open" ? "rgba(245,158,11,.4)" : "#eceef3"}`, background: "#fff", boxShadow: "0 1px 2px rgba(15,15,26,.05)", overflow: "hidden" }}>
                  {/* Collapsed row */}
                  <button type="button" onClick={() => setOpenId(on ? null : r.id)}
                    style={{ width: "100%", border: "none", background: "transparent", cursor: "pointer", textAlign: "left", padding: 15, display: "flex", alignItems: "center", gap: 13 }}>
                    <Avatar name={r.studentName ?? "?"} size={50} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: F, fontWeight: 800, fontSize: 21, letterSpacing: "-.01em", color: "#0f0f1a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.subject || t("referralsPageExtra.subjectAny")}</div>
                      <div style={{ fontWeight: 600, fontSize: 16, color: "#6b7088", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.studentName}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 7, flexShrink: 0 }}>
                      {r.budget_note && <span style={{ fontFamily: F, fontWeight: 800, fontSize: 19, color: "#25a896", whiteSpace: "nowrap" }}>{r.budget_note}</span>}
                      <StatusPicker status={r.status} onChange={(s) => updateStatus(r.id, s)} />
                    </div>
                  </button>

                  {/* Expanded */}
                  {on && (
                    <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
                      {facts.length > 0 && (
                        <div style={{ borderTop: "1px solid #eceef3", paddingTop: 15, display: "grid", gridTemplateColumns: `repeat(${facts.length}, 1fr)`, gap: 10 }}>
                          {facts.map(([labelKey, val], i) => (
                            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 5, borderRadius: 14, background: "#fbfbfc", border: "1px solid #eceef3", padding: "12px 13px", minWidth: 0 }}>
                              <span style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: "#b0b4c8" }}>{t(labelKey)}</span>
                              <span style={{ fontFamily: F, fontWeight: 800, fontSize: 16, color: "#0f0f1a", lineHeight: 1.2 }}>{prettyRequestValue(val)}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {r.message && <div style={{ fontSize: 17, lineHeight: 1.55, color: "#0f0f1a" }}>“{r.message}”</div>}

                      <div>
                        <div style={{ fontFamily: F, fontWeight: 700, fontSize: 15, color: "#6b7088", marginBottom: 11 }}>{t("referralsPageExtra.studentContacts")}</div>
                        {contacts.length === 0 ? (
                          <div style={{ fontSize: 16, color: "#b0b4c8" }}>{t("referralsPageExtra.noContacts")}</div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                            {contacts.map(([, IconC, val], i) => (
                              <div key={i} style={{ display: "flex", alignItems: "center", gap: 11 }}>
                                <IconC size={19} style={{ color: "#b0b4c8", flexShrink: 0 }} />
                                <span style={{ flex: 1, fontSize: 17, color: "#0f0f1a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{val}</span>
                                <button type="button" aria-label={t("chatContextPanel.copy")} onClick={() => copy(val.replace(/^@/, ""))}
                                  style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 12, border: "none", cursor: "pointer", background: "#fff", color: "#25a896", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 2px rgba(15,15,26,.06)" }}>
                                  <Copy size={20} strokeWidth={2} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {done && r.manager_response && (
                        <div style={{ borderRadius: 14, border: "1px solid rgba(43,191,170,.3)", background: "var(--teal-l, #f0fdf9)", padding: "13px 15px", fontSize: 16, color: "#0f0f1a" }}>{r.manager_response}</div>
                      )}

                      {!done && (
                        <div style={{ display: "flex", gap: 10 }}>
                          <button type="button" onClick={() => setAssignTarget(r)}
                            style={{ flex: 1, height: 56, borderRadius: 15, border: "1.5px solid #eceef3", background: "#fff", color: "#0f0f1a", fontFamily: F, fontWeight: 700, fontSize: 16, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                            <Users size={20} strokeWidth={2} style={{ color: "#25a896" }} />{t("referralsPageExtra.assignBtn")}
                          </button>
                          <button type="button" onClick={() => writeStudent(r.student_id)}
                            style={{ flex: 1, height: 56, borderRadius: 15, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#fff", fontFamily: F, fontWeight: 700, fontSize: 16, boxShadow: "0 6px 16px -6px rgba(43,191,170,.7)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                            <MessageSquare size={21} strokeWidth={2.1} />{t("referralsPageExtra.writeBtn")}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
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
