import { Filter } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ScheduleFiltersState } from "@/hooks/useScheduleFilters";

interface PersonOption {
  id: string;
  name: string;
}

interface Props {
  filters: ScheduleFiltersState;
  showTutorFilter: boolean;
  showStudentFilter: boolean;
  showSourceFilter: boolean;
  tutors: PersonOption[];
  students: PersonOption[];
}

/**
 * Filter controls used inside both the mobile bottom sheet and the desktop
 * popover. Single source of UI so the two surfaces never drift.
 */
function FilterControls({
  filters,
  showTutorFilter,
  showStudentFilter,
  showSourceFilter,
  tutors,
  students,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <Select
        value={filters.status}
        onValueChange={(v) => filters.setStatus(v as any)}
      >
        <SelectTrigger className="h-10 text-sm">
          <SelectValue placeholder={t("common.status")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("schedule.allStatuses")}</SelectItem>
          <SelectItem value="scheduled">{t("schedule.statusScheduled")}</SelectItem>
          <SelectItem value="completed">{t("schedule.statusCompleted")}</SelectItem>
          <SelectItem value="cancelled">{t("schedule.statusCancelled")}</SelectItem>
        </SelectContent>
      </Select>

      {showTutorFilter && (
        <Select value={filters.tutor} onValueChange={filters.setTutor}>
          <SelectTrigger className="h-10 text-sm">
            <SelectValue placeholder={t("roles.tutor")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("schedule.allTutors")}</SelectItem>
            {tutors.map((tu) => (
              <SelectItem key={tu.id} value={tu.id}>
                {tu.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {showStudentFilter && (
        <Select value={filters.student} onValueChange={filters.setStudent}>
          <SelectTrigger className="h-10 text-sm">
            <SelectValue placeholder={t("schedule.student")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("schedule.allStudents")}</SelectItem>
            {students.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select
        value={filters.period}
        onValueChange={(v) => filters.setPeriod(v as any)}
      >
        <SelectTrigger className="h-10 text-sm">
          <SelectValue placeholder={t("common.month")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("schedule.allPeriods")}</SelectItem>
          <SelectItem value="upcoming">{t("schedule.periodUpcoming")}</SelectItem>
          <SelectItem value="past">{t("schedule.periodPast")}</SelectItem>
          <SelectItem value="week">{t("schedule.periodThisWeek")}</SelectItem>
          <SelectItem value="month">{t("schedule.periodThisMonth")}</SelectItem>
        </SelectContent>
      </Select>

      {showSourceFilter && (
        <Select
          value={filters.source}
          onValueChange={(v) => filters.setSource(v as any)}
        >
          <SelectTrigger className="h-10 text-sm">
            <SelectValue placeholder={t("schedule.sourceAll")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("schedule.sourceAll")}</SelectItem>
            <SelectItem value="hub">{t("schedule.sourceHub")}</SelectItem>
            <SelectItem value="independent">{t("schedule.sourceMine")}</SelectItem>
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

/**
 * Trigger + surface combo. Mobile: bottom sheet. Desktop (lg+): popover panel.
 * Both anchor on a single "Filters (N)" button so users immediately see how
 * many filters are active.
 */
export function ScheduleFiltersSheet(props: Props) {
  const { t } = useTranslation();
  const { filters } = props;
  const [mobileOpen, setMobileOpen] = useState(false);

  const triggerLabel = filters.activeCount > 0
    ? `${t("filters.label")} (${filters.activeCount})`
    : t("filters.label");

  const TriggerButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="relative h-9 gap-2"
    >
      <Filter className="h-4 w-4" />
      <span>{triggerLabel}</span>
    </Button>
  );

  return (
    <>
      {/* Mobile: bottom sheet */}
      <div className="lg:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>{TriggerButton}</SheetTrigger>
          <SheetContent
            side="bottom"
            className="max-h-[85vh] overflow-y-auto rounded-t-2xl"
          >
            <SheetHeader className="text-left">
              <SheetTitle>{t("filters.label")}</SheetTitle>
            </SheetHeader>
            <div className="mt-4">
              <FilterControls {...props} />
            </div>
            <SheetFooter className="mt-6 flex-row gap-2 sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                className="flex-1"
                disabled={!filters.isActive}
                onClick={() => filters.reset()}
              >
                {t("schedule.resetFilters")}
              </Button>
              <Button
                type="button"
                className="flex-1"
                onClick={() => setMobileOpen(false)}
              >
                {t("common.done", { defaultValue: "Done" })}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop: popover */}
      <div className="hidden lg:block">
        <Popover>
          <PopoverTrigger asChild>{TriggerButton}</PopoverTrigger>
          <PopoverContent align="end" className="w-80">
            <FilterControls {...props} />
            {filters.isActive && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-3 w-full"
                onClick={() => filters.reset()}
              >
                {t("schedule.resetFilters")}
              </Button>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </>
  );
}
