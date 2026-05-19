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
      toast.success(t("googleCalendar.connected"));
      url.searchParams.delete("calendar");
      window.history.replaceState({}, "", url.pathname + url.search);
      load();
    } else if (calendar === "error") {
      toast.error(t("googleCalendar.connectFailed"));
      url.searchParams.delete("calendar");
      url.searchParams.delete("reason");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, []);

  const connect = async () => {
    if (!user) return;
    // Request a short-lived one-time exchange code from the edge function.
    // The user's session JWT is sent only in the Authorization header (via
    // supabase.functions.invoke) — never as a URL query param.
    const { data, error } = await supabase.functions.invoke("google-calendar-auth", {
      body: { return_to: `${window.location.origin}${window.location.pathname}` },
    });
    if (error || !data?.redirect_url) {
      toast.error(t("googleCalendar.connectFailed"));
      return;
    }
    const popup = window.open(data.redirect_url, "_blank");
    if (!popup) window.location.href = data.redirect_url;
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
      toast.error(t("googleCalendar.disconnectFailed"));
      return;
    }
    toast.success(t("googleCalendar.disconnected"));
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
          <Button onClick={connect}>{t("googleCalendar.connectBtn")}</Button>
        )}
      </CardContent>
    </Card>
  );
}
