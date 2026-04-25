import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, MailX, CheckCircle2, AlertTriangle } from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

type State =
  | { kind: "validating" }
  | { kind: "ready"; email: string }
  | { kind: "submitting"; email: string }
  | { kind: "success"; email: string }
  | { kind: "error"; message: string };

export default function UnsubscribePage() {
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
          `${SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`,
          { headers: { apikey: SUPABASE_ANON_KEY } }
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.email) {
          setState({
            kind: "error",
            message: body?.error || "Посилання недійсне або вже використане.",
          });
          return;
        }
        setState({ kind: "ready", email: body.email });
      } catch {
        setState({ kind: "error", message: "Не вдалося перевірити посилання." });
      }
    })();
  }, [token]);

  const confirm = async () => {
    if (state.kind !== "ready" || !token) return;
    setState({ kind: "submitting", email: state.email });
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/handle-email-unsubscribe`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setState({ kind: "error", message: body?.error || "Не вдалося відписати." });
        return;
      }
      setState({ kind: "success", email: state.email });
    } catch {
      setState({ kind: "error", message: "Сталася помилка під час відписки." });
    }
  };

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-muted p-2">
              {state.kind === "success" ? (
                <CheckCircle2 className="h-5 w-5 text-success" />
              ) : state.kind === "error" ? (
                <AlertTriangle className="h-5 w-5 text-destructive" />
              ) : (
                <MailX className="h-5 w-5 text-foreground" />
              )}
            </div>
            <h1 className="text-xl font-semibold text-foreground">Відписка від листів</h1>
          </div>

          {state.kind === "validating" && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Перевіряємо посилання…
            </p>
          )}

          {state.kind === "ready" && (
            <>
              <p className="text-sm text-foreground">
                Ви впевнені, що хочете відписатися від листів oTutorHub на адресу{" "}
                <strong>{state.email}</strong>?
              </p>
              <p className="text-xs text-muted-foreground">
                Після підтвердження ми не будемо надсилати вам сповіщення, нагадування й
                запрошення на цю пошту. Системні повідомлення про вхід та зміну паролю
                продовжать надходити.
              </p>
              <Button onClick={confirm} className="w-full">
                Так, відписатися
              </Button>
            </>
          )}

          {state.kind === "submitting" && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Відписуємо…
            </p>
          )}

          {state.kind === "success" && (
            <>
              <p className="text-sm text-foreground">
                Готово. Адресу <strong>{state.email}</strong> більше не використовуватимемо
                для розсилок.
              </p>
              <Link to="/">
                <Button variant="outline" className="w-full">
                  На головну
                </Button>
              </Link>
            </>
          )}

          {state.kind === "error" && (
            <>
              <p className="text-sm text-foreground">{state.message}</p>
              <Link to="/">
                <Button variant="outline" className="w-full">
                  На головну
                </Button>
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
