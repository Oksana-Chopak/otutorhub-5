import { Filter } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ChoiceChips, FieldLabel, NativeSelect } from "@/components/form/canon";
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
  // 14.11, хвиля форм: фільтри — у каноні. Короткі набори (статус, період, чиї уроки) —
  // кнопками, один дотик без списку; люди — рідним вибором телефона. Спливних списків
  // Radix тут більше немає: в аркуші вони були 40px заввишки з текстом 14px.
  return (
    <div className="flex flex-col gap-4">
      <div>
        <FieldLabel id="flt-status-label">{t("common.status")}</FieldLabel>
        <ChoiceChips
          labelledBy="flt-status-label"
          value={filters.status}
          onChange={(v) => filters.setStatus(v as any)}
          options={[
            { value: "all", label: t("schedule.allStatuses") },
            { value: "scheduled", label: t("schedule.statusScheduled") },
            { value: "completed", label: t("schedule.statusCompleted") },
            { value: "cancelled", label: t("schedule.statusCancelled") },
          ]}
        />
      </div>

      {showTutorFilter && (
        <div>
          <FieldLabel htmlFor="flt-tutor">{t("roles.tutor")}</FieldLabel>
          <NativeSelect id="flt-tutor" value={filters.tutor} onChange={(e) => filters.setTutor(e.target.value)}>
            <option value="all">{t("schedule.allTutors")}</option>
            {tutors.map((tu) => (
              <option key={tu.id} value={tu.id}>{tu.name}</option>
            ))}
          </NativeSelect>
        </div>
      )}

      {showStudentFilter && (
        <div>
          <FieldLabel htmlFor="flt-student">{t("schedule.student")}</FieldLabel>
          <NativeSelect id="flt-student" value={filters.student} onChange={(e) => filters.setStudent(e.target.value)}>
            <option value="all">{t("schedule.allStudents")}</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </NativeSelect>
        </div>
      )}

      <div>
        <FieldLabel id="flt-period-label">{t("filters.period")}</FieldLabel>
        <ChoiceChips
          labelledBy="flt-period-label"
          value={filters.period}
          onChange={(v) => filters.setPeriod(v as any)}
          options={[
            { value: "all", label: t("schedule.allPeriods") },
            { value: "upcoming", label: t("schedule.periodUpcoming") },
            { value: "past", label: t("schedule.periodPast") },
            { value: "week", label: t("schedule.periodThisWeek") },
            { value: "month", label: t("schedule.periodThisMonth") },
          ]}
        />
      </div>

      {showSourceFilter && (
        <div>
          <FieldLabel id="flt-source-label">{t("filters.source")}</FieldLabel>
          <ChoiceChips
            labelledBy="flt-source-label"
            value={filters.source}
            onChange={(v) => filters.setSource(v as any)}
            options={[
              { value: "all", label: t("schedule.sourceAll") },
              { value: "hub", label: t("schedule.sourceHub") },
              { value: "independent", label: t("schedule.sourceMine") },
            ]}
          />
        </div>
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
      className="tap-44 relative h-10 gap-2"
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
