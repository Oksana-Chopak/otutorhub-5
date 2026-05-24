import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SmilePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

const EMOJI_PALETTE = ["👍", "❤️", "😂", "🎉", "🔥", "🙏", "👏", "😮"];

export interface Reaction {
  message_id: string;
  user_id: string;
  emoji: string;
}

interface Props {
  reactions: Reaction[];
  myId: string | null;
  onToggle: (emoji: string) => void;
  mine?: boolean;
}

export function MessageReactions({ reactions, myId, onToggle, mine }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const grouped = reactions.reduce<Record<string, { count: number; mine: boolean }>>((acc, r) => {
    const cur = acc[r.emoji] ?? { count: 0, mine: false };
    cur.count += 1;
    if (r.user_id === myId) cur.mine = true;
    acc[r.emoji] = cur;
    return acc;
  }, {});

  const entries = Object.entries(grouped);
  if (entries.length === 0 && !myId) return null;

  const handle = (emoji: string) => {
    onToggle(emoji);
    setOpen(false);
  };

  return (
    <div className={cn("mt-1 flex flex-wrap items-center gap-1", mine ? "justify-end" : "justify-start")}>
      {entries.map(([emoji, info]) => (
        <button
          key={emoji}
          type="button"
          onClick={() => handle(emoji)}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors",
            info.mine
              ? "border-primary/40 bg-primary/10 text-foreground"
              : "border-border bg-background/60 text-foreground hover:border-primary/30"
          )}
          title={info.mine ? t("chats.reactionRemove") : t("chats.reactionAdd")}
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
              title={t("chats.reactionTitle")}
              aria-label={t("chats.reactionAdd")}
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
                  onClick={() => handle(e)}
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
