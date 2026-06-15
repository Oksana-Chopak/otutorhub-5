import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Loader2, Mic, ExternalLink, AlertCircle, ListChecks, FileAudio } from "lucide-react";
import { safeHref } from "@/lib/safeUrl";

interface Sentence {
  index?: number;
  speaker_name?: string | null;
  text?: string | null;
  start_time?: number | null;
}

interface Props {
  lessonId: string;
  tutorId: string;
  meetingUrl: string | null;
  canRecord: boolean; // true for the tutor of this lesson
  canView: boolean;   // tutor, student, manager — anyone allowed to see the lesson
}

interface State {
  status: string | null;
  summary: string | null;
  transcript: Sentence[] | null;
  actionItems: string[] | null;
  recordingUrl: string | null;
  audioUrl: string | null;
}

const EMPTY: State = {
  status: null,
  summary: null,
  transcript: null,
  actionItems: null,
  recordingUrl: null,
  audioUrl: null,
};

export function FirefliesPanel({ lessonId, meetingUrl, canRecord, canView }: Props) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("lesson_details")
      .select(
        "fireflies_status, fireflies_summary, fireflies_transcript, fireflies_action_items, fireflies_recording_url, fireflies_audio_url"
      )
      .eq("lesson_id", lessonId)
      .maybeSingle();
    const d = (data ?? {}) as Record<string, unknown>;
    setState({
      status: (d.fireflies_status as string) ?? null,
      summary: (d.fireflies_summary as string) ?? null,
      transcript: (d.fireflies_transcript as Sentence[]) ?? null,
      actionItems: (d.fireflies_action_items as string[]) ?? null,
      recordingUrl: (d.fireflies_recording_url as string) ?? null,
      audioUrl: (d.fireflies_audio_url as string) ?? null,
    });
    setLoading(false);
  }, [lessonId]);

  useEffect(() => {
    load();
  }, [load]);

  // Live update when webhook lands
  useEffect(() => {
    const channel = supabase
      .channel(`lesson-details-${lessonId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "lesson_details", filter: `lesson_id=eq.${lessonId}` },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [lessonId, load]);

  const startRecording = async () => {
    if (!meetingUrl) {
      toast({
        title: t("firefliesPanel.addMeetingLinkTitle"),
        description: t("firefliesPanel.addMeetingLinkDescription"),
        variant: "destructive",
      });
      return;
    }
    const ok = window.confirm(
      t("firefliesPanel.confirmStartRecording")
    );
    if (!ok) return;
    setStarting(true);
    try {
      const { data, error } = await supabase.functions.invoke("fireflies-start-recording", {
        body: { lessonId, meetingUrl },
      });
      if (error) throw error;
      const ff = (data as { fireflies?: { success?: boolean; message?: string } })?.fireflies;
      if (ff && ff.success === false) {
        throw new Error(ff.message || t("firefliesPanel.firefliesRefused"));
      }
      toast({
        title: t("firefliesPanel.botJoiningTitle"),
        description: t("firefliesPanel.botJoiningDescription"),
      });
      setState((s) => ({ ...s, status: "requested" }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("firefliesPanel.unknownError");
      toast({ title: t("firefliesPanel.couldNotStartTitle"), description: msg, variant: "destructive" });
    } finally {
      setStarting(false);
    }
  };

  if (!canView) return null;

  const isProcessing = state.status === "requested" && !state.summary && !state.transcript?.length;
  const isReady = !!(state.summary || state.transcript?.length || state.recordingUrl);

  const L = {
    teal: "#2BBFAA", tealD: "#1f8e7e", tealL: "#f0fdf9", txt: "#0f0f1a",
    sub: "#9398b0", muted: "#b0b4c8", border: "#eceef3", bg: "#fbfbfc",
    display: "Inter, system-ui, sans-serif", body: "'Plus Jakarta Sans', system-ui, sans-serif",
  };
  const label: React.CSSProperties = {
    fontFamily: L.display, fontWeight: 700, fontSize: 13, letterSpacing: ".07em",
    textTransform: "uppercase", color: L.sub, marginBottom: 6,
  };

  return (
    <section className="md:col-span-2" style={{ borderRadius: 16, border: `1.5px solid ${L.border}`, background: "#fff", padding: 14, fontFamily: L.body, color: L.txt }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: state.status || canRecord ? 10 : 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 36, height: 36, borderRadius: 11, background: "rgba(59,130,246,.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>🎙</span>
          <div>
            <div style={{ fontFamily: L.display, fontWeight: 700, fontSize: 14.5 }}>{t("firefliesPanel.panelTitle")}</div>
            <div style={{ fontSize: 13, color: L.muted }}>{t("firefliesPanel.panelSubtitle")}</div>
          </div>
        </div>
        {canRecord && !isReady && (
          <button type="button" onClick={startRecording} disabled={starting || isProcessing}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 40, padding: "0 15px", borderRadius: 12,
              border: "none", cursor: starting || isProcessing ? "default" : "pointer",
              background: starting || isProcessing ? "rgba(43,191,170,.35)" : "linear-gradient(135deg,#2BBFAA,#25a896)",
              color: "#fff", fontFamily: L.display, fontWeight: 700, fontSize: 13.5,
              boxShadow: starting || isProcessing ? "none" : "0 6px 16px -6px rgba(43,191,170,.6)" }}>
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
            {t("firefliesPanel.recordThisLesson")}
          </button>
        )}
      </div>

      {canRecord && !isReady && !isProcessing && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", borderRadius: 12, border: "1px solid rgba(245,181,68,.35)", background: "rgba(245,181,68,.08)", padding: "10px 12px", marginBottom: 10, fontSize: 13, lineHeight: 1.45, color: L.txt }}>
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#b4740b" }} />
          <p>{t("firefliesPanel.recordingWarning")}</p>
        </div>
      )}

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: L.muted }}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("firefliesPanel.loading")}
        </div>
      ) : isProcessing ? (
        <div style={{ borderRadius: 12, border: "1px solid rgba(43,191,170,.3)", background: "rgba(43,191,170,.08)", padding: "12px 14px", fontSize: 13.5, lineHeight: 1.5 }}>
          {t("firefliesPanel.processing")}
        </div>
      ) : isReady ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {state.summary && (
            <div style={{ borderRadius: 13, border: `1px solid ${L.border}`, background: L.bg, padding: "12px 14px" }}>
              <div style={label}>{t("firefliesPanel.summaryLabel")}</div>
              <p style={{ whiteSpace: "pre-wrap", fontSize: 14.5, lineHeight: 1.55 }}>{state.summary}</p>
            </div>
          )}

          {state.actionItems && state.actionItems.length > 0 && (
            <div style={{ borderRadius: 13, border: `1px solid ${L.border}`, background: L.bg, padding: "12px 14px" }}>
              <div style={{ ...label, display: "flex", alignItems: "center", gap: 6 }}>
                <ListChecks className="h-3.5 w-3.5" /> {t("firefliesPanel.actionItemsLabel")}
              </div>
              <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4, fontSize: 14.5, lineHeight: 1.5 }}>
                {state.actionItems.map((it, i) => (
                  <li key={i}>{it}</li>
                ))}
              </ul>
            </div>
          )}

          {(state.recordingUrl || state.audioUrl) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {state.recordingUrl && (
                <a href={safeHref(state.recordingUrl)} target="_blank" rel="noopener noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 38, padding: "0 13px", borderRadius: 11, textDecoration: "none", border: `1.5px solid ${L.teal}`, background: "#fff", color: L.tealD, fontFamily: L.display, fontWeight: 700, fontSize: 13.5 }}>
                  <ExternalLink className="h-4 w-4" /> {t("firefliesPanel.openRecording")}
                </a>
              )}
              {state.audioUrl && (
                <a href={safeHref(state.audioUrl)} target="_blank" rel="noopener noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 38, padding: "0 13px", borderRadius: 11, textDecoration: "none", border: `1px solid ${L.border}`, background: "#fff", color: L.sub, fontFamily: L.display, fontWeight: 700, fontSize: 13.5 }}>
                  <FileAudio className="h-4 w-4" /> {t("firefliesPanel.audio")}
                </a>
              )}
            </div>
          )}

          {state.transcript && state.transcript.length > 0 && (
            <details style={{ borderRadius: 13, border: `1px solid ${L.border}`, background: L.bg, padding: "12px 14px" }}>
              <summary style={{ ...label, marginBottom: 0, cursor: "pointer" }}>
                {t("firefliesPanel.fullTranscript", { count: state.transcript.length })}
              </summary>
              <div style={{ marginTop: 10, maxHeight: 380, overflowY: "auto", paddingRight: 8, display: "flex", flexDirection: "column", gap: 7 }}>
                {state.transcript.map((s, i) => (
                  <div key={s.index ?? i} style={{ fontSize: 14 }}>
                    <span style={{ marginRight: 7, fontFamily: L.display, fontWeight: 700, color: L.tealD }}>
                      {s.speaker_name || t("firefliesPanel.speaker")}:
                    </span>
                    <span>{s.text}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      ) : (
        <p style={{ fontSize: 13, color: L.muted, lineHeight: 1.5 }}>
          {t("firefliesPanel.noRecordingYet")} {canRecord ? t("firefliesPanel.noRecordingTutorHint") : t("firefliesPanel.noRecordingViewerHint")}
        </p>
      )}
    </section>
  );
}