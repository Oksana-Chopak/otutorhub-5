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
      toast.error("ÐÐµ Ð²Ð´Ð°Ð»Ð¾ÑÑ ÑÑÐ²Ð¾ÑÐ¸ÑÐ¸ ÐºÐ¾Ð´. Ð¡Ð¿ÑÐ¾Ð±ÑÐ¹ÑÐµ ÑÐµ ÑÐ°Ð·.");
      return;
    }
    toast.success("ÐÐ¾Ð´ ÑÑÐ²Ð¾ÑÐµÐ½Ð¾. ÐÐ°Ð´ÑÑÐ»ÑÑÑ Ð¹Ð¾Ð³Ð¾ Ð±Ð¾ÑÑ.");
    // realtime subscription will refresh the row
  };

  const unlink = async () => {
    if (!user) return;
    await supabase.from("user_telegram_links").delete().eq("user_id", user.id);
    setLink(null);
    toast.success("Telegram Ð²ÑÐ´Ê¼ÑÐ´Ð½Ð°Ð½Ð¾");
  };

  if (loading) {
    return (
      <Card className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> ÐÐµÑÐµÐ²ÑÑÐºÐ° ÑÑÐ°ÑÑÑÑ Telegram...
      </Card>
    );
  }

  const isLinked = !!link?.chat_id;

  if (isLinked && link?.is_active !== false) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
        <Check className="h-4 w-4 shrink-0 text-green-600" />
        <span>Telegram підключено</span>
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
                  <AlertTriangle className="h-4 w-4" /> Ð'ÑÐ´Ð½Ð°Ð½Ð½Ñ Ð¿ÐµÑÐµÑÐ²Ð°Ð½Ð¾
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  ÐÐ¾Ñ Ð±ÑÐ»ÑÑÐµ Ð½Ðµ Ð¼Ð¾Ð¶Ðµ Ð½Ð°Ð´ÑÐ¸Ð»Ð°ÑÐ¸ Ð²Ð°Ð¼ Ð¿Ð¾Ð²ÑÐ´Ð¾Ð¼Ð»ÐµÐ½Ð½Ñ. ÐÐ¼Ð¾Ð²ÑÑÐ½Ð¾, Ð²Ð¸ Ð·Ð°Ð±Ð»Ð¾ÐºÑÐ²Ð°Ð»Ð¸ Ð¹Ð¾Ð³Ð¾ Ð°Ð±Ð¾ Ð²Ð¸Ð´Ð°Ð»Ð¸Ð»Ð¸ ÑÐ°Ñ.
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={generate} disabled={generating}>
                    {generating ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                    ÐÑÐ´Ð½Ð¾Ð²Ð¸ÑÐ¸
                  </Button>
                  <Button size="sm" variant="ghost" onClick={unlink}>
                    <X className="h-3.5 w-3.5 mr-1" />
                    ÐÑÐ´Ê¼ÑÐ´Ð½Ð°ÑÐ¸
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-success flex items-center gap-1.5">
                  <Check className="h-4 w-4" /> Telegram Ð¿ÑÐ´ÐºÐ»ÑÑÐµÐ½Ð¾
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  ÐÐ¸ Ð¾ÑÑÐ¸Ð¼ÑÐ²Ð°ÑÐ¸Ð¼ÐµÑÐµ ÑÐ¿Ð¾Ð²ÑÑÐµÐ½Ð½Ñ Ð¿ÑÐ¾ Ð½Ð¾Ð²Ñ Ð¿Ð¾Ð²ÑÐ´Ð¾Ð¼Ð»ÐµÐ½Ð½Ñ Ð² ÑÐ°ÑÐ°Ñ.
                </p>
                <Button size="sm" variant="ghost" className="mt-2" onClick={unlink}>
                  <X className="h-3.5 w-3.5 mr-1" />
                  ÐÑÐ´Ê¼ÑÐ´Ð½Ð°ÑÐ¸
                </Button>
              </>
            )
          ) : link?.link_code ? (
            <>
              <p className="text-sm font-medium text-foreground">ÐÐ°Ð²ÐµÑÑÑÑÑ Ð¿ÑÐ´ÐºÐ»ÑÑÐµÐ½Ð½Ñ</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                1. ÐÑÐ´ÐºÑÐ¸Ð¹ÑÐµ Ð±Ð¾ÑÐ°{" "}
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
                  <span className="text-muted-foreground">(Ð·Ð°Ð²Ð°Ð½ÑÐ°Ð¶ÐµÐ½Ð½Ñ...)</span>
                )}
                <br />
                2. ÐÐ°ÑÐ¸ÑÐ½ÑÑÑ Â«StartÂ» (Ð°Ð±Ð¾ Ð½Ð°Ð´ÑÑÐ»ÑÑÑ ÐºÐ¾Ð¼Ð°Ð½Ð´Ñ Ð½Ð¸Ð¶ÑÐµ):
              </p>
              <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm">
                <span className="flex-1 truncate">/start {link.link_code}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() => {
                    navigator.clipboard.writeText(`/start ${link.link_code}`);
                    toast.success("Ð¡ÐºÐ¾Ð¿ÑÐ¹Ð¾Ð²Ð°Ð½Ð¾");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                ÐÐ¾Ð´ Ð´ÑÑ 30 ÑÐ²Ð¸Ð»Ð¸Ð½. Ð¯ÐºÑÐ¾ Ð¿ÑÐ¾ÑÐµÑÐ¼ÑÐ½ÑÐ²Ð°Ð²ÑÑ â Ð·Ð³ÐµÐ½ÐµÑÑÐ¹ÑÐµ Ð½Ð¾Ð²Ð¸Ð¹.
              </p>
              <Button size="sm" variant="outline" className="mt-2" onClick={generate} disabled={generating}>
                {generating && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                ÐÐ¾Ð²Ð¸Ð¹ ÐºÐ¾Ð´
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-foreground">Ð¡Ð¿Ð¾Ð²ÑÑÐµÐ½Ð½Ñ Ð² Telegram</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                ÐÑÐ´Ê¼ÑÐ´Ð½Ð°Ð¹ÑÐµ Telegram, ÑÐ¾Ð± Ð¾ÑÑÐ¸Ð¼ÑÐ²Ð°ÑÐ¸ ÑÐ¿Ð¾Ð²ÑÑÐµÐ½Ð½Ñ Ð¿ÑÐ¾ Ð½Ð¾Ð²Ñ Ð¿Ð¾Ð²ÑÐ´Ð¾Ð¼Ð»ÐµÐ½Ð½Ñ Ð² ÑÐ°ÑÐ°Ñ, Ð½Ð°Ð²ÑÑÑ ÐºÐ¾Ð»Ð¸ Ð·Ð°ÑÑÐ¾ÑÑÐ½Ð¾Ðº Ð·Ð°ÐºÑÐ¸ÑÐ¸Ð¹.
              </p>
              <Button size="sm" className="mt-3" onClick={generate} disabled={generating}>
                {generating && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                ÐÑÐ´Ê¼ÑÐ´Ð½Ð°ÑÐ¸ Telegram
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
