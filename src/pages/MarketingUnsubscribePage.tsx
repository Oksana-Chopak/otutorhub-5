import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, MailX, CheckCircle2, AlertTriangle } from "lucide-react";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

type State =
  | { kind: "validating" }
  | { kind: "ready"; email: string }
  | { kind: "already"; email: string }
  | { kind: "submitting"; email: string }
  | { kind: "success"; email: string }
  | { kind: "error"; message: string };

export default function MarketingUnsubscribePage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<State>({ kind: "validating" });

  useEffect(() => {
    if (!token) {
      setState({ kind: "error", message: "Посилання недійсне — відсутній токен." });
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/marketing-unsubscribe?token=${encodeURIComponent(token)}`,
          { headers: { apikey: SUPABASE_ANON_KEY } }
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.email) {
          setState({ kind: "error", message: body?.error || "Посилання недійсне." });
          return;
        }
        setState(body.alreadyUnsubscribed
          ? { kind: "already", email: body.email }
          : { kind: "ready", email: body.email });
      } catch {
        setState({ kind: "error", message: "Не вдалося перевірити посилання." });
      }
    })();
  }, [token]);

  const confirm = async () => {
    if (state.kind !== "ready" || !token) return;
    setState({ kind: "submitting", email: state.email });
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/marketing-unsubscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ kind: "error", message: body?.error || "Помилка" });
        return;
      }
      setState({ kind: "success", email: body.email });
    } catch {
      setState({ kind: "error", message: "Помилка мережі" });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-8 text-center space-y-4">
          {state.kind === "validating" && (
            <><Loader2 className="mx-auto h-10 w-10 animate-spin text-muted-foreground" /><p>Перевіряємо посилання…</p></>
          )}
          {state.kind === "ready" && (
            <>
              <MailX className="mx-auto h-12 w-12 text-primary" />
              <h1 className="text-xl font-semibold">Відписатися від розсилок?</h1>
              <p className="text-muted-foreground">Адреса: <strong>{state.email}</strong></p>
              <p className="text-sm text-muted-foreground">
                Ви більше не отримуватимете маркетингових листів. Системні повідомлення (про оплати, уроки тощо) продовжать надходити.
              </p>
              <Button onClick={confirm} className="w-full">Підтвердити відписку</Button>
            </>
          )}
          {state.kind === "submitting" && (
            <><Loader2 className="mx-auto h-10 w-10 animate-spin" /><p>Відписуємо…</p></>
          )}
          {state.kind === "success" && (
            <>
              <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
              <h1 className="text-xl font-semibold">Готово</h1>
              <p className="text-muted-foreground">{state.email} відписано від розсилок.</p>
              <Button asChild variant="outline"><Link to="/">На головну</Link></Button>
            </>
          )}
          {state.kind === "already" && (
            <>
              <CheckCircle2 className="mx-auto h-12 w-12 text-muted-foreground" />
              <h1 className="text-xl font-semibold">Ви вже відписані</h1>
              <p className="text-muted-foreground">{state.email}</p>
              <Button asChild variant="outline"><Link to="/">На головну</Link></Button>
            </>
          )}
          {state.kind === "error" && (
            <>
              <AlertTriangle className="mx-auto h-12 w-12 text-destructive" />
              <p className="text-destructive">{state.message}</p>
              <Button asChild variant="outline"><Link to="/">На головну</Link></Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
