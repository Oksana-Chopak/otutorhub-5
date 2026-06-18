import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { X, Loader2 } from "lucide-react";
import { currencySymbol } from "@/lib/currency";
import { SubjectMultiSelect } from "@/components/SubjectMultiSelect";
import type { AppRole } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";

export interface PersonEditPair {
  id: string;
  subject: string | null;
  tutor_id: string;
  price_per_lesson: number | null;
  currency: string | null;
}

export interface PersonEditTarget {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  telegram: string | null;
  messenger_url?: string | null;
  facebook_url?: string | null;
  instagram_url?: string | null;
  bank_name?: string | null;
  bank_card_last4?: string | null;
  subjects?: string[] | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  person: PersonEditTarget;
  role: AppRole | null;
  /** Student-only: the per-tutor rate rows (read-only summary). */
  pairs?: PersonEditPair[];
  tutorNameOf?: (tutorId: string) => string;
  onSaved: () => void;
}

/**
 * One canonical person editor in the approved SF_A «Один потік» design language
 * (same shell as MyStudentsPage's add/edit form and the former StudentEditSheet).
 * Replaces the divergent ContactEditDialog so every ✏️ edit on People opens the
 * same form. Per PEOPLE-HANDOFF / STUDENT-FORM-HANDOFF.
 *
 * Sections by role:
 *  - student  → read-only gold per-tutor rates summary (rates are per pair on the hub).
 *  - tutor    → editable subjects (gold card) + payout (bank/card).
 *  - manager  → identity + contacts only.
 * All roles: avatar+name, contacts (phone/email/telegram + socials), private manager note.
 */
