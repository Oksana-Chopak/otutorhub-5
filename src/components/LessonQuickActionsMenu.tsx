import { MoreVertical, CalendarClock, XCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export type LessonQuickStatus = "completed" | "cancelled";

interface Props {
  onReschedule?: () => void;
  onMark?: (status: LessonQuickStatus) => void;
  canMark?: boolean;
  canReschedule?: boolean;
  /** Hide menu entirely if no actions available. */
}

/**
 * Compact "⋯" menu attached to a lesson card. Works equally well on touch
 * (tap) and desktop (click) without needing swipe gestures.
 */
export function LessonQuickActionsMenu({
  onReschedule,
  onMark,
  canMark = true,
  canReschedule = true,
}: Props) {
  if (!onReschedule && !onMark) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          aria-label="Дії з уроком"
          title="Дії з уроком"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {canReschedule && onReschedule && (
          <DropdownMenuItem onClick={onReschedule}>
            <CalendarClock className="mr-2 h-4 w-4" />
            Перенести
          </DropdownMenuItem>
        )}
        {canMark && onMark && (
          <>
            <DropdownMenuItem onClick={() => onMark("completed")}>
              <CheckCircle2 className="mr-2 h-4 w-4 text-success" />
              Відмітити проведеним
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onMark("cancelled")}
              className="text-destructive focus:text-destructive"
            >
              <XCircle className="mr-2 h-4 w-4" />
              Скасувати
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
