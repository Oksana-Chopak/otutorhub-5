import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { insertNotification } from "@/lib/notifications";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Loader2, Users, X, Check } from "lucide-react";
import { toast } from "sonner";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: {
    id: string;
    student_id: string;
    studentName?: string;
    subject: string | null;
  } | null;
  onAssigned: () => void;
}

interface TutorOption {
  id: string;
  name: string;
  defaultRate: number | null;
}

const F = "Inter, system-ui, sans-serif";
const AVC = ["#2BBFAA", "#5b6bf5", "#FF7A59", "#F59E0B", "#8B5CF6"];
const initials = (n: string) =>
  n.split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
const avColor = (n: string) => AVC[(((n.charCodeAt(0) || 0) + (n.charCodeAt(1) || 0)) % AVC.length)];

function Avatar({ name, size = 48 }: { name: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 999, flexShrink: 0, background: avColor(name), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F, fontWeight: 800, fontSize: size * 0.34 }}>
      {initials(name)}
    </div>
  );
}

function MoneyInput({ value, onChange, placeholder, accent }: { value: string; onChange: (v: string) => void; placeholder?: string; accent?: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", minWidth: 0, height: 58, borderRadius: 15, padding: "0 14px", background: focused ? "#fff" : "#fbfbfc", border: `1.5px solid ${focused ? (accent || "#2BBFAA") : "#eceef3"}`, boxShadow: focused ? `0 0 0 3px ${accent ? "rgba(245,181,68,.16)" : "rgba(43,191,170,.14)"}` : "none", transition: "all .15s" }}>
      <span style={{ fontFamily: F, fontWeight: 800, fontSize: 19, color: "#b0b4c8", marginRight: 6, flexShrink: 0 }}>₴</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
        placeholder={placeholder}
        inputMode="numeric"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ width: "100%", minWidth: 0, border: "none", outline: "none", background: "transparent", fontFamily: F, fontWeight: 800, fontSize: 21, color: "#0f0f1a" }}
      />
    </div>
  );
}

function Lbl({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontFamily: F, fontWeight: 800, fontSize: 16, color: "#0f0f1a", marginBottom: 10 }}>
      {children}
      <span style={{ color: "#2BBFAA" }}> *</span>
    </div>
  );
}

