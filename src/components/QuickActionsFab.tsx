import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Plus } from "lucide-react";
import { QuickActionsCard } from "@/components/QuickActionsCard";

/**
 * Mobile-only FAB that wraps QuickActionsCard inside a bottom-sheet so it
 * doesn't bloat the dashboard. Render this in addition to (or instead of) the
 * inline card on mobile.
 */
export function QuickActionsFab({ onChanged }: { onChanged?: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          size="lg"
          className="fixed bottom-20 right-4 z-40 h-14 gap-2 rounded-full shadow-lg lg:hidden"
          aria-label="Швидкі дії"
        >
          <Plus className="h-5 w-5" />
          <span className="hidden sm:inline">Швидкі дії</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Швидкі дії</SheetTitle>
        </SheetHeader>
        <div className="mt-3">
          <QuickActionsCard
            onChanged={() => {
              onChanged?.();
              setOpen(false);
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
