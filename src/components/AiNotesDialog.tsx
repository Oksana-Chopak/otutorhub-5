import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Mic, FileText, Sparkles, Lock, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";

const C = {
  txt: "var(--ds-txt,#0f0f1a)", ink2: "#4b5163", sub: "var(--sub,#666b82)", muted: "var(--ds-muted,#6f7489)", border: "var(--ds-border,#eceef3)",
  teal: "#2BBFAA", tealD: "#1f8e7e", tealRing: "rgba(43,191,170,.28)",
  warnBg: "rgba(245,158,11,.1)", warnBorder: "rgba(245,158,11,.3)", warnD: "#b4740b",
  display: "Inter, system-ui, sans-serif", body: "'Plus Jakarta Sans', system-ui, sans-serif",
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

const Mode = ({ icon: Icon, title, desc }: { icon: typeof Mic; title: string; desc: string }) => (
  <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "12px 0", borderBottom: `1px solid ${C.border}` }}>
    <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, background: "linear-gradient(135deg, rgba(43,191,170,.14), rgba(43,191,170,.04))", boxShadow: `inset 0 0 0 1px ${C.tealRing}`, display: "flex", alignItems: "center", justifyContent: "center", color: C.tealD }}>
      <Icon size={18} />
    </div>
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: C.display, fontWeight: 700, fontSize: 15, color: C.txt }}>{title}</div>
      <div style={{ fontSize: 15, color: C.ink2, lineHeight: 1.5, marginTop: 3 }}>{desc}</div>
    </div>
  </div>
);

const ToggleRow = ({ on, onChange, title, desc, disabled }: { on: boolean; onChange: (v: boolean) => void; title: string; desc: string; disabled?: boolean }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 14, border: `1px solid ${on ? C.tealRing : C.border}`, background: on ? "rgba(43,191,170,.05)" : "#fff", opacity: disabled ? 0.5 : 1 }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: C.display, fontWeight: 700, fontSize: 15, color: C.txt }}>{title}</div>
      <div style={{ fontSize: 14, color: C.ink2, lineHeight: 1.5, marginTop: 2 }}>{desc}</div>
    </div>
    <Switch checked={on} onCheckedChange={onChange} disabled={disabled} />
  </div>
);

export function AiNotesDialog({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { settings, isPro, isIndependent, updateSettings } = useWorkspaceSettings();
  const aiAllowed = !isIndependent || isPro;

  const [auto, setAuto] = useState(!!settings?.ai_notes_auto);
  const [autoSend, setAutoSend] = useState(!!settings?.ai_notes_auto_send);
  const [busy, setBusy] = useState(false);

  // Reflect saved settings whenever they load/change (unless we're mid-write).
  useEffect(() => {
    if (busy) return;
    setAuto(!!settings?.ai_notes_auto);
    setAutoSend(!!settings?.ai_notes_auto_send);
  }, [settings?.ai_notes_auto, settings?.ai_notes_auto_send, busy]);

  const setFlag = async (patch: { ai_notes_auto?: boolean; ai_notes_auto_send?: boolean }) => {
    setBusy(true);
    if (patch.ai_notes_auto !== undefined) setAuto(patch.ai_notes_auto);
    if (patch.ai_notes_auto_send !== undefined) setAutoSend(patch.ai_notes_auto_send);
    await updateSettings(patch);
    setBusy(false);
  };



  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px] p-0 overflow-hidden gap-0 rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[90vh]">
        <DialogHeader className="px-5 pt-5 pb-0">
          <DialogTitle asChild>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 11, background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 20px -8px rgba(43,191,170,.6)" }}>
                <Sparkles size={19} />
              </div>
              <span style={{ fontFamily: C.display, fontWeight: 800, fontSize: 19, color: C.txt }}>{t("aiNotesDialog.title")}</span>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div style={{ padding: "8px 20px 20px", fontFamily: C.body }}>
          <p style={{ fontSize: 15, color: C.ink2, lineHeight: 1.55, margin: "4px 0 10px" }}>
            {t("aiNotesDialog.intro")}
          </p>

          <div style={{ marginBottom: 16 }}>
            <Mode icon={Mic} title={t("aiNotesDialog.modeRecordingTitle")} desc={t("aiNotesDialog.modeRecordingDesc")} />
            <Mode icon={FileText} title={t("aiNotesDialog.modeNoteTitle")} desc={t("aiNotesDialog.modeNoteDesc")} />
          </div>

          {!aiAllowed && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 14, background: C.warnBg, border: `1px solid ${C.warnBorder}`, marginBottom: 14 }}>
              <Lock size={18} style={{ color: C.warnD, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: C.display, fontWeight: 700, fontSize: 15, color: C.warnD }}>{t("aiNotesDialog.lockedTitle")}</div>
                <button onClick={() => { onOpenChange(false); navigate("/subscription?from=ai_summary"); }}
                  style={{ border: "none", background: "transparent", cursor: "pointer", color: C.tealD, fontFamily: C.display, fontWeight: 700, fontSize: 14, padding: 0, marginTop: 2 }}>
                  {t("aiNotesDialog.subscribeCta")}
                </button>
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <ToggleRow
              on={auto}
              onChange={(v) => setFlag({ ai_notes_auto: v, ...(v ? {} : { ai_notes_auto_send: false }) })}
              disabled={!aiAllowed || busy}
              title={t("aiNotesDialog.autoNoteTitle")}
              desc={t("aiNotesDialog.autoNoteDesc")}
            />
            <ToggleRow
              on={autoSend}
              onChange={(v) => setFlag({ ai_notes_auto_send: v })}
              disabled={!aiAllowed || !auto || busy}
              title={t("aiNotesDialog.autoSendTitle")}
              desc={t("aiNotesDialog.autoSendDesc")}
            />
          </div>

          <button onClick={() => onOpenChange(false)}
            style={{ marginTop: 18, width: "100%", height: 48, borderRadius: 14, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", fontFamily: C.display, fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 10px 24px -10px rgba(43,191,170,.7)" }}>
            {t("aiNotesDialog.tryCta")} <Check size={18} />
          </button>
          <p style={{ fontSize: 14, color: C.ink2, textAlign: "center", marginTop: 10, lineHeight: 1.5 }}>
            {t("aiNotesDialog.footerHint")}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default AiNotesDialog;