export function AssignTutorDialog({ open, onOpenChange, request, onAssigned }: Props) {
  const [tutors, setTutors] = useState<TutorOption[]>([]);
  const [loadingTutors, setLoadingTutors] = useState(false);
  const [tutorId, setTutorId] = useState<string>("");
  const [subject, setSubject] = useState<string>("");
  const [studentPrice, setStudentPrice] = useState<string>("");
  const [tutorPayout, setTutorPayout] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !request) return;
    setSubject(request.subject ?? "");
    setStudentPrice("");
    setTutorPayout("");
    setTutorId("");
    (async () => {
      setLoadingTutors(true);
      // Load all tutors
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "tutor");
      const tutorIds = (roles ?? []).map((r: any) => r.user_id);
      if (tutorIds.length === 0) {
        setTutors([]);
        setLoadingTutors(false);
        return;
      }
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, archived_at, is_pending")
        .in("id", tutorIds);
      const activeTutors = (profs ?? []).filter(
        (p: any) => !p.archived_at && !p.is_pending,
      );
      const { data: tdetails } = await supabase
        .from("tutor_details")
        .select("user_id, rate_per_lesson")
        .in("user_id", activeTutors.map((p: any) => p.id));
      const rateMap = new Map<string, number>();
      for (const td of tdetails ?? []) {
        if (td.rate_per_lesson != null) rateMap.set(td.user_id, Number(td.rate_per_lesson));
      }
      setTutors(
        activeTutors
          .map((p: any) => ({
            id: p.id,
            name:
              `${(p.first_name ?? "").trim()} ${(p.last_name ?? "").trim()}`.trim() ||
              t("assignTutor.noName"),
            defaultRate: rateMap.get(p.id) ?? null,
          }))
          .sort((a, b) => a.name.localeCompare(b.name, "uk")),
      );
      setLoadingTutors(false);
    })();
  }, [open, request]);

  // When tutor changes — try to prefill payout from their subject rate or default
  useEffect(() => {
    if (!tutorId) return;
    (async () => {
      let payout: number | null = null;
      if (subject.trim()) {
        const { data } = await supabase
          .from("tutor_subject_rates")
          .select("rate_per_lesson")
          .eq("tutor_id", tutorId)
          .eq("subject", subject.trim())
          .maybeSingle();
        if (data?.rate_per_lesson != null) payout = Number(data.rate_per_lesson);
      }
      if (payout == null) {
        const found = tutors.find((x) => x.id === tutorId);
        if (found?.defaultRate != null) payout = found.defaultRate;
      }
      if (payout != null && !tutorPayout) setTutorPayout(String(payout));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutorId, subject]);

  const handleAssign = async () => {
    if (!request) return;
    if (!tutorId) {
      toast.error(t("assignTutor.tutorRequired"));
      return;
    }
    if (!subject.trim()) {
      toast.error(t("assignTutor.subjectRequired"));
      return;
    }
    const sp = Number(studentPrice);
    const tp = Number(tutorPayout);
    if (!Number.isFinite(sp) || sp < 0) {
      toast.error(t("assignTutor.invalidStudentRate"));
      return;
    }
    if (!Number.isFinite(tp) || tp < 0) {
      toast.error(t("assignTutor.invalidTutorRate"));
      return;
    }

    setSubmitting(true);

    // 1. Upsert student_rate (manager hub source)
    const { error: rateErr } = await supabase
      .from("student_rates")
      .upsert(
        {
          tutor_id: tutorId,
          student_id: request.student_id,
          subject: subject.trim(),
          price_per_lesson: sp,
          source: "hub",
        },
        { onConflict: "tutor_id,student_id,subject" },
      );
    if (rateErr) {
      setSubmitting(false);
      toast.error(t("assignTutor.rateFailed") + ": " + rateErr.message);
      return;
    }

    // 2. Upsert tutor_subject_rate (so future autofill works)
    const { error: tsrErr } = await supabase
      .from("tutor_subject_rates")
      .upsert(
        {
          tutor_id: tutorId,
          subject: subject.trim(),
          rate_per_lesson: tp,
        },
        { onConflict: "tutor_id,subject" },
      );
    if (tsrErr) {
      // Non-fatal — log and continue
      console.warn("tutor_subject_rates upsert failed:", tsrErr.message);
    }

    // 3. Mark referral request as fulfilled.
    // SECURITY (SEC-4/MON-2): manager_response is STUDENT-READABLE (referral RLS lets the
    // requesting student read their own row), so it must never contain tutor_payout /
    // hub margin. Keep it student-safe: tutor name + subject only. The actual rates live
    // in student_rates (manager source of truth).
    const tutorName = tutors.find((x) => x.id === tutorId)?.name ?? t("assignTutorExtra.tutorFallback");
    const responseNote = `${t("assignTutorExtra.assigned")}: ${tutorName}. ${t("assignTutorExtra.subjectLabel")}: ${subject.trim()}.`;
    const { error: reqErr } = await supabase
      .from("tutor_referral_requests")
      .update({
        status: "fulfilled",
        manager_response: responseNote,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", request.id);
    if (reqErr) {
      setSubmitting(false);
      toast.error(t("assignTutorExtra.rateCreatedReqFailed", { error: reqErr.message }));
      return;
    }

    // 4. Create chat thread between tutor and student so they can talk
    try {
      await supabase.rpc("get_or_create_chat_thread", {
        _tutor_id: tutorId,
        _student_id: request.student_id,
      });
    } catch (e) {
      // Non-fatal
    }

    // 5. Tell both sides — assignment used to be completely silent: the student
    // (who filed the request) and the tutor (who got a new student) learned about
    // it only by stumbling on the changes. Best-effort, never blocks the flow.
    insertNotification({
      userId: request.student_id,
      type: `tutor_assigned_${request.id}`,
      title: t("assignTutorExtra.studentNotifTitle", { name: tutorName, subject: subject.trim() }),
      link: "/student-dashboard",
    });
    insertNotification({
      userId: tutorId,
      type: `student_assigned_${request.id}`,
      title: t("assignTutorExtra.tutorNotifTitle", { subject: subject.trim() }),
      link: "/chats",
    });

    setSubmitting(false);
    toast.success(t("assignTutorExtra.assigned"));
    onAssigned();
    onOpenChange(false);
  };

  const margin =
    studentPrice && tutorPayout ? Number(studentPrice) - Number(tutorPayout) : null;
  const selected = tutors.find((x) => x.id === tutorId);
  const canAssign = !!tutorId && !!studentPrice && !!tutorPayout && !submitting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden flex flex-col max-h-[92vh] rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto [&>button.absolute]:hidden">
        {/* Header */}
        <div style={{ flexShrink: 0, padding: "20px 20px 16px", borderBottom: "1px solid #eceef3", display: "flex", alignItems: "center", gap: 13 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, flexShrink: 0, background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 16px -6px rgba(43,191,170,.7)" }}>
            <Users size={24} strokeWidth={2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: F, fontWeight: 800, fontSize: 22, letterSpacing: "-.01em", color: "#0f0f1a" }}>{t("assignTutorExtra.title")}</div>
            <div style={{ fontSize: 15, color: "var(--sub,#6b7088)", marginTop: 2 }}>
              {t("assignTutorExtra.studentPrefix")}: <b style={{ color: "#0f0f1a" }}>{request?.studentName}</b>
              {subject ? <> · {subject}</> : null}
            </div>
          </div>
          <button type="button" aria-label={t("common.close")} onClick={() => onOpenChange(false)}
            style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 12, border: "none", cursor: "pointer", background: "#F5F4F0", color: "var(--sub,#6b7088)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={20} strokeWidth={2.2} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Tutor select */}
          <div>
            <Lbl>{t("assignTutorExtra.tutorLabel")}</Lbl>
            {loadingTutors ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", color: "var(--sub,#6b7088)", fontSize: 15 }}>
                <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
              </div>
            ) : tutors.length === 0 ? (
              <div style={{ fontSize: 15, color: "var(--sub,#6b7088)", padding: "6px 0" }}>{t("assignTutorExtra.noTutors")}</div>
            ) : !selected ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {tutors.map((tu) => (
                  <button key={tu.id} type="button" onClick={() => setTutorId(tu.id)}
                    style={{ display: "flex", alignItems: "center", gap: 13, width: "100%", textAlign: "left", padding: 14, borderRadius: 16, border: "1.5px solid #eceef3", background: "#fff", cursor: "pointer", boxShadow: "0 1px 2px rgba(15,15,26,.04)" }}>
                    <Avatar name={tu.name} size={48} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 17, color: "#0f0f1a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tu.name}</div>
                      {tu.defaultRate != null && (
                        <div style={{ fontSize: 15, color: "var(--sub,#6b7088)", marginTop: 1 }}>{t("assignTutorExtra.rateFull", { rate: tu.defaultRate })}</div>
                      )}
                    </div>
                    {tu.defaultRate != null && (
                      <span style={{ fontFamily: F, fontWeight: 800, fontSize: 16, color: "#25a896", whiteSpace: "nowrap" }}>₴{tu.defaultRate}{t("assignTutorExtra.perLessonAbbr")}</span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 13, padding: 14, borderRadius: 16, border: "1.5px solid #2BBFAA", background: "var(--teal-l, #f0fdf9)" }}>
                <Avatar name={selected.name} size={48} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: F, fontWeight: 700, fontSize: 17, color: "#0f0f1a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{selected.name}</div>
                  {selected.defaultRate != null && (
                    <div style={{ fontSize: 15, color: "var(--sub,#6b7088)", marginTop: 1 }}>{t("assignTutorExtra.rateFull", { rate: selected.defaultRate })}</div>
                  )}
                </div>
                <button type="button" onClick={() => setTutorId("")}
                  style={{ height: 44, padding: "0 16px", borderRadius: 12, border: "none", cursor: "pointer", background: "#fff", color: "#25a896", fontFamily: F, fontWeight: 700, fontSize: 15, boxShadow: "0 1px 2px rgba(15,15,26,.06)" }}>
                  {t("assignTutorExtra.change")}
                </button>
              </div>
            )}
          </div>

          {/* Subject fallback — the request carries no subject, so let the manager set
              it here (otherwise handleAssign fails on the required-subject check). */}
          {!request?.subject && (
            <div>
              <Lbl>{t("assignTutorExtra.subjectLabel")}</Lbl>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={t("assignTutorExtra.subjectPlaceholder")}
                style={{ width: "100%", height: 58, borderRadius: 15, padding: "0 14px", background: "#fbfbfc", border: "1.5px solid #eceef3", outline: "none", fontFamily: F, fontWeight: 700, fontSize: 17, color: "#0f0f1a" }}
                onFocus={(e) => { e.target.style.background = "#fff"; e.target.style.border = "1.5px solid #2BBFAA"; e.target.style.boxShadow = "0 0 0 3px rgba(43,191,170,.14)"; }}
                onBlur={(e) => { e.target.style.background = "#fbfbfc"; e.target.style.border = "1.5px solid #eceef3"; e.target.style.boxShadow = "none"; }}
              />
            </div>
          )}

          {/* Prices */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <Lbl>{t("assignTutorExtra.studentRateLabel")}</Lbl>
              <MoneyInput value={studentPrice} onChange={setStudentPrice} placeholder="600" />
            </div>
            <div style={{ minWidth: 0 }}>
              <Lbl>{t("assignTutorExtra.tutorRateLabel")}</Lbl>
              <MoneyInput value={tutorPayout} onChange={setTutorPayout} placeholder="450" accent="#F5B544" />
            </div>
          </div>

          {/* Hub margin — auto */}
          {margin != null && (
            <div style={{ borderRadius: 18, padding: 18, background: "linear-gradient(135deg,#0f0f1a,#1a1a3e)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14, letterSpacing: ".05em", textTransform: "uppercase", color: "rgba(255,255,255,.55)" }}>{t("assignTutorExtra.hubMargin")}</div>
                <div style={{ fontSize: 15, color: "rgba(255,255,255,.65)", marginTop: 3 }}>{t("assignTutorExtra.perLessonSub")}</div>
              </div>
              <div style={{ fontFamily: F, fontWeight: 800, fontSize: 32, letterSpacing: "-.02em", color: margin >= 0 ? "#2BBFAA" : "#FF7A59" }}>₴{margin}</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ flexShrink: 0, padding: "14px 20px 20px", borderTop: "1px solid #eceef3", display: "flex", gap: 10 }}>
          <button type="button" onClick={() => onOpenChange(false)} disabled={submitting}
            style={{ height: 56, padding: "0 22px", borderRadius: 15, border: "1.5px solid #eceef3", background: "#fff", color: "var(--sub,#6b7088)", fontFamily: F, fontWeight: 700, fontSize: 16, cursor: submitting ? "default" : "pointer" }}>
            {t("common.cancel")}
          </button>
          <button type="button" onClick={handleAssign} disabled={!canAssign}
            style={{ flex: 1, height: 56, borderRadius: 15, border: "none", cursor: canAssign ? "pointer" : "not-allowed", background: canAssign ? "linear-gradient(135deg,#2BBFAA,#25a896)" : "#e7e9ef", color: canAssign ? "#fff" : "#b0b4c8", fontFamily: F, fontWeight: 700, fontSize: 17, boxShadow: canAssign ? "0 6px 16px -6px rgba(43,191,170,.7)" : "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9 }}>
            {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check size={21} strokeWidth={2.4} />}
            {t("assignTutorExtra.assignBtn")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