export function PersonEditSheet({ open, onOpenChange, person, role, pairs = [], tutorNameOf, onSaved }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isTutor = role === "tutor";
  const isStudent = role === "student";

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [telegram, setTelegram] = useState("");
  const [messenger, setMessenger] = useState("");
  const [facebook, setFacebook] = useState("");
  const [instagram, setInstagram] = useState("");
  const [bankName, setBankName] = useState("");
  const [cardLast4, setCardLast4] = useState("");
  const [cardInput, setCardInput] = useState("");
  const [subjects, setSubjects] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [noteId, setNoteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFirstName(person.first_name ?? "");
    setLastName(person.last_name ?? "");
    setPhone(person.phone ?? "");
    setEmail(person.email ?? "");
    setTelegram(person.telegram ?? "");
    setMessenger(person.messenger_url ?? "");
    setFacebook(person.facebook_url ?? "");
    setInstagram(person.instagram_url ?? "");
    setBankName(person.bank_name ?? "");
    setCardLast4(person.bank_card_last4 ?? "");
    setCardInput("");
    setSubjects(person.subjects ?? []);
    setNotes("");
    setNoteId(null);
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("manager_notes")
        .select("id, content")
        .eq("author_id", user.id)
        .eq("subject_user_id", person.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        setNoteId((data as any).id);
        setNotes((data as any).content ?? "");
      }
    })();
  }, [open, person.id, user?.id]);

  const F = {
    border: "#eceef3", bg: "#fbfbfc", chip: "#F5F4F0", teal: "#2BBFAA", tealD: "#25a896",
    txt: "#0f0f1a", sub: "#9398b0", muted: "#b0b4c8", gold: "#9a6a12",
    display: "Inter, system-ui, sans-serif", body: "'Plus Jakarta Sans', system-ui, sans-serif",
  };
  const inp = (big?: boolean): React.CSSProperties => ({
    width: "100%", height: big ? 56 : 50, borderRadius: 13, padding: "0 14px",
    fontSize: big ? 18 : 16, fontWeight: big ? 700 : 500,
    fontFamily: big ? F.display : F.body, color: F.txt, background: F.bg,
    border: `1.5px solid ${F.border}`, outline: "none", boxSizing: "border-box", transition: "all .15s",
  });
  const focusOn = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = F.teal; e.target.style.boxShadow = "0 0 0 3px rgba(43,191,170,.12)"; e.target.style.background = "#fff";
  };
  const focusOff = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = F.border; e.target.style.boxShadow = "none"; e.target.style.background = F.bg;
  };
  const lbl: React.CSSProperties = { fontFamily: F.display, fontWeight: 700, fontSize: 13, color: F.sub, marginBottom: 7, display: "block" };

  const fInit = ((firstName?.[0] ?? "") + (lastName?.[0] ?? "")).toUpperCase();
  const filled = !!(firstName || lastName);

  const validateUrl = (url: string) => {
    if (!url) return true;
    try {
      const u = new URL(url);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  };

  const save = async () => {
    if (!user) return;
    const fn = firstName.trim();
    const ln = lastName.trim();
    const em = email.trim().toLowerCase();
    if (!fn && !ln) {
      toast.error(t("studentEdit.nameRequired"));
      return;
    }
    if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      toast.error(t("contactEdit.emailInvalid"));
      return;
    }
    for (const [label, val] of [
      ["Messenger", messenger.trim()],
      ["Facebook", facebook.trim()],
      ["Instagram", instagram.trim()],
    ] as const) {
      if (val && !validateUrl(val)) {
        toast.error(t("contactEdit.urlInvalid", { label }));
        return;
      }
    }
    // Derive the new last-4 from a freshly typed card, else keep the existing.
    let last4 = cardLast4.trim();
    if (cardInput.trim()) {
      const digits = cardInput.replace(/\D/g, "");
      if (digits.length < 4 || digits.length > 19) {
        toast.error(t("contactEdit.cardInvalid"));
        return;
      }
      last4 = digits.slice(-4);
    }

    setSaving(true);
    // 1) name → profiles
    const { error: pErr } = await supabase
      .from("profiles")
      .update({ first_name: fn, last_name: ln })
      .eq("id", person.id);
    // 2) contacts → profile_contacts
    const { error: cErr } = await supabase
      .from("profile_contacts")
      .upsert(
        {
          user_id: person.id,
          phone: phone.trim() || null,
          email: em || null,
          telegram: telegram.trim().replace(/^@/, "") || null,
          messenger_url: messenger.trim() || null,
          facebook_url: facebook.trim() || null,
          instagram_url: instagram.trim() || null,
        },
        { onConflict: "user_id" },
      );
    // 3) tutor: subjects → tutor_details; payout → profile_financial_contacts
    let tErr: { message: string } | null = null;
    if (isTutor) {
      const { error: subErr } = await supabase
        .from("tutor_details")
        .upsert({ user_id: person.id, subjects }, { onConflict: "user_id" });
      tErr = subErr;
      if (!tErr && (last4 || bankName.trim())) {
        const { error: finErr } = await supabase
          .from("profile_financial_contacts")
          .upsert({ user_id: person.id, bank_name: bankName.trim() || null, bank_card_last4: last4 || null }, { onConflict: "user_id" });
        tErr = finErr;
      }
    }
    // 4) private manager note → manager_notes (update-in-place or insert)
    let nErr: { message: string } | null = null;
    const content = notes.trim();
    if (noteId) {
      const { error } = await supabase.from("manager_notes").update({ content }).eq("id", noteId);
      nErr = error;
    } else if (content) {
      const { error } = await supabase.from("manager_notes").insert({ author_id: user.id, subject_user_id: person.id, content });
      nErr = error;
    }
    setSaving(false);
    if (pErr || cErr || tErr || nErr) {
      const msg = (pErr || cErr || tErr || nErr)?.message || "";
      if (/email/i.test(msg) && /(unique|duplicate)/i.test(msg)) {
        toast.error(t("contactEditExtra.emailDuplicate"));
        return;
      }
      toast.error(t("studentEdit.saveFailed"), { description: msg });
      return;
    }
    toast.success(t("contactEdit.saved"));
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[480px] p-0 gap-0 overflow-hidden rounded-t-[26px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[88vh] flex flex-col [&>button.absolute]:hidden">
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden flex-shrink-0">
          <div className="w-9 h-1 rounded-full" style={{ background: "rgba(15,15,26,.14)" }} />
        </div>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 20px 12px", flexShrink: 0 }}>
          <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 21, letterSpacing: "-.01em", color: F.txt }}>
            {t("personEdit.title")}
          </div>
          <button onClick={() => onOpenChange(false)} aria-label={t("myStudents.cancelBtn")}
            style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, border: "none", background: F.chip, color: F.sub, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 20px 14px", display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Avatar + name */}
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <div style={{ width: 60, height: 60, borderRadius: 20, flexShrink: 0,
              background: filled ? "linear-gradient(135deg,#2BBFAA,#25a896)" : "#fff",
              color: filled ? "#0f0f1a" : F.muted,
              boxShadow: filled ? "0 8px 20px -8px rgba(43,191,170,.55)" : `inset 0 0 0 1.5px ${F.border}`,
              display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F.display, fontWeight: 800, fontSize: 22 }}>
              {filled ? fInit : (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="4" /><path d="M5 20a7 7 0 0114 0" />
                </svg>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              <input aria-label={t("myStudents.fieldFirstName")} style={inp(true)} placeholder={t("myStudents.fieldFirstName")} value={firstName}
                onChange={(e) => setFirstName(e.target.value)} onFocus={focusOn} onBlur={focusOff} maxLength={50} />
              <input aria-label={t("myStudents.fieldLastName")} style={inp(false)} placeholder={t("myStudents.fieldLastName")} value={lastName}
                onChange={(e) => setLastName(e.target.value)} onFocus={focusOn} onBlur={focusOff} maxLength={50} />
            </div>
          </div>

          {/* STUDENT: read-only per-tutor rates summary (rates are per pair on the hub) */}
          {isStudent && (
            <div style={{ borderRadius: 16, padding: 14, background: "linear-gradient(135deg,#FFF7E6,#FFEFD0)", border: "1px solid rgba(245,181,68,.4)" }}>
              <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 13, color: F.gold, marginBottom: pairs.length ? 10 : 6 }}>
                {t("studentEdit.subjectsRatesTitle")}
              </div>
              {pairs.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {pairs.map((p) => (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", borderRadius: 11, padding: "9px 12px", border: "1px solid rgba(245,181,68,.25)" }}>
                      <span style={{ fontFamily: F.display, fontWeight: 700, fontSize: 14, color: F.txt, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {p.subject || t("shared.lesson")}
                      </span>
                      <span style={{ fontFamily: F.body, fontSize: 13, color: F.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>
                        · {tutorNameOf?.(p.tutor_id) ?? ""}
                      </span>
                      <span style={{ fontFamily: F.display, fontWeight: 800, fontSize: 14, color: F.gold, flexShrink: 0 }}>
                        {Number(p.price_per_lesson ?? 0)} {currencySymbol(p.currency || "UAH")}
                      </span>
                    </div>
                  ))}
                  <p style={{ fontFamily: F.body, fontSize: 12, color: F.gold, opacity: .85, margin: "2px 2px 0" }}>{t("studentEdit.ratesPerTutorHint")}</p>
                </div>
              ) : (
                <p style={{ fontFamily: F.body, fontSize: 13, color: F.gold }}>{t("studentEdit.noTutorYet")}</p>
              )}
            </div>
          )}

          {/* TUTOR: editable subjects (gold card) */}
          {isTutor && (
            <div style={{ borderRadius: 16, padding: 14, background: "linear-gradient(135deg,#FFF7E6,#FFEFD0)", border: "1px solid rgba(245,181,68,.4)" }}>
              <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 13, color: F.gold, marginBottom: 10 }}>
                {t("people.fieldSubjects")}
              </div>
              <SubjectMultiSelect value={subjects} onChange={setSubjects} />
            </div>
          )}

          {/* Divider */}
          <div style={{ height: 1, background: F.border }} />

          {/* Contacts */}
          <div>
            <span style={lbl}>{t("myStudents.contactsLabel")}</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input aria-label={t("myStudents.fieldPhone")} type="tel" style={inp(false)} placeholder={t("myStudents.fieldPhone")} value={phone}
                onChange={(e) => setPhone(e.target.value)} onFocus={focusOn} onBlur={focusOff} maxLength={32} />
              <input aria-label="Email" type="email" style={inp(false)} placeholder="Email" value={email}
                onChange={(e) => setEmail(e.target.value)} onFocus={focusOn} onBlur={focusOff} maxLength={255} />
              <input aria-label="Telegram" style={inp(false)} placeholder="Telegram @username" value={telegram}
                onChange={(e) => setTelegram(e.target.value)} onFocus={focusOn} onBlur={focusOff} maxLength={64} />
              <input aria-label="Messenger" type="url" style={inp(false)} placeholder="Messenger https://m.me/…" value={messenger}
                onChange={(e) => setMessenger(e.target.value)} onFocus={focusOn} onBlur={focusOff} maxLength={500} />
              <input aria-label="Facebook" type="url" style={inp(false)} placeholder="Facebook https://facebook.com/…" value={facebook}
                onChange={(e) => setFacebook(e.target.value)} onFocus={focusOn} onBlur={focusOff} maxLength={500} />
              <input aria-label="Instagram" type="url" style={inp(false)} placeholder="Instagram https://instagram.com/…" value={instagram}
                onChange={(e) => setInstagram(e.target.value)} onFocus={focusOn} onBlur={focusOff} maxLength={500} />
            </div>
          </div>

          {/* TUTOR: payout details (bank + card last-4) */}
          {isTutor && (
            <div>
              <span style={lbl}>{t("contactEditExtra.sectionPayout")}</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <input aria-label={t("contactEditExtra.bankLabel")} style={inp(false)} placeholder={t("contactEditExtra.bankPlaceholder")} value={bankName}
                  onChange={(e) => setBankName(e.target.value)} onFocus={focusOn} onBlur={focusOff} maxLength={64} />
                <input aria-label={t("contactEditExtra.cardLabel")} inputMode="numeric" autoComplete="off" style={inp(false)} maxLength={25}
                  placeholder={cardLast4 ? `•••• ${cardLast4}` : "0000 0000 0000 0000"} value={cardInput}
                  onChange={(e) => setCardInput(e.target.value)} onFocus={focusOn} onBlur={focusOff} />
              </div>
            </div>
          )}

          {/* 🔒 Private manager note */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
              <span style={{ width: 22, height: 22, borderRadius: 7, background: "rgba(245,181,68,.2)", color: F.gold, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>🔒</span>
              <span style={{ fontFamily: F.display, fontWeight: 700, fontSize: 13, color: F.sub }}>{t("myStudents.notesLabel")}</span>
            </div>
            <textarea rows={3} aria-label={t("myStudents.notesPlaceholder")} value={notes} placeholder={t("myStudents.notesPlaceholder")}
              onChange={(e) => setNotes(e.target.value)}
              onFocus={(e) => { e.target.style.borderColor = "#F5B544"; e.target.style.boxShadow = "0 0 0 3px rgba(245,181,68,.16)"; e.target.style.background = "#fff"; }}
              onBlur={(e) => { e.target.style.borderColor = "rgba(245,181,68,.35)"; e.target.style.boxShadow = "none"; e.target.style.background = "#FFFCF4"; }}
              style={{ width: "100%", borderRadius: 13, padding: "12px 14px", fontSize: 16, fontFamily: F.body, color: F.txt, boxSizing: "border-box", outline: "none", resize: "none", lineHeight: 1.5, background: "#FFFCF4", border: "1.5px solid rgba(245,181,68,.35)", transition: "all .15s" }} />
          </div>
        </div>

        {/* Footer */}
        <div style={{ flexShrink: 0, padding: "14px 20px 20px", borderTop: `1px solid ${F.border}`, background: "#fff", display: "flex", gap: 10 }}>
          <button type="button" onClick={() => onOpenChange(false)}
            style={{ height: 50, padding: "0 20px", borderRadius: 14, border: `1px solid ${F.border}`, background: "#fff", color: F.sub, fontFamily: F.display, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
            {t("myStudents.cancelBtn")}
          </button>
          <button type="button" onClick={save} disabled={saving}
            style={{ flex: 1, height: 50, borderRadius: 14, border: "none",
              background: saving ? F.muted : "linear-gradient(135deg,#2BBFAA,#25a896)",
              cursor: saving ? "not-allowed" : "pointer", fontFamily: F.display, fontWeight: 700, fontSize: 16, color: "#0f0f1a",
              boxShadow: saving ? "none" : "0 8px 20px -8px rgba(43,191,170,.6)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {saving && <Loader2 size={18} className="animate-spin" />}
            {t("myStudents.saveBtn")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
