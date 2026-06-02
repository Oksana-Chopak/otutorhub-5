import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
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
        title: "Add meeting link first",
        description: "Set the Zoom or Google Meet URL for this lesson before recording.",
        variant: "destructive",
      });
      return;
    }
    const ok = window.confirm(
      "This session will be recorded and transcribed.\nBoth participants will see the Fireflies bot in the call.\n\nStart recording now?"
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
        throw new Error(ff.message || "Fireflies refused the request");
      }
      toast({
        title: "🎙 Bot is joining the call",
        description: "Fireflies will record silently. Notes appear here when ready.",
      });
      setState((s) => ({ ...s, status: "requested" }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast({ title: "Could not start recording", description: msg, variant: "destructive" });
    } finally {
      setStarting(false);
    }
  };

  if (!canView) return null;

  const isProcessing = state.status === "requested" && !state.summary && !state.transcript?.length;
  const isReady = !!(state.summary || state.transcript?.length || state.recordingUrl);

  return (
    <section className="rounded-lg border border-border bg-background/50 p-4 md:col-span-2">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Mic className="h-4 w-4 text-primary" />
          AI session recording
        </div>
        {canRecord && !isReady && (
          <Button size="sm" onClick={startRecording} disabled={starting || isProcessing}>
            {starting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Mic className="mr-2 h-4 w-4" />
            )}
            🎙 Record this session
          </Button>
        )}
      </div>

      {canRecord && !isReady && !isProcessing && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-2.5 text-xs text-foreground/80">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <p>
            This session will be recorded and transcribed. Both participants will see the
            Fireflies bot in the call.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      ) : isProcessing ? (
        <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm text-foreground/80">
          ⏳ Preparing your session notes… This usually takes a few minutes after the call ends.
        </div>
      ) : isReady ? (
        <div className="space-y-4">
          {state.summary && (
            <div className="rounded-md border border-border bg-card p-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Summary
              </div>
              <p className="whitespace-pre-wrap text-sm text-foreground">{state.summary}</p>
            </div>
          )}

          {state.actionItems && state.actionItems.length > 0 && (
            <div className="rounded-md border border-border bg-card p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <ListChecks className="h-3.5 w-3.5" />
                Action items
              </div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
                {state.actionItems.map((it, i) => (
                  <li key={i}>{it}</li>
                ))}
              </ul>
            </div>
          )}

          {(state.recordingUrl || state.audioUrl) && (
            <div className="flex flex-wrap gap-2">
              {state.recordingUrl && (
                <Button asChild size="sm" variant="outline">
                  <a href={safeHref(state.recordingUrl)} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open recording
                  </a>
                </Button>
              )}
              {state.audioUrl && (
                <Button asChild size="sm" variant="outline">
                  <a href={safeHref(state.audioUrl)} target="_blank" rel="noopener noreferrer">
                    <FileAudio className="mr-2 h-4 w-4" />
                    Audio
                  </a>
                </Button>
              )}
            </div>
          )}

          {state.transcript && state.transcript.length > 0 && (
            <details className="rounded-md border border-border bg-card p-3">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Full transcript ({state.transcript.length} lines)
              </summary>
              <div className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-2">
                {state.transcript.map((s, i) => (
                  <div key={s.index ?? i} className="text-sm">
                    <span className="mr-2 font-semibold text-primary">
                      {s.speaker_name || "Speaker"}:
                    </span>
                    <span className="text-foreground">{s.text}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No recording yet. {canRecord ? "Tap the button above to send the bot to the call." : "The tutor can start a recording from this page."}
        </p>
      )}
    </section>
  );
}
