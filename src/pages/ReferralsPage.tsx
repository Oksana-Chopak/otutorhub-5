import { useEffect, useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";
import { ErrorState } from "@/components/ErrorState";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { prettyRequestValue } from "@/lib/tutorRequestLabels";
import { useAuth } from "@/hooks/useAuth";
import { EmptyState } from "@/components/EmptyState";
import { AssignTutorDialog } from "@/components/AssignTutorDialog";
import { HandHeart, Loader2, Users, MessageSquare, Copy, ChevronDown, Check, Mail, Phone, Send, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import i18nInstance from "@/i18n";
import { lazyRecord } from "@/lib/lazyI18n";
const t = i18nInstance.t.bind(i18nInstance);

interface ReferralRow {
  id: string;
  /* Заявка з ЛЕНДІНГУ може не мати акаунта взагалі — `student_id` nullable
     (`landing-find-tutor-quiz` пише `lead_*`, а акаунт міг і не створитись). */
  student_id: string | null;
  source: string | null;
  lead_name: string | null;
  lead_email: string | null;
  lead_phone: string | null;
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
  /** Чи є в людини акаунт: лише тоді чат узагалі можливий. */
  hasAccount?: boolean;
}

const F = "Inter, system-ui, sans-serif";
const AVC = ["var(--teal,#2BBFAA)", "#5b6bf5", "#FF7A59", "#F59E0B", "#8B5CF6"];
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
// A1: лінивий record — переклад у момент звернення, не імпорту (див. lazyI18n.ts)
const statusLabel: Record<ReferralRow["status"], string> = lazyRecord(() => ({
  open: t("referralsPage.statusOpen"),
  in_progress: t("referralsPage.statusInProgress"),
  fulfilled: t("referralsPage.statusFulfilled"),
  closed: t("referralsPage.statusClosed"),
})) as Record<ReferralRow["status"], string>;
const ST: Record<ReferralRow["status"], { dot: string; bg: string; color: string }> = {
  open: { dot: "#F59E0B", bg: "rgba(245,158,11,.16)", color: "var(--warning-text,#B45309)" },
  in_progress: { dot: "var(--teal,#2BBFAA)", bg: "rgba(43,191,170,.14)", color: "var(--teal-text,#1a7a6c)" },
  fulfilled: { dot: "#22c55e", bg: "rgba(34,197,94,.16)", color: "var(--success-text,#11803a)" },
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
          <div style={{ position: "absolute", top: 48, right: 0, zIndex: 30, background: "var(--ds-surface,#fff)", border: "1px solid var(--ds-border,#eceef3)", borderRadius: 14, boxShadow: "0 18px 40px -16px rgba(15,15,26,.3)", padding: 6, minWidth: 188 }}>
            {STATUSES.map((k) => (
              <button key={k} type="button" onClick={() => { onChange(k); setOpen(false); }}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", border: "none", background: k === status ? "var(--ds-bg,#F5F4F0)" : "transparent", cursor: "pointer", padding: "12px 13px", borderRadius: 10, fontFamily: F, fontWeight: 700, fontSize: 16, color: "var(--ds-txt,#0f0f1a)", textAlign: "left" }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: ST[k].dot, flexShrink: 0 }} />
                {statusLabel[k]}
                {k === status && <Check size={17} strokeWidth={2.4} style={{ marginLeft: "auto", color: "var(--teal-text,#1a7a6c)" }} />}
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
  const [loadError, setLoadError] = useState(false);
  const [requests, setRequests] = useState<ReferralRow[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<ReferralRow | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(false);
    const { data: rows, error: rowsErr } = await supabase
      .from("tutor_referral_requests")
      .select("*")
      .order("created_at", { ascending: false });
    if (rowsErr) {
      setLoadError(true);
      setLoading(false);
      return;
    }

    const ids = Array.from(new Set((rows ?? []).map((r: any) => r.student_id).filter(Boolean)));
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

    /* 03.10, скарга власниці: «бачу три нових запити з математики, але не бачу
       контактних даних, щоб написати учню». Причина: сторінка читала контакти
       ЛИШЕ з `profile_contacts`, а заявка з лендінгу несе їх у САМІЙ заявці —
       `lead_name` / `lead_email` / `lead_phone` (`landing-find-tutor-quiz`).
       Ці три колонки не читались НІДЕ, тож кожен лід із лендінгу показувався як
       безіменний «Учень» без контактів — саме ті люди, яким треба написати
       першими. Порядок: профіль (якщо людина зареєструвалась — там свіжіше),
       далі те, що вона вписала в анкету. */
    const enriched: ReferralRow[] = (rows ?? []).map((r: any) => {
      const prof = r.student_id ? profileMap.get(r.student_id) : undefined;
      const cont = r.student_id ? contactMap.get(r.student_id) : undefined;
      const lead = (v: string | null | undefined) => (v && String(v).trim() ? String(v).trim() : null);
      return {
        ...r,
        hasAccount: !!prof,
        studentName: prof?.name ?? lead(r.lead_name) ?? t("shared.student"),
        studentAvatar: prof?.avatar ?? null,
        studentEmail: cont?.email ?? lead(r.lead_email),
        studentPhone: cont?.phone ?? lead(r.lead_phone),
        studentTelegram: cont?.telegram ?? null,
      };
    });
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
    void copyToClipboard(text);
    toast.success(t("referralsPageExtra.copied"));
  };

  // Priority flow action — message the student. Uses the existing ChatsPage
  // ?with= deep-link, which opens an existing thread with that student.
  const writeStudent = (studentId: string) => navigate(`/chats?with=${studentId}`);

  const openCount = requests.filter((r) => r.status === "open").length;

  return (
    <>
      {/* Desktop header (mobile title/bell/burger come from AppLayout) */}
      <div className="mb-4 hidden items-center justify-between lg:flex">
        <h1 style={{ fontFamily: F, fontWeight: 800, fontSize: 25, letterSpacing: "-.01em", color: "var(--ds-txt,#0f0f1a)" }}>
          {t("nav.referrals")}
        </h1>
        {/* Desktop bell now comes from AppLayout (one global fixed bell) */}
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-[16px] border bg-card p-4" style={{ borderColor: "var(--ds-border,#eceef3)" }}>
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-40 animate-pulse rounded-md bg-muted" />
                  <div className="h-3 w-56 max-w-full animate-pulse rounded-md bg-muted" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <ErrorState onRetry={() => void load()} />
      ) : requests.length === 0 ? (
        <EmptyState
          icon={HandHeart}
          title={t("referralsPageExtra.noRequests")}
          description={t("referralsPageExtra.noRequestsDesc")}
          actionLabel={null}
        />
      ) : (
        <>
          {/* New-requests banner */}
          {openCount > 0 && (
            <div style={{ marginBottom: 14, borderRadius: 16, padding: "16px 18px", background: "linear-gradient(135deg,var(--ds-txt,#0f0f1a),#1a1a3e)", color: "#fff", display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ fontFamily: F, fontWeight: 800, fontSize: 34, letterSpacing: "-.02em", color: "var(--teal,#2BBFAA)", lineHeight: 1 }}>{openCount}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: F, fontWeight: 800, fontSize: 19 }}>{t("referralsPageExtra.newBannerTitle")}</div>
                <div style={{ fontSize: 15, color: "rgba(255,255,255,.65)", marginTop: 1 }}>{t("referralsPageExtra.newBannerSub")}</div>
              </div>
              {/* No chevron: this is a passive summary (the first open request is
                  auto-expanded below) — a chevron promised a tap that did nothing. */}
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
              /* 03.10: контакт — це ДІЯ, а не напис із кнопкою «скопіювати».
                 Власниця: «я хочу просто написати тому учневі, бажано на емейл
                 або на номер телефону, щоб спершу домовитися про умови». Тому
                 дотик по рядку одразу відкриває пошту/набір номера/Telegram, а
                 тема листа вже містить предмет, про який просили. Копіювання
                 лишається поруч — для тих, хто пише з іншого пристрою. */
              const mailSubject = t("referralsPageExtra.mailSubject", { subject: r.subject || t("referralsPageExtra.subjectAny") });
              const mailBody = t("referralsPageExtra.mailBody", { name: r.studentName ?? "", subject: r.subject || t("referralsPageExtra.subjectAny") });
              const tgHandle = r.studentTelegram ? r.studentTelegram.replace(/^@/, "") : null;
              const contacts = ([
                ["email", Mail, r.studentEmail, r.studentEmail ? `mailto:${r.studentEmail}?subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(mailBody)}` : null],
                ["phone", Phone, r.studentPhone, r.studentPhone ? `tel:${r.studentPhone.replace(/[^\d+]/g, "")}` : null],
                ["telegram", Send, tgHandle ? "@" + tgHandle : null, tgHandle ? `https://t.me/${tgHandle}` : null],
              ] as [string, typeof Mail, string | null, string | null][]).filter(([, , v]) => v) as [string, typeof Mail, string, string][];

              return (
                <div key={r.id} style={{ borderRadius: 20, border: `1.5px solid ${on ? "var(--teal,#2BBFAA)" : r.status === "open" ? "rgba(245,158,11,.4)" : "var(--ds-border,#eceef3)"}`, background: "var(--ds-surface,#fff)", boxShadow: "0 1px 2px rgba(15,15,26,.05)", overflow: "hidden" }}>
                  {/* Collapsed row */}
                  <button type="button" onClick={() => setOpenId(on ? null : r.id)}
                    style={{ width: "100%", border: "none", background: "transparent", cursor: "pointer", textAlign: "left", padding: 15, display: "flex", alignItems: "center", gap: 13 }}>
                    <Avatar name={r.studentName ?? "?"} size={50} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: F, fontWeight: 800, fontSize: 21, letterSpacing: "-.01em", color: "var(--ds-txt,#0f0f1a)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.subject || t("referralsPageExtra.subjectAny")}</div>
                      <div style={{ fontWeight: 600, fontSize: 16, color: "var(--sub,#62677E)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.studentName}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 7, flexShrink: 0 }}>
                      {r.budget_note && <span style={{ fontFamily: F, fontWeight: 800, fontSize: 19, color: "var(--teal-text,#1a7a6c)", whiteSpace: "nowrap" }}>{r.budget_note}</span>}
                      <StatusPicker status={r.status} onChange={(s) => updateStatus(r.id, s)} />
                    </div>
                  </button>

                  {/* Expanded */}
                  {on && (
                    <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
                      {facts.length > 0 && (
                        <div style={{ borderTop: "1px solid var(--ds-border,#eceef3)", paddingTop: 15, display: "grid", gridTemplateColumns: `repeat(${facts.length}, 1fr)`, gap: 10 }}>
                          {facts.map(([labelKey, val], i) => (
                            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 5, borderRadius: 14, background: "var(--ds-surface2,#fbfbfc)", border: "1px solid var(--ds-border,#eceef3)", padding: "12px 13px", minWidth: 0 }}>
                              <span style={{ fontFamily: F, fontWeight: 700, fontSize: 14, color: "var(--ds-muted,#6f7489)" }}>{t(labelKey)}</span>
                              <span style={{ fontFamily: F, fontWeight: 800, fontSize: 16, color: "var(--ds-txt,#0f0f1a)", lineHeight: 1.2 }}>{prettyRequestValue(val)}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {r.message && <div style={{ fontSize: 17, lineHeight: 1.55, color: "var(--ds-txt,#0f0f1a)" }}>“{r.message}”</div>}

                      <div>
                        <div style={{ fontFamily: F, fontWeight: 700, fontSize: 15, color: "var(--sub,#62677E)", marginBottom: 11 }}>{t("referralsPageExtra.studentContacts")}</div>
                        {contacts.length === 0 ? (
                          <div style={{ fontSize: 16, color: "var(--ds-muted,#6f7489)" }}>{t("referralsPageExtra.noContacts")}</div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                            {contacts.map(([kind, IconC, val, href], i) => (
                              <div key={i} style={{ display: "flex", alignItems: "center", gap: 11 }}>
                                <a href={href}
                                  {...(kind === "telegram" ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                                  style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 11, minHeight: 44, textDecoration: "none", color: "var(--ds-txt,#0f0f1a)" }}>
                                  <IconC size={19} style={{ color: "var(--teal-text,#1a7a6c)", flexShrink: 0 }} />
                                  <span style={{ flex: 1, fontSize: 17, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{val}</span>
                                </a>
                                <button type="button" aria-label={t("chatContextPanel.copy")} onClick={() => copy(val.replace(/^@/, ""))}
                                  style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 12, border: "none", cursor: "pointer", background: "var(--ds-surface,#fff)", color: "var(--teal-text,#1a7a6c)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 2px rgba(15,15,26,.06)" }}>
                                  <Copy size={20} strokeWidth={2} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {done && r.manager_response && (
                        <div style={{ borderRadius: 14, border: "1px solid rgba(43,191,170,.3)", background: "var(--teal-l, var(--teal-l,#f0fdf9))", padding: "13px 15px", fontSize: 16, color: "var(--ds-txt,#0f0f1a)" }}>{r.manager_response}</div>
                      )}

                      {!done && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          {/* 03.10: ПЕРША дія — звʼязатись, бо спершу домовляються про
                              умови, і лише потім приставляють репетитора. Доти першою
                              (зеленою) стояв чат, і він вів у «створіть пару учень–
                              репетитор» — тобто змушував зробити КРОК ДРУГИЙ, щоб
                              виконати крок перший. А для ліда з лендінгу акаунта може
                              не бути взагалі, і чат там неможливий за визначенням. */}
                          {contacts.length > 0 && (
                            <a href={contacts[0][3]}
                              {...(contacts[0][0] === "telegram" ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                              style={{ height: 56, borderRadius: 15, textDecoration: "none", background: "linear-gradient(135deg,var(--teal,#2BBFAA),var(--teal-d,#25a896))", color: "#fff", fontFamily: F, fontWeight: 700, fontSize: 16, boxShadow: "0 6px 16px -6px rgba(43,191,170,.7)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                              {(() => { const I = contacts[0][1]; return <I size={21} strokeWidth={2.1} />; })()}
                              {t(contacts[0][0] === "email" ? "referralsPageExtra.writeEmailBtn"
                                : contacts[0][0] === "phone" ? "referralsPageExtra.callBtn"
                                : "referralsPageExtra.writeTelegramBtn")}
                            </a>
                          )}
                          <div style={{ display: "flex", gap: 10 }}>
                            <button type="button" onClick={() => setAssignTarget(r)}
                              style={{ flex: 1, height: 56, borderRadius: 15, border: "1.5px solid var(--ds-border,#eceef3)", background: "var(--ds-surface,#fff)", color: "var(--ds-txt,#0f0f1a)", fontFamily: F, fontWeight: 700, fontSize: 16, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                              <Users size={20} strokeWidth={2} style={{ color: "var(--teal-text,#1a7a6c)" }} />{t("referralsPageExtra.assignBtn")}
                            </button>
                            {/* Чат — лише коли акаунт СПРАВДІ є: інакше кнопка вела на
                                `/chats?with=null`, тобто в нікуди. */}
                            {r.hasAccount && r.student_id && (
                              <button type="button" onClick={() => writeStudent(r.student_id as string)}
                                style={{ flex: 1, height: 56, borderRadius: 15, border: "1.5px solid var(--ds-border,#eceef3)", background: "var(--ds-surface,#fff)", color: "var(--ds-txt,#0f0f1a)", fontFamily: F, fontWeight: 700, fontSize: 16, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                                <MessageSquare size={21} strokeWidth={2.1} style={{ color: "var(--teal-text,#1a7a6c)" }} />{t("referralsPageExtra.writeBtn")}
                              </button>
                            )}
                          </div>
                          {contacts.length === 0 && (
                            <div style={{ fontSize: 15, lineHeight: 1.5, color: "var(--ds-muted,#6f7489)" }}>
                              {t(r.hasAccount ? "referralsPageExtra.onlyChatHint" : "referralsPageExtra.noWayToReach")}
                            </div>
                          )}
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
    </>
  );
}
