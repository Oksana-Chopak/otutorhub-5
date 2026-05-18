import { useState, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Plus } from "lucide-react";
import { QuickActionsCard } from "@/components/QuickActionsCard";
import { useTranslation } from "react-i18next";

/**
 * Opens QuickActionsCard inside a bottom-sheet. By default renders a compact
 * icon button suitable for placement inside a header. Pass `trigger` to use a
 * custom trigger element.
 */
export function QuickActionsFab({
  onChanged,
  trigger,
}: {
  onChanged?: () => void;
  trigger?: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger ?? (
          <Button size="sm" className="gap-1.5 lg:hidden" aria-label={t("quickActions.title")}>
            <Plus className="h-4 w-4" />
            <span>{t("quickActions.title")}</span>
          </Button>
        )}
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t("quickActions.title")}</SheetTitle>
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
