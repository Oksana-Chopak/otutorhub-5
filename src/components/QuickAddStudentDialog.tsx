import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Check, ChevronDown, Info, Loader2, Lock } from "lucide-react";
import { InviteLinkDialog } from "@/components/InviteLinkDialog";
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
  notes: "",
};

/**
 * Lightweight inline dialog to add a student without leaving the page.
 * Mirrors the create flow of MyStudentsPage. Only for independent tutors.
 * Single-flow (SF_A) layout: one screen, progressive disclosure for contacts/details.
 */
export function QuickAddStudentDialog({ open, onOpenChange, onCreated }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [form, setForm] = useState(empty);
  const [submitting, setSubmitting] = useState(false);
  const [more, setMore] = useState(false);
  const [tried, setTried] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [invite, setInvite] = useState<{
    open: boolean;
    name: string;
    email: string | null;
    phone: string | null;
    studentId: string | null;
    emailSent: boolean;
  } | null>(null);

  const reset = () => {
    setForm(empty);
    setMore(false);
    setTried(false);
    setCurrencyOpen(false);
  };

  // ── validation (matches MyStudentsPage rules) ──────────────────────────────
  const fnTrim = form.first_name.trim();
  const lnTrim = form.last_name.trim();
  const emailTrim = form.email.trim();
  const phoneTrim = form.phone.trim();
  const nameError = !fnTrim && !lnTrim;
  const contactError = !emailTrim && !phoneTrim;

  const submit = async () => {
    if (!user) return;
    setTried(true);

    const fn = fnTrim;
    const ln = lnTrim;
    const email = emailTrim || null;
    const phone = phoneTrim || null;
    const subject = form.subject.trim();
    const price = Number(form.price);
    const currency = form.currency || "UAH";

    if (!fn && !ln) return toast.error(t("quickAddStudent.nameRequired"));
    if (!email && !phone) {
      if (!more) setMore(true);
      return toast.error(t("quickAddStudent.contactRequired"));
    }
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
    // Ensure a student_details row exists (no per-student tutor_notes column).
    try {
      await supabase
        .from("student_details")
        .upsert({ user_id: newId }, { onConflict: "user_id" });
    } catch {
      /* best-effort */
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
    reset();
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

  // ── design tokens ──────────────────────────────────────────────────────────
  const F = {
    teal: "#2BBFAA", tealD: "#25a896", tealL: "#f0fdf9",
    border: "#eceef3", bg: "#fbfbfc", txt: "#0f0f1a",
    sub: "#9398b0", muted: "#b0b4c8", warnD: "#B4740B",
    display: "Inter, system-ui, sans-serif",
    body: "'Plus Jakarta Sans', system-ui, sans-serif",
  };
  const fInitials = ((form.first_name?.[0] ?? "") + (form.last_name?.[0] ?? "")).toUpperCase();
  const filled = !!(fnTrim || lnTrim);

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

  // Spec SF_A: exactly five currencies — ₴/$/€/zł/kr (UAH/USD/EUR/PLN/SEK).
  const CURRENCIES = CURRENCY_OPTIONS.filter(c => ["UAH", "USD", "EUR", "PLN", "SEK"].includes(c.code));
  const sym = currencySymbol(form.currency);
  const curOption = CURRENCIES.find(c => c.code === form.currency) ?? CURRENCIES[0];

  const inpSt = (): React.CSSProperties => ({
    width: "100%", height: 44, borderRadius: 13, padding: "0 14px",
    fontSize: 15, fontFamily: F.body, color: F.txt, background: F.bg,
    border: `1.5px solid ${F.border}`, outline: "none", boxSizing: "border-box" as const,
  });
  const lblSt: React.CSSProperties = { fontFamily: F.display, fontSize: 13, fontWeight: 700, color: F.sub, marginBottom: 7, display: "block" };
  const focusOn = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = F.teal; e.target.style.boxShadow = "0 0 0 3px rgba(43,191,170,.12)"; e.target.style.background = "#fff";
  };
  const focusOff = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = F.border; e.target.style.boxShadow = "none"; e.target.style.background = F.bg;
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
        <DialogContent className="max-w-[480px] p-0 gap-0 rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] max-h-[90vh] overflow-y-auto">
          {/* Drag handle */}
          <div className="flex justify-center pt-2.5 pb-1 sm:hidden">
            <div style={{ width: 38, height: 4, borderRadius: 999, background: "rgba(15,15,26,.14)" }} />
          </div>

          {/* Header */}
          <div style={{ padding: "16px 22px 4px" }}>
            <p style={{ fontFamily: F.display, fontWeight: 800, fontSize: 21, color: F.txt, lineHeight: 1.2, letterSpacing: "-0.01em" }}>
              {t("quickAddStudent.title")}
            </p>
            <p style={{ fontSize: 13.5, color: F.sub, marginTop: 4, lineHeight: 1.45, fontFamily: F.body }}>
              {t("quickAddStudent.desc")}
            </p>
          </div>

          <div style={{ padding: "12px 22px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Avatar + name */}
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div style={{ paddingTop: 24, flexShrink: 0 }}>
                {filled ? (
                  <div style={{ width: 60, height: 60, borderRadius: 20, flexShrink: 0,
                    background: "linear-gradient(135deg,#2BBFAA,#25a896)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: F.display, fontWeight: 800, fontSize: 22, color: "#0f0f1a",
                    boxShadow: "0 8px 20px -8px rgba(43,191,170,.55)", transition: "all .3s cubic-bezier(.34,1.4,.64,1)" }}>
                    {fInitials}
                  </div>
                ) : (
                  <div style={{ width: 60, height: 60, borderRadius: 20, flexShrink: 0, position: "relative",
                    background: "#fff", border: `1.5px solid ${F.border}`,
                    display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="8" r="4" stroke="#b0b4c8" strokeWidth="1.6"/>
                      <path d="M5 20a7 7 0 0114 0" stroke="#b0b4c8" strokeWidth="1.6" strokeLinecap="round"/>
                    </svg>
                    <span style={{ position: "absolute", right: -3, bottom: -3, width: 24, height: 24, borderRadius: 999,
                      background: "linear-gradient(135deg,#2BBFAA,#25a896)", boxShadow: "0 0 0 2.5px #fff",
                      display: "flex", alignItems: "center", justifyContent: "center", color: "#0f0f1a" }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 8.5A1.5 1.5 0 014.5 7h2L8 5h8l1.5 2h2A1.5 1.5 0 0121 8.5v10A1.5 1.5 0 0119.5 20h-15A1.5 1.5 0 013 18.5z"/>
                        <circle cx="12" cy="13" r="3.2"/>
                      </svg>
                    </span>
                  </div>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <span style={lblSt}>{t("quickAddStudent.firstName")} <span style={{ color: F.teal }}>*</span></span>
                  <input aria-label={t("quickAddStudent.firstName")}
                    style={{ ...inpSt(), height: 48, fontSize: 16, fontWeight: 700, fontFamily: F.display,
                      borderColor: tried && nameError ? "rgba(245,158,11,0.55)" : F.border }}
                    placeholder={t("quickAddStudent.firstNamePlaceholder")}
                    value={form.first_name}
                    onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
                    onFocus={focusOn} onBlur={focusOff}
                  />
                </div>
                <div>
                  <span style={lblSt}>{t("quickAddStudent.lastName")}</span>
                  <input aria-label={t("quickAddStudent.lastName")}
                    style={{ ...inpSt(), borderColor: tried && nameError ? "rgba(245,158,11,0.55)" : F.border }}
                    placeholder={t("quickAddStudent.lastNamePlaceholder")}
                    value={form.last_name}
                    onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
                    onFocus={focusOn} onBlur={focusOff}
                  />
                </div>
              </div>
            </div>
            {tried && nameError && (
              <div style={{ fontSize: 12, color: F.warnD, marginTop: -8, fontWeight: 600, fontFamily: F.body }}>
                {t("quickAddStudent.nameRequired")}
              </div>
            )}

            {/* Subject */}
            <div>
              <span style={lblSt}>{t("quickAddStudent.subject")} <span style={{ color: F.teal }}>*</span></span>
              <input aria-label={t("quickAddStudent.subject")} style={inpSt()} placeholder={t("quickAddStudent.subjectPlaceholder")}
                value={form.subject}
                onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                onFocus={focusOn} onBlur={focusOff}
              />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 10 }}>
                {subMatches.map(s => {
                  const active = form.subject === s;
                  return (
                    <button key={s}
                      onMouseDown={e => { e.preventDefault(); setForm(f => ({ ...f, subject: s })); }}
                      style={{ minHeight: 36, padding: "0 13px", borderRadius: 999, cursor: "pointer",
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

            {/* Price card — cream-gold accent */}
            <div style={{ borderRadius: 16, padding: 16,
              background: "linear-gradient(135deg,#FFF7E6,#FFEFD0)",
              border: "1px solid rgba(245,181,68,.4)" }}>
              <span style={{ ...lblSt, color: "#9a7212", marginBottom: 10, display: "flex", alignItems: "center", gap: 5 }}>
                💛 {t("quickAddStudent.pricePerLesson")} <span style={{ color: F.teal }}>*</span>
              </span>
              <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 10, alignItems: "stretch" }}>
                <input aria-label={t("quickAddStudent.pricePerLesson")} inputMode="decimal" min={0}
                  style={{ ...inpSt(), height: 48, fontSize: 18, fontWeight: 700, fontFamily: F.display, background: "#fff",
                    border: "1.5px solid rgba(245,181,68,.4)" }}
                  placeholder="500"
                  value={form.price}
                  onChange={e => setForm(f => ({ ...f, price: e.target.value.replace(/[^\d.]/g, "") }))}
                  onFocus={e => { e.target.style.borderColor = F.teal; e.target.style.boxShadow = "0 0 0 3px rgba(43,191,170,.12)"; }}
                  onBlur={e => { e.target.style.borderColor = "rgba(245,181,68,.4)"; e.target.style.boxShadow = "none"; }}
                />
                <div style={{ position: "relative" }}>
                  <button type="button" aria-label={t("quickAddStudent.currency")}
                    onClick={() => setCurrencyOpen(v => !v)}
                    style={{ width: "100%", height: 48, borderRadius: 13, padding: "0 12px", cursor: "pointer",
                      background: "#fff", border: "1.5px solid rgba(245,181,68,.4)",
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      fontFamily: F.body, fontWeight: 600, fontSize: 15, color: F.txt }}>
                    <span><span style={{ color: F.tealD, fontWeight: 800, marginRight: 6 }}>{sym}</span>{curOption.code}</span>
                    <ChevronDown size={16} style={{ color: F.muted, transform: currencyOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
                  </button>
                  {currencyOpen && (
                    <>
                      <div onClick={() => setCurrencyOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                      <div style={{ position: "absolute", top: 54, left: 0, right: 0, zIndex: 41, background: "#fff",
                        borderRadius: 13, border: `1px solid ${F.border}`, boxShadow: "0 4px 16px rgba(15,15,26,.08)", overflow: "hidden", padding: 5 }}>
                        {CURRENCIES.map(c => {
                          const sel = c.code === form.currency;
                          return (
                            <button key={c.code} type="button"
                              onClick={() => { setForm(f => ({ ...f, currency: c.code })); setCurrencyOpen(false); }}
                              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 44, padding: "0 11px",
                                borderRadius: 9, border: "none", cursor: "pointer", textAlign: "left",
                                background: sel ? "rgba(43,191,170,0.10)" : "transparent",
                                color: sel ? F.tealD : F.txt, fontFamily: F.body, fontWeight: 600, fontSize: 14.5 }}>
                              <span style={{ width: 22, fontWeight: 800, color: sel ? F.tealD : F.sub }}>{currencySymbol(c.code)}</span>
                              {c.code}
                              {sel && <Check size={15} style={{ marginLeft: "auto", color: F.tealD }} />}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Hairline divider */}
            <div style={{ height: 1, background: F.border }} />

            {/* Progressive disclosure toggle */}
            <button type="button" onClick={() => setMore(v => !v)}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                minHeight: 44, borderRadius: 12, cursor: "pointer",
                border: `1px dashed ${tried && contactError ? "rgba(245,158,11,0.6)" : F.border}`,
                background: tried && contactError ? "rgba(245,158,11,0.05)" : "transparent",
                color: tried && contactError ? F.warnD : F.sub, fontFamily: F.display, fontWeight: 700, fontSize: 14 }}>
              <ChevronDown size={15} style={{ transform: more ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
              {more ? t("quickAddStudent.hideExtra") : t("quickAddStudent.addContactsDetails")}
            </button>

            {more && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* Contacts block */}
                <div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div>
                      <span style={lblSt}>{t("quickAddStudent.phone")}</span>
                      <input aria-label={t("quickAddStudent.phone")} type="tel"
                        style={{ ...inpSt(), borderColor: tried && contactError ? "rgba(245,158,11,0.55)" : F.border }}
                        placeholder="+380 67 123 45 67"
                        value={form.phone}
                        onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                        onFocus={focusOn} onBlur={focusOff}
                      />
                    </div>
                    <div>
                      <span style={lblSt}>{t("quickAddStudent.email")}</span>
                      <input aria-label={t("quickAddStudent.email")} type="email"
                        style={{ ...inpSt(), borderColor: tried && contactError ? "rgba(245,158,11,0.55)" : F.border }}
                        placeholder="anna@mail.com"
                        value={form.email}
                        onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                        onFocus={focusOn} onBlur={focusOff}
                      />
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8,
                    fontSize: 13, lineHeight: 1.4, fontFamily: F.body,
                    color: tried && contactError ? F.warnD : F.muted,
                    fontWeight: tried && contactError ? 600 : 400 }}>
                    <Info size={13} style={{ flexShrink: 0 }} />
                    {tried && contactError ? t("quickAddStudent.contactRequired") : t("quickAddStudent.contactHint")}
                  </div>
                </div>

                {/* Telegram */}
                <div>
                  <span style={lblSt}>{t("quickAddStudent.telegram")}</span>
                  <input aria-label={t("quickAddStudent.telegram")} style={inpSt()}
                    placeholder={t("quickAddStudent.telegramPlaceholder")}
                    value={form.telegram}
                    onChange={e => setForm(f => ({ ...f, telegram: e.target.value }))}
                    onFocus={focusOn} onBlur={focusOff}
                  />
                </div>

                {/* Private notes */}
                <div>
                  <span style={{ ...lblSt, display: "flex", alignItems: "center", gap: 5 }}>
                    <Lock size={13} style={{ color: F.sub }} /> {t("quickAddStudent.notesLabel")}
                  </span>
                  <textarea aria-label={t("quickAddStudent.notesLabel")} rows={3}
                    style={{ width: "100%", borderRadius: 13, padding: "12px 14px", resize: "none", lineHeight: 1.5,
                      fontSize: 15, fontFamily: F.body, color: F.txt, outline: "none", boxSizing: "border-box" as const,
                      background: "#FFFCF4", border: "1.5px solid rgba(245,181,68,.35)" }}
                    placeholder={t("quickAddStudent.notesPlaceholder")}
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    onFocus={e => { e.target.style.borderColor = "#F5B544"; e.target.style.boxShadow = "0 0 0 3px rgba(245,181,68,.12)"; }}
                    onBlur={e => { e.target.style.borderColor = "rgba(245,181,68,.35)"; e.target.style.boxShadow = "none"; }}
                  />
                </div>
              </div>
            )}

            {/* Footer */}
            <div style={{ display: "flex", gap: 11, marginTop: 4 }}>
              <button type="button" onClick={() => { reset(); onOpenChange(false); }}
                style={{ height: 50, padding: "0 20px", borderRadius: 14, cursor: "pointer", flexShrink: 0,
                  border: `1px solid ${F.border}`, background: "#fff",
                  fontFamily: F.display, fontWeight: 700, fontSize: 15, color: F.sub }}>
                {t("quickAddStudent.cancelBtn")}
              </button>
              <button type="button" disabled={submitting} onClick={submit}
                style={{ flex: 1, height: 50, borderRadius: 14, border: "none",
                  cursor: submitting ? "not-allowed" : "pointer",
                  background: "linear-gradient(135deg,#2BBFAA,#25a896)",
                  color: "#0f0f1a", fontFamily: F.display, fontWeight: 700, fontSize: 16,
                  boxShadow: "0 8px 20px -8px rgba(43,191,170,.55)",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {submitting && <Loader2 size={18} className="animate-spin" />}
                {t("quickAddStudent.addStudent")}
              </button>
            </div>
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
