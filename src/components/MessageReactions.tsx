import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SmilePlus } from "lucide-react";
import { cn } from "@/lib/utils";

const EMOJI_PALETTE = ["👍", "❤️", "😂", "🎉", "🔥", "🙏", "👏", "😮"];

interface Reaction {
  message_id: string;
  user_id: string;
  emoji: string;
}

interface Props {
  messageId: string;
  myId: string | null;
  /** Visual alignment hint — reactions row aligns to my side if my message. */
  mine?: boolean;
}

export function MessageReactions({ messageId, myId, mine }: Props) {
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("chat_message_reactions")
        .select("message_id, user_id, emoji")
        .eq("message_id", messageId);
      if (!cancelled) setReactions((data ?? []) as Reaction[]);
    })();

    const channel = supabase
      .channel(`reactions-${messageId}-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_message_reactions", filter: `message_id=eq.${messageId}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const r = payload.new as Reaction;
            setReactions((prev) =>
              prev.some((x) => x.user_id === r.user_id && x.emoji === r.emoji) ? prev : [...prev, r]
            );
          } else if (payload.eventType === "DELETE") {
            const r = payload.old as Reaction;
            setReactions((prev) => prev.filter((x) => !(x.user_id === r.user_id && x.emoji === r.emoji)));
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [messageId]);

  const grouped = reactions.reduce<Record<string, { count: number; mine: boolean }>>((acc, r) => {
    const cur = acc[r.emoji] ?? { count: 0, mine: false };
    cur.count += 1;
    if (r.user_id === myId) cur.mine = true;
    acc[r.emoji] = cur;
    return acc;
  }, {});

  const toggle = async (emoji: string) => {
    if (!myId) return;
    const exists = reactions.some((r) => r.user_id === myId && r.emoji === emoji);
    if (exists) {
      setReactions((prev) => prev.filter((r) => !(r.user_id === myId && r.emoji === emoji)));
      await supabase
        .from("chat_message_reactions")
        .delete()
        .eq("message_id", messageId)
        .eq("user_id", myId)
        .eq("emoji", emoji);
    } else {
      const optimistic: Reaction = { message_id: messageId, user_id: myId, emoji };
      setReactions((prev) => [...prev, optimistic]);
      await supabase
        .from("chat_message_reactions")
        .insert({ message_id: messageId, user_id: myId, emoji });
    }
    setOpen(false);
  };

  const entries = Object.entries(grouped);
  if (entries.length === 0 && !myId) return null;

  return (
    <div className={cn("mt-1 flex flex-wrap items-center gap-1", mine ? "justify-end" : "justify-start")}>
      {entries.map(([emoji, info]) => (
        <button
          key={emoji}
          type="button"
          onClick={() => toggle(emoji)}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors",
            info.mine
              ? "border-primary/40 bg-primary/10 text-foreground"
              : "border-border bg-background/60 text-foreground hover:border-primary/30"
          )}
          title={info.mine ? "Прибрати реакцію" : "Додати реакцію"}
        >
          <span className="text-sm leading-none">{emoji}</span>
          <span className="tabular-nums">{info.count}</span>
        </button>
      ))}
      {myId && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background/60 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              title="Реакція"
              aria-label="Додати реакцію"
            >
              <SmilePlus className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-1.5" align={mine ? "end" : "start"}>
            <div className="flex gap-0.5">
              {EMOJI_PALETTE.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => toggle(e)}
                  className="rounded-md px-1.5 py-1 text-lg transition-colors hover:bg-accent"
                >
                  {e}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
