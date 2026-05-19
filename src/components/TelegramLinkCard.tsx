import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, MessageCircle, Check, Copy, X, AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

// Bot username is fetched from the edge function (telegram-bot-info)

type LinkRow = {
  chat_id: number | null;
  link_code: string | null;
  link_code_expires_at: string | null;
  linked_at: string | null;
  is_active: boolean | null;
};

export function TelegramLinkCard() {
  const { user } = useAuth();
  const [link, setLink] = useState<LinkRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [botUsername, setBotUsername] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    supabase.functions.invoke("telegram-bot-info").then(({ data, error }) => {
      if (!active || error) return;
      if (data?.configured && data?.username) setBotUsername(data.username);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("user_telegram_links")
        .select("chat_id, link_code, link_code_expires_at, linked_at, is_active")
        .eq("user_id", user.id)
        .maybeSingle();
      if (active) {
        setLink((data as LinkRow | null) ?? null);
        setLoading(false);
      }
    })();

    const ch = supabase
      .channel(`tg-link-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_telegram_links", filter: `user_id=eq.${user.id}` },
        (payload) => {
          if (payload.eventType === "DELETE") setLink(null);
          else setLink(payload.new as LinkRow);
        },
      )
      .subscribe();

    // Poll active status every 60s in case backend marks the link as inactive
    const poll = setInterval(async () => {
      const { data } = await supabase
        .from("user_telegram_links")
        .select("chat_id, link_code, link_code_expires_at, linked_at, is_active")
        .eq("user_id", user.id)
        .maybeSingle();
      if (active) setLink((data as LinkRow | null) ?? null);
    }, 60_000);

    return () => {
      active = false;
      clearInterval(poll);
      supabase.removeChannel(ch);
    };
  }, [user?.id]);

  const generate = async () => {
    if (!user) return;
    setGenerating(true);
    const { data, error } = await supabase.rpc("generate_telegram_link_code", { _user_id: user.id });
    setGenerating(false);
    if (error) {
      toast.error(t("telegramLink.createFailed"));
      return;
    }
    toast.success(t("telegramLink.codeCreated"));
    // realtime subscription will refresh the row
  };

  const unlink = async () => {
    if (!user) return;
    await supabase.from("user_telegram_links").delete().eq("user_id", user.id);
    setLink(null);
    toast.success(t("telegramLink.disconnected"));
  };

  if (loading) {
    return (
      <Card className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Перевірка статусу Telegram...
      </Card>
    );
  }

  const isLinked = !!link?.chat_id;

  if (isLinked && link?.is_active !== false) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
        <Check className="h-4 w-4 shrink-0 text-green-600" />
        <span>{t("telegramLink.connected")}</span>
      </div>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <MessageCircle className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          {isLinked ? (
            link?.is_active === false ? (
              <>
                <p className="text-sm font-medium text-warning flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4" /> З'єднання перервано
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Бот більше не може надсилати вам повідомлення. Ймовірно, ви заблокували його або видалили чат.
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={generate} disabled={generating}>
                    {generating ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                    Відновити
                  </Button>
                  <Button size="sm" variant="ghost" onClick={unlink}>
                    <X className="h-3.5 w-3.5 mr-1" />
                    Відʼєднати
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-success flex items-center gap-1.5">
                  <Check className="h-4 w-4" /> Telegram підключено
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Ви отримуватимете сповіщення про нові повідомлення в чатах.
                </p>
                <Button size="sm" variant="ghost" className="mt-2" onClick={unlink}>
                  <X className="h-3.5 w-3.5 mr-1" />
                  Відʼєднати
                </Button>
              </>
            )
          ) : link?.link_code ? (
            <>
              <p className="text-sm font-medium text-foreground">{t("telegramLink.connecting")}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                1. Відкрийте бота{" "}
                {botUsername ? (
                  <a
                    href={`https://t.me/${botUsername}?start=${link.link_code}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    @{botUsername}
                  </a>
                ) : (
                  <span className="text-muted-foreground">{t("telegramLink.loading")}</span>
                )}
                <br />
                2. Натисніть «Start» (або надішліть команду нижче):
              </p>
              <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm">
                <span className="flex-1 truncate">/start {link.link_code}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() => {
                    navigator.clipboard.writeText(`/start ${link.link_code}`);
                    toast.success(t("telegramLinkExtra.copied"));
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Код діє 30 хвилин. Якщо протермінувався — згенеруйте новий.
              </p>
              <Button size="sm" variant="outline" className="mt-2" onClick={generate} disabled={generating}>
                {generating && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                Новий код
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-foreground">{t("telegramLinkExtra.notificationsTitle")}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Підʼєднайте Telegram, щоб отримувати сповіщення про нові повідомлення в чатах, навіть коли застосунок закритий.
              </p>
              <Button size="sm" className="mt-3" onClick={generate} disabled={generating}>
                {generating && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                Підʼєднати Telegram
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
