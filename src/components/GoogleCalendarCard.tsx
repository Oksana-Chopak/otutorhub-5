import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";

const PROJECT_REF = import.meta.env.VITE_SUPABASE_PROJECT_ID;

export function GoogleCalendarCard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("google_calendar_tokens" as any)
      .select("google_email")
      .eq("user_id", user.id)
      .maybeSingle();
    setConnected(!!data);
    setEmail((data as any)?.google_email ?? null);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user?.id]);

  // If we just came back from OAuth, show a toast and refresh.
  useEffect(() => {
    const url = new URL(window.location.href);
    const calendar = url.searchParams.get("calendar");
    if (calendar === "connected") {
      toast.success("Google Calendar підключено");
      url.searchParams.delete("calendar");
      window.history.replaceState({}, "", url.pathname + url.search);
      load();
    } else if (calendar === "error") {
      toast.error("Не вдалося підключити Google Calendar");
      url.searchParams.delete("calendar");
      url.searchParams.delete("reason");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, []);

  const connect = () => {
    if (!user) return;
    const params = new URLSearchParams({
      user_id: user.id,
      return_to: `${window.location.origin}${window.location.pathname}`,
    });
    const url = `https://${PROJECT_REF}.supabase.co/functions/v1/google-calendar-auth?${params.toString()}`;
    const popup = window.open(url, "_blank", "noopener,noreferrer");
    if (!popup) window.location.href = url;
  };

  const disconnect = async () => {
    if (!user) return;
    setBusy(true);
    const { error } = await supabase
      .from("google_calendar_tokens" as any)
      .delete()
      .eq("user_id", user.id);
    setBusy(false);
    if (error) {
      toast.error("Не вдалося відключити");
      return;
    }
    toast.success("Google Calendar відключено");
    setConnected(false);
    setEmail(null);
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarCheck className="h-5 w-5 text-primary" />
          Google Calendar
        </CardTitle>
        <CardDescription>
          Уроки автоматично з'являтимуться у вашому Google Календарі.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : connected ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-emerald-600 dark:text-emerald-400">
              ✓ Підключено{email ? ` · ${email}` : ""}
            </span>
            <Button variant="outline" size="sm" onClick={disconnect} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
              Відключити
            </Button>
          </div>
        ) : (
          <Button onClick={connect}>Підключити Google Calendar</Button>
        )}
      </CardContent>
    </Card>
  );
}
