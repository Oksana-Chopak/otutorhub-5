import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Video } from "lucide-react";
import { InviteLinkDialog } from "@/components/InviteLinkDialog";
import { SubjectSelect } from "@/components/SubjectSelect";
import { sanitizeHttpUrl } from "@/lib/safeUrl";
import { CURRENCY_OPTIONS, currencySymbol } from "@/lib/currency";
import { useTranslation } from "react-i18next";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: () => void;
}

const empty = {
  first_name: "",
  last_name: "",
  phone: "",
  email: "",
  telegram: "",
  subject: "",
  price: "",
  currency: "UAH",
  default_meeting_url: "",
};

/**
 * Lightweight inline dialog to add a student without leaving the page.
 * Mirrors the create flow of MyStudentsPage. Only for independent tutors.
 */
export function QuickAddStudentDialog({ open, onOpenChange, onCreated }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [form, setForm] = useState(empty);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<1|2>(1);
  const [invite, setInvite] = useState<{
    open: boolean;
    name: string;
    email: string | null;
    phone: string | null;
    studentId: string | null;
    emailSent: boolean;
  } | null>(null);

  const submit = async () => {
    if (!user) return;
    const fn = form.first_name.trim();
    const ln = form.last_name.trim();
    const email = form.email.trim() || null;
    const phone = form.phone.trim() || null;
    const subject = form.subject.trim();
    const price = Number(form.price);
    const currency = form.currency || "UAH";

    if (!fn) return toast.error(t("quickAddStudent.nameRequired"));
    if (!email && !phone) return toast.error(t("quickAddStudent.contactRequired"));
    if (!subject) return toast.error(t("quickAddStudent.subjectRequired"));
    if (isNaN(price) || price < 0) return toast.error(t("quickAddStudent.invalidPrice"));

    setSubmitting(true);
    const newId = crypto.randomUUID();

    const { error: profErr } = await supabase
      .from("profiles")
      .insert({ id: newId, first_name: fn, last_name: ln, is_pending: true });
    if (profErr) {
      setSubmitting(false);
      return toast.error(profErr.message || t("quickAddStudent.createFailed"));
    }
    const { error: roleErr } = await supabase
      .from("user_roles")
      .insert({ user_id: newId, role: "student" });
    if (roleErr) {
      await supabase.from("profiles").delete().eq("id", newId);
      setSubmitting(false);
      return toast.error(t("quickAddStudent.roleFailed"));
    }
    const { error: rateErr } = await supabase.from("student_rates").insert({
      tutor_id: user.id,
      student_id: newId,
      subject,
      price_per_lesson: price,
      currency,
      source: "independent",
    });
    if (rateErr) {
      await supabase.from("user_roles").delete().eq("user_id", newId);
      await supabase.from("profiles").delete().eq("id", newId);
      setSubmitting(false);
      return toast.error(t("quickAddStudent.priceFailed"));
    }
    const { error: contErr } = await supabase.from("profile_contacts").insert({
      user_id: newId,
      email,
      phone,
      telegram: form.telegram.trim() || null,
    });
    if (contErr) {
      await supabase.from("student_rates").delete().eq("tutor_id", user.id).eq("student_id", newId);
      await supabase.from("user_roles").delete().eq("user_id", newId);
      await supabase.from("profiles").delete().eq("id", newId);
      setSubmitting(false);
      return toast.error(
        String(contErr.message || "").includes("email_lower")
          ? t("quickAddStudent.emailTaken")
          : t("quickAddStudent.contactsFailed")
      );
    }
    await supabase.from("student_details").upsert({ user_id: newId }, { onConflict: "user_id" });
    const meetingUrlRaw = form.default_meeting_url.trim();
    const meetingUrl = meetingUrlRaw ? sanitizeHttpUrl(meetingUrlRaw) : "";
    if (meetingUrlRaw && !meetingUrl) {
      setSubmitting(false);
      return toast.error(t("quickAddStudent.invalidMeetingUrl"));
    }
    if (meetingUrl) {
      await supabase.from("tutor_student_defaults").upsert(
        { tutor_id: user.id, student_id: newId, default_meeting_url: meetingUrl },
        { onConflict: "tutor_id,student_id" }
      );
    }

    toast.success(t("quickAddStudent.studentAdded"));
    let inviteSent = false;
    if (email) {
      const { data: resp } = await supabase.functions.invoke("send-student-invite", {
        body: { studentId: newId },
      });
      if ((resp as any)?.success) inviteSent = true;
    }

    setSubmitting(false);
    setForm(empty);
    onOpenChange(false);
    setInvite({
      open: true,
      name: `${fn} ${ln}`.trim(),
      email,
      phone,
      studentId: newId,
      emailSent: inviteSent,
    });
    onCreated?.();
  };

  // ── helpers ────────────────────────────────────────────────────────────────
  const F = {
    teal: "#2BBFAA", tealD: "#25a896", tealL: "#f0fdf9",
    border: "#eceef3", bg: "#fbfbfc", txt: "#0f0f1a",
    sub: "#9398b0", muted: "#b0b4c8",
    display: "Inter, system-ui, sans-serif",
    body: "'Plus Jakarta Sans', system-ui, sans-serif",
  };
  const fInitials = ((form.first_name?.[0] ?? "") + (form.last_name?.[0] ?? "")).toUpperCase();
  const SUBS = [
    t("quickAddStudent.subjectEnglish"),
    t("quickAddStudent.subjectMath"),
    t("quickAddStudent.subjectPhysics"),
    t("quickAddStudent.subjectChemistry"),
    t("quickAddStudent.subjectUkrainian"),
    t("quickAddStudent.subjectBiology"),
    t("quickAddStudent.subjectInformatics"),
    t("quickAddStudent.subjectGerman"),
  ];
  const subMatches = (() => {
    const q = (form.subject || "").trim().toLowerCase();
    const selected = SUBS.filter(s => s.toLowerCase() === form.subject.toLowerCase());
    return (selected.length > 0 ? SUBS.filter(s => s !== form.subject) : (q ? SUBS.filter(s => s.toLowerCase().includes(q)) : SUBS)).slice(0, 6);
  })();
  const inpSt = (): React.CSSProperties => ({
    width: "100%", height: 48, borderRadius: 13, padding: "0 14px",
    fontSize: 15.5, fontFamily: F.body, color: F.txt, background: F.bg,
    border: `1.5px solid ${F.border}`, outline: "none", boxSizing: "border-box" as const,
  });
  const lblSt: React.CSSProperties = { fontFamily: F.display, fontSize: 14, fontWeight: 700, color: F.sub, marginBottom: 7, display: "block" };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) { setStep(1); } onOpenChange(v); }}>
        <DialogContent className="max-w-[440px] p-0 gap-0 rounded-t-[26px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] max-h-[86vh] overflow-y-auto">
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div style={{ width: 38, height: 5, borderRadius: 999, background: "rgba(15,15,26,.14)" }} />
          </div>

          {/* Step dots */}
          <div style={{ display: "flex", justifyContent: "center", gap: 8, paddingBottom: 4 }}>
            {([1, 2] as const).map(n => (
              <div key={n} style={{ width: step === n ? 28 : 8, height: 8, borderRadius: 999,
                background: step === n ? F.teal : "rgba(15,15,26,.15)",
                transition: "width .25s ease" }} />
            ))}
          </div>

          <div style={{ padding: "16px 20px 24px" }}>
            {/* Step header */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 20 }}>
              {fInitials ? (
                <div style={{ width: 48, height: 48, borderRadius: 14, flexShrink: 0,
                  background: "linear-gradient(135deg,#2BBFAA,#25a896)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: F.display, fontWeight: 800, fontSize: 18, color: "#0f0f1a",
                  boxShadow: "0 4px 12px -4px rgba(43,191,170,.5)", transition: "all .3s" }}>
                  {fInitials}
                </div>
              ) : (
                <div style={{ width: 48, height: 48, borderRadius: 14, flexShrink: 0,
                  background: "#fff", border: `1.5px solid ${F.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="8" r="4" stroke="#b0b4c8" strokeWidth="1.8"/>
                    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="#b0b4c8" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                </div>
              )}
              <div>
                <p style={{ fontFamily: F.display, fontWeight: 800, fontSize: 19, color: F.txt, lineHeight: 1.2 }}>
                  {step === 1 ? t("quickAddStudent.step1Title") : t("quickAddStudent.step2Title")}
                </p>
                <p style={{ fontSize: 14, color: F.sub, marginTop: 3, fontFamily: F.body }}>
                  {step === 1
                    ? t("quickAddStudent.step1Subtitle")
                    : t("quickAddStudent.step2Subtitle", { firstName: form.first_name, lastName: form.last_name, subject: form.subject, price: form.price })}
                </p>
              </div>
            </div>

            {/* ── STEP 1 ── */}
            {step === 1 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* Name row */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <span style={lblSt}>{t("quickAddStudent.firstName")} <span style={{ color: F.teal }}>*</span></span>
                    <input aria-label={t("quickAddStudent.firstName")} style={inpSt()} placeholder={t("quickAddStudent.firstNamePlaceholder")}
                      value={form.first_name}
                      onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
                      onFocus={e => { e.target.style.borderColor = F.teal; e.target.style.boxShadow = "0 0 0 3px rgba(43,191,170,.12)"; e.target.style.background = "#fff"; }}
                      onBlur={e => { e.target.style.borderColor = F.border; e.target.style.boxShadow = "none"; e.target.style.background = F.bg; }}
                    />
                  </div>
                  <div>
                    <span style={lblSt}>{t("quickAddStudent.lastName")}</span>
                    <input aria-label={t("quickAddStudent.lastName")} style={inpSt()} placeholder={t("quickAddStudent.lastNamePlaceholder")}
                      value={form.last_name}
                      onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
                      onFocus={e => { e.target.style.borderColor = F.teal; e.target.style.boxShadow = "0 0 0 3px rgba(43,191,170,.12)"; e.target.style.background = "#fff"; }}
                      onBlur={e => { e.target.style.borderColor = F.border; e.target.style.boxShadow = "none"; e.target.style.background = F.bg; }}
                    />
                  </div>
                </div>

                {/* Subject */}
                <div>
                  <span style={lblSt}>{t("quickAddStudent.subject")} <span style={{ color: F.teal }}>*</span></span>
                  <input aria-label={t("quickAddStudent.subject")} style={inpSt()} placeholder={t("quickAddStudent.subjectPlaceholder")}
                    value={form.subject}
                    onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                    onFocus={e => { e.target.style.borderColor = F.teal; e.target.style.boxShadow = "0 0 0 3px rgba(43,191,170,.12)"; e.target.style.background = "#fff"; }}
                    onBlur={e => { e.target.style.borderColor = F.border; e.target.style.boxShadow = "none"; e.target.style.background = F.bg; }}
                  />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 10 }}>
                    {subMatches.map(s => {
                      const active = form.subject === s;
                      return (
                        <button key={s}
                          onMouseDown={e => { e.preventDefault(); setForm(f => ({ ...f, subject: s })); }}
                          style={{ height: 36, padding: "0 13px", borderRadius: 999, cursor: "pointer",
                            border: active ? `1.5px solid ${F.teal}` : `1px solid ${F.border}`,
                            background: active ? F.tealL : "#fff",
                            color: active ? F.tealD : F.txt,
                            fontFamily: F.body, fontWeight: 600, fontSize: 14 }}>
                          {s}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Price + Currency */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <span style={lblSt}>{t("quickAddStudent.pricePerLesson")} <span style={{ color: F.teal }}>*</span></span>
                    <input aria-label={t("quickAddStudent.pricePerLesson")} type="number" min={0} style={inpSt()} placeholder="500"
                      value={form.price}
                      onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                      onFocus={e => { e.target.style.borderColor = F.teal; e.target.style.boxShadow = "0 0 0 3px rgba(43,191,170,.12)"; e.target.style.background = "#fff"; }}
                      onBlur={e => { e.target.style.borderColor = F.border; e.target.style.boxShadow = "none"; e.target.style.background = F.bg; }}
                    />
                  </div>
                  <div>
                    <span style={lblSt}>{t("quickAddStudent.currency")}</span>
                    <div style={{ display: "flex", gap: 4, height: 48, alignItems: "center",
                      background: F.bg, borderRadius: 13, padding: "4px 6px",
                      border: `1.5px solid ${F.border}` }}>
                      {(["UAH","USD","EUR","PLN"] as const).map(cur => (
                        <button key={cur}
                          onClick={() => setForm(f => ({ ...f, currency: cur }))}
                          style={{ flex: 1, height: 36, borderRadius: 9, border: "none",
                            background: form.currency === cur ? "#fff" : "transparent",
                            boxShadow: form.currency === cur ? "0 1px 3px rgba(15,15,26,.12)" : "none",
                            fontFamily: F.display, fontWeight: 700, fontSize: 13,
                            color: form.currency === cur ? F.tealD : F.muted, cursor: "pointer" }}>
                          {cur === "UAH" ? "₴" : cur === "USD" ? "$" : cur === "EUR" ? "€" : "zł"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Next button */}
                <button
                  onClick={() => {
                    if (!form.first_name.trim()) return;
                    if (!form.subject.trim()) return;
                    setStep(2);
                  }}
                  style={{ width: "100%", height: 52, borderRadius: 14, border: "none", cursor: "pointer",
                    background: form.first_name.trim() && form.subject.trim()
                      ? "linear-gradient(135deg,#2BBFAA,#25a896)"
                      : "rgba(43,191,170,.35)",
                    color: "#0f0f1a", fontFamily: F.display, fontWeight: 700, fontSize: 16,
                    boxShadow: "0 8px 20px -8px rgba(43,191,170,.55)", marginTop: 4 }}>
                  {t("quickAddStudent.nextToContacts")}
                </button>
              </div>
            )}

            {/* ── STEP 2 ── */}
            {step === 2 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* Email / Telegram */}
                <div>
                  <span style={lblSt}>{t("quickAddStudent.emailOrTelegram")} <span style={{ color: F.teal }}>*</span></span>
                  <input aria-label={t("quickAddStudent.emailOrTelegram")} style={inpSt()} placeholder={t("quickAddStudent.emailOrTelegramPlaceholder")}
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    onFocus={e => { e.target.style.borderColor = F.teal; e.target.style.boxShadow = "0 0 0 3px rgba(43,191,170,.12)"; e.target.style.background = "#fff"; }}
                    onBlur={e => { e.target.style.borderColor = F.border; e.target.style.boxShadow = "none"; e.target.style.background = F.bg; }}
                  />
                </div>

                {/* Phone */}
                <div>
                  <span style={lblSt}>{t("quickAddStudent.phone")}</span>
                  <input aria-label={t("quickAddStudent.phone")} type="tel" style={inpSt()} placeholder="+380 67 123 45 67"
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    onFocus={e => { e.target.style.borderColor = F.teal; e.target.style.boxShadow = "0 0 0 3px rgba(43,191,170,.12)"; e.target.style.background = "#fff"; }}
                    onBlur={e => { e.target.style.borderColor = F.border; e.target.style.boxShadow = "none"; e.target.style.background = F.bg; }}
                  />
                </div>

                {/* Invite hint */}
                <div style={{ padding: "12px 14px", borderRadius: 13, background: "rgba(43,191,170,.07)",
                  border: "1px solid rgba(43,191,170,.2)", fontSize: 14, color: F.sub, fontFamily: F.body }}>
                  {t("quickAddStudent.inviteHint")}
                </div>

                {/* Submit */}
                <button
                  disabled={submitting || (!form.email.trim() && !form.phone.trim())}
                  onClick={submit}
                  style={{ width: "100%", height: 52, borderRadius: 14, border: "none",
                    cursor: submitting ? "not-allowed" : "pointer",
                    background: "linear-gradient(135deg,#2BBFAA,#25a896)",
                    color: "#0f0f1a", fontFamily: F.display, fontWeight: 700, fontSize: 16,
                    boxShadow: "0 8px 20px -8px rgba(43,191,170,.55)",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  {submitting && <span className="animate-spin">⟳</span>}
                  {t("quickAddStudent.addStudent")}
                </button>

                {/* Back */}
                <button onClick={() => setStep(1)}
                  style={{ width: "100%", height: 44, borderRadius: 12, cursor: "pointer",
                    border: `1px solid ${F.border}`, background: "#fff",
                    fontFamily: F.display, fontWeight: 600, fontSize: 15, color: F.sub }}>
                  {t("quickAddStudent.back")}
                </button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* InviteLinkDialog — незмінний */}
      {invite && (
        <InviteLinkDialog
          open={invite.open}
          onOpenChange={(v) => setInvite((p) => (p ? { ...p, open: v } : p))}
          personName={invite.name}
          email={invite.email}
          phone={invite.phone}
          studentId={invite.studentId}
          emailSent={invite.emailSent}
          role="student"
        />
      )}
    </>
  );
}
